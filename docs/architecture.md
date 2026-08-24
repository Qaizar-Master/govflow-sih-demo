# GovFlow — Architecture

> **Prototype.** Every "department" in this document is a simulated service holding
> synthetic data. No real government registry is connected.

## 1. The problem

Departments build independently. Over time each ends up with its own portal, its own
registry, its own identifiers, its own API conventions and its own authentication. The
citizen pays for that fragmentation: the same information is submitted repeatedly,
verification happens by email and phone call, and nobody can say where an application
actually is.

The instinct is to build one big new system that replaces them. That is a decade-long
programme with a poor success record, and it requires every department to give up
ownership of its own data.

## 2. The approach — connect, don't replace

GovFlow is **middleware**, not a replacement. It sits between the citizen and the
departments and does five things:

| Concern | How GovFlow handles it |
|---|---|
| Different schemas | A **connector** per department + a declarative **field mapping** |
| Different identifiers | An identifier **crosswalk** (`CIT-1001` ⇄ `INC-1001` ⇄ `STU-1001`) |
| Different auth | Each connector carries its own scheme (API key / bearer / basic / file) |
| Different processes | One **workflow engine** orchestrating steps across departments |
| No shared visibility | One **common data model**, one timeline, one audit log |

Departments keep their systems and their ownership. Onboarding a new one means adding a
connector and a mapping — a configuration change, not a migration.

## 3. System context

```mermaid
flowchart LR
    citizen([Citizen])
    officer([Review officer])
    admin([Administrator])

    subgraph govflow["GovFlow platform"]
        web["Next.js UI<br/>citizen · officer · admin"]
        api["Express API<br/>GovFlow Core"]
        redis[("Redis<br/>job queue")]
        worker["BullMQ worker<br/>workflow steps"]
        pg[("PostgreSQL<br/>workflow · audit · common data model")]

        web -->|REST / JSON| api
        api -->|enqueue| redis
        redis -->|dequeue| worker
        api --> pg
        worker --> pg
    end

    subgraph depts["Simulated departmental systems"]
        direction TB
        identity["Identity Registry<br/>REST · camelCase · API key · CIT-####"]
        income["Income Department<br/>REST · snake_case · Bearer · INC-####"]
        education["Education Department<br/>REST · third convention · Basic · STU-####"]
        legacy[("Legacy Beneficiary System<br/>CSV export · no API · BEN####")]
    end

    citizen --> web
    officer --> web
    admin --> web

    worker ==>|"4 connectors"| depts
    api -.->|"health · failure simulation"| depts
```

## 4. Internal architecture

```mermaid
flowchart TB
    subgraph api["Express API — GovFlow Core"]
        routes["Routes<br/>auth · applications · officer · admin"]
        authmw["JWT + RBAC middleware"]
        errors["Error envelope + safe messages"]
    end

    subgraph core["packages/core — domain"]
        wf["Workflow engine"]
        val["Validation<br/>rules + optional Gemini"]
        doc["DocumentProcessor<br/>OCR + extraction"]
        audit["Audit · notifications · exceptions"]
        sla["SLA assessment"]
        metrics["Metrics"]
    end

    subgraph sdk["packages/connector-sdk — adapters"]
        base["BaseConnector<br/>fetch → validate → map → normalise → quality"]
        rest["RestConnector"]
        csv["CsvConnector"]
        concrete["Identity · Income · Education · LegacyCSV"]
    end

    subgraph contracts["packages/contracts"]
        cdm["Common data model (Zod)"]
        maps["Field mappings"]
        wfdef["Workflow definition"]
        envcfg["Environment config"]
    end

    routes --> authmw --> wf
    wf --> val
    wf --> doc
    wf --> audit
    wf --> sdk
    sdk --> contracts
    core --> contracts
    routes --> metrics
    routes --> sla
```

**The dependency rule that matters:** department-specific schemas exist only inside
`connector-sdk` and the mappings in `contracts`. Nothing in `core` — not the workflow
engine, not the validators, not the dashboards — ever references `applicant_id` or
`student_no`. They see only the common data model.

## 5. The ingestion pipeline

Every department, REST or CSV, goes through exactly the same stages:

```mermaid
flowchart LR
    src["Source system"] --> fetch["Connector fetch<br/>auth · timeout · error classification"]
    fetch --> raw["Raw payload"]
    raw --> schema["Schema validation<br/>(Zod, upstream contract)"]
    schema --> map["Field mapping<br/>(declarative rules)"]
    map --> norm["Normalisation<br/>trim · titleCase · currency · dates"]
    norm --> cdmv["Common-data-model validation"]
    cdmv --> quality["Quality checks<br/>non-fatal warnings"]
    quality --> db[("NormalizedRecord")]
    db --> wf["Workflow engine"]

    fetch -.->|every call| log[("ConnectorLog")]
    schema -.->|on failure| exc[("Exception")]
```

A worked example — three registries, three dialects, one result:

| Identity Registry | Income Department | Education Department | → Common data model |
|---|---|---|---|
| `citizenId` | `applicant_id` | `student_no` | `citizenId` |
| `fullName` | `name` | `studentName` | `name` |
| `dob: "2003-05-12"` | — | — | `dateOfBirth` |
| `district: "  KOLHAPUR "` | — | — | `district: "Kolhapur"` |
| — | `annualIncome: "1,95,000"` | — | `annualIncome: 195000` |
| — | — | `enrollment_status: "active"` | `educationStatus: "ACTIVE"` |

## 6. Asynchronous execution

`POST /api/applications` returns in milliseconds with `PROCESSING`. It does **not** call
any department on the request thread — a slow registry must never become a slow portal.

```mermaid
sequenceDiagram
    participant C as Citizen
    participant A as API
    participant Q as Redis / BullMQ
    participant W as Worker
    participant D as Department

    C->>A: POST /api/applications
    A->>A: create application + consents + 9 workflow steps
    A->>Q: enqueue CONSENT
    A-->>C: 201 { status: PROCESSING }

    Q->>W: CONSENT
    W->>W: all consents granted?
    W->>Q: enqueue IDENTITY_VERIFICATION
    Q->>W: IDENTITY_VERIFICATION
    W->>D: GET /api/identity/CIT-1001
    D-->>W: 200 department-shaped JSON
    W->>W: validate → map → normalise → persist
    W->>Q: enqueue INCOME_VERIFICATION
    Note over W,Q: …and so on through the definition
    W->>W: park at OFFICER_REVIEW, notify officers
```

Each step is one job. The engine persists the outcome and enqueues the next step itself,
so the chain is restartable from the database alone.

## 7. Failure handling

```mermaid
flowchart TD
    request["Connector call"] --> ok{Succeeded?}
    ok -->|yes| advance["Persist + advance"]
    ok -->|no| classify["Classify the failure"]
    classify --> retryable{Retryable?}
    retryable -->|"timeout · refused · 5xx"| attempts{Attempts left?}
    retryable -->|"404 · 401 · malformed · schema"| exc
    attempts -->|yes| backoff["Re-throw → BullMQ exponential backoff"]
    backoff --> request
    attempts -->|no| exc["Raise Exception<br/>step → REQUIRES_REVIEW"]
    exc --> blocking{Blocking department?}
    blocking -->|yes| park["Suspend workflow<br/>notify officer + citizen"]
    blocking -->|no| carryOn["Record and carry on"]
```

Two decisions worth calling out:

- **Retryable vs not** is decided once, in the connector, and expressed as a single
  boolean. Callers never inspect HTTP status codes.
- **Blocking vs non-blocking** is per department. The legacy CSV cross-check is
  non-blocking: its absence degrades the evidence, it does not stop the application.

## 8. Consent

No department is contacted without a recorded, purpose-bound consent. The consent step is
the first workflow step, and it is a genuine gate — with consent outstanding, the workflow
suspends and zero connector calls are made. Granting the last outstanding scope releases it.

## 9. AI as an assistant, never a decision-maker

```mermaid
flowchart LR
    ev["Evidence from all sources"] --> rules["Deterministic rule engine<br/>ALWAYS runs"]
    rules --> base["Baseline findings"]
    base --> key{GEMINI_API_KEY set?}
    key -->|no| report["Advisory report<br/>engine: RULE_BASED"]
    key -->|yes| gem["Gemini reviews the same evidence"]
    gem --> merge["Merge · dedupe · rules win on conflict"]
    merge --> report2["Advisory report<br/>engine: GEMINI"]
    report --> officer([Officer decides])
    report2 --> officer
```

The rule engine is the floor, not the fallback: it runs whether or not a key is present.
Gemini can add observations and a better summary; it can never remove a rule finding,
and no code path lets any model set an application to `APPROVED` or `REJECTED`.
`recordOfficerDecision` requires an officer user id.

## 10. Data model

```mermaid
erDiagram
    Citizen ||--o{ Application : submits
    Citizen ||--o| User : "logs in as"
    Application ||--|| WorkflowInstance : has
    WorkflowInstance ||--o{ WorkflowStep : contains
    Application ||--o{ Consent : authorises
    Application ||--o{ Document : attaches
    Application ||--o{ NormalizedRecord : "evidence"
    Application ||--o{ Exception : raises
    Application ||--o{ Notification : notifies
    Application ||--o{ ReviewNote : "officer notes"
    Application ||--o{ ConnectorLog : "calls made for"
    WorkflowStep ||--o{ Exception : "failed as"
    Department ||--o{ ConnectorLog : "was called"
    User ||--o{ AuditLog : performed
```

Raw department payloads are deliberately **not** persisted in full — only the normalised
record, its provenance and its quality warnings. Audit entries carry identifiers,
statuses and counts, never document contents or credentials.

## 11. Deliberate non-goals

Rejected as wrong for a prototype of this size: Kubernetes, Kafka, a microservice per
department, GraphQL, a second database, and a separate metrics stack. Each would add
operational surface without making the interoperability argument any stronger. The
monitoring dashboards are backed by the same Postgres tables that hold the workflow state.

## 12. Path to production

What would actually have to change:

- Replace simulated departments with real integrations — the connector contract does not change.
- Real identity assurance (the crosswalk currently assumes a shared numeric suffix).
- Consent as a legal artefact: signed receipts, expiry enforcement, revocation propagation.
- Secrets in a managed vault; per-department mTLS or signed requests.
- Horizontal workers, a dead-letter queue, and idempotency keys on department calls.
- Data retention and residency policy for `NormalizedRecord` and `AuditLog`.
