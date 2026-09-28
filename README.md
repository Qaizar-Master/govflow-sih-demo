# GovFlow

**Government Interoperability & Workflow Orchestration Platform**

A working prototype of the middleware layer that lets independently-built departmental
systems cooperate on a single citizen application — without replacing any of them.

> ### ⚠️ Prototype
> Every "department" in this repository is a **simulated service holding synthetic data**.
> GovFlow is not connected to, and makes no claim to integrate with, any real government
> database. All names, identifiers, incomes and certificates are invented for demonstration.

---

## 1. Project overview

A citizen applies for a government service. Establishing eligibility needs three
departments plus one legacy system, each built at a different time by a different team:

| System | Interface | Schema style | Auth | Identifier |
|---|---|---|---|---|
| National Identity Registry | REST/JSON | `camelCase` | API key header | `CIT-1001` |
| State Income & Revenue Dept. | REST/JSON | `snake_case` | Bearer token | `INC-1001` |
| Department of Higher Education | REST/JSON | a third convention | HTTP Basic | `STU-1001` |
| Legacy Beneficiary System | **CSV export** | flat file | file access | `BEN1001` |

GovFlow sits in front of them and produces one application number, one consent ledger, one
normalised record, one timeline and one audit trail.

**Three services run on this one integration layer**, which is the point:

| Service | Departments consulted | Steps | Target | Distinguishing rule |
|---|---|---|---|---|
| Merit-cum-Means Scholarship | Identity, Income, Education, Legacy | 9 | 5 days | Income ceiling ₹2,50,000 + active enrolment |
| Income Certificate | Identity, Income | 7 | 3 days | An *issuance*, so no means test at all |
| Ration Card (PDS) | Identity, Income, Legacy | 8 | 7 days | Duplicate-benefit check against the legacy register |

Adding the second and third services required **no new connectors** — only a service
definition. That is what a middleware layer is for.

## 2. The problem being solved

Because those systems never agreed on anything, today the citizen carries the integration
burden: the same details are submitted repeatedly, verification happens by email and phone,
and nobody can say where an application actually is. Departments cannot fix this
individually, and replacing everything with one monolith is a decade-long programme that
requires every department to surrender ownership of its data.

**GovFlow's position: connect, don't replace.**

## 3. Key features

- **Connector framework** — one `DepartmentConnector` interface; REST and CSV adapters
  behave identically to everything downstream.
- **Declarative field mappings** — normalisation lives in configuration, not scattered
  through the codebase. A new department is a connector plus a mapping.
- **Common data model** — Zod-validated, with per-field provenance so an officer can see
  which system asserted what.
- **Pre-fill with reconciliation** — the citizen's form comes back answered from the
  registries that already hold the data, each value attributed to the department that
  asserted it. At decision time the officer sees three columns: what the applicant was
  shown, what they submitted, and what the registry says now — so a value the citizen
  changed is distinguishable from a registry that has since moved.
- **Declarative forms** — a service's form is data (`packages/contracts/src/form-schema.ts`),
  not a component. Each field declares which department and which common-data-model
  property fills it; pre-fill is a walk over that binding.
- **Identity binding via SSO** — a simulated national identity provider ("MeriPehchaan")
  asserts who the citizen is and how each department keys them. GovFlow never sees a
  password, and every departmental identifier it holds records who vouched for it.
- **Stored identifier crosswalk** — departmental keyspaces are independent, so the mapping
  from `CIT-1001` to `INC-1001` is looked up and attributed, never derived from the string.
- **Officer scoping** — officers see only the services their own department owns; a Revenue
  officer cannot open, annotate or decide a scholarship.
- **Consent gate** — no department is contacted without a recorded, purpose-bound consent.
  With consent outstanding the workflow genuinely suspends and makes zero calls.
- **Async orchestration** — BullMQ. `POST /applications` returns in milliseconds; a slow
  registry never becomes a slow portal.
- **Real failure handling** — retryable failures back off and retry; exhausted retries
  raise an exception, notify an officer and park the application. Non-blocking departments
  degrade instead of stopping the flow.
- **Failure simulation** — the admin console breaks a department for real, via its control
  plane. Retries and exceptions that follow are genuine.
- **AI-assisted validation** — OCR + Gemini extract document fields and review
  cross-source consistency. A deterministic rule engine always runs underneath, so the
  platform is fully functional with **no API key**. AI never decides eligibility.
- **SLA, audit and monitoring** — deterministic SLA states, an append-only audit log, and
  admin dashboards backed by the same Postgres tables that hold the workflow state.

## 4. Architecture

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

Every department, REST or file, goes through the same pipeline:

```mermaid
flowchart LR
    src["Source"] --> conn["Connector"] --> val["Schema validation"]
    val --> map["Field mapping"] --> norm["Normalisation"]
    norm --> quality["Quality checks"] --> cdm["Common data model"]
    cdm --> db[("PostgreSQL")] --> wf["Workflow engine"]
```

Full diagrams, the dependency rules and the failure model: **[docs/architecture.md](docs/architecture.md)**.

## 5. Tech stack

| Layer | Choice |
|---|---|
| Frontend | Next.js 15 (App Router), TypeScript, Tailwind CSS v4, shadcn/ui |
| Backend | Node.js, Express, TypeScript, REST/JSON, OpenAPI 3 |
| Database | PostgreSQL 16 + Prisma 7 (query compiler + `@prisma/adapter-pg` driver adapter) |
| Async | Redis 7 + BullMQ |
| AI | Gemini API (optional) with a deterministic rule engine underneath |
| Documents | Text-layer extraction + pluggable OCR slot |
| Auth | JWT + role-based access control enforced in Express |
| Infra | Docker Compose |
| Tests | Vitest + Supertest |

Backend TypeScript runs directly via `tsx` — no build step to fall out of sync during a
demo. Typechecking still covers every workspace.

Two version notes, because both are recent majors:

- **Tailwind v4 is CSS-first.** There is no `tailwind.config.ts`; the design tokens in
  `apps/web/app/globals.css` (`@theme inline`) *are* the configuration.
- **Prisma 7 drops the Rust query engine.** The connection URL lives in
  `prisma.config.ts` for CLI commands, and the runtime client is constructed with the
  `@prisma/adapter-pg` driver adapter in `packages/core/src/db.ts`.

## 6. Repository structure

```
govflow/
├── apps/
│   ├── api/                    Express API — routes, middleware, OpenAPI
│   └── web/                    Next.js UI — citizen, officer, admin
├── services/
│   └── mock-departments/       Simulated Identity + Income + Education registries
├── workers/
│   └── workflow-worker/        BullMQ consumer running workflow steps
├── packages/
│   ├── contracts/              Enums, common data model, field mappings,
│   │                           workflow definition, env config
│   ├── connector-sdk/          Connector framework: base, REST, CSV, mapping engine
│   └── core/                   Domain: workflow engine, validation, documents,
│                               audit, exceptions, SLA, metrics, Prisma client
├── prisma.config.ts            Prisma 7 config — datasource URL + seed command
├── prisma/                     schema.prisma + seed.ts
├── data/
│   ├── legacy/                 beneficiaries.csv (the legacy department)
│   ├── documents/              Synthetic certificates for the demo
│   └── uploads/                Runtime upload target
├── tests/                      Unit + integration (Vitest, Supertest)
├── docs/                       architecture · api · workflows · demo
├── docker/                     Dockerfiles + API entrypoint
└── docker-compose.yml
```

`packages/core` is an addition to a plain three-package layout: the workflow engine has to
be callable from both the API (to enqueue and read) and the worker (to execute), so it
lives in one place rather than being duplicated.

## 7. Prerequisites

- **Docker + Docker Compose** — the only requirement for the Docker path.
- For local development: **Node.js ≥ 20** (tested on 24) and Docker for Postgres and Redis.

Ports used: `3000` web, `4000` API, `5001` simulated departments, `5432` Postgres,
`6379` Redis.

## 8. Environment variables

Copy `.env.example` to `.env`. Every variable has a working development default; the file
is only needed for local (non-Docker) runs, since Compose passes its own environment.

| Variable | Default | Purpose |
|---|---|---|
| `DATABASE_URL` | `postgresql://govflow:govflow@localhost:5432/govflow` | Postgres |
| `REDIS_URL` | `redis://localhost:6379` | BullMQ |
| `REDIS_QUEUE_PREFIX` | `govflow` | Queue namespace (tests override it) |
| `JWT_SECRET` | dev placeholder | **Change for anything real** |
| `JWT_EXPIRES_IN` | `12h` | Token lifetime |
| `PORT` | `4000` | API port |
| `FRONTEND_URL` / `CORS_ORIGINS` | `http://localhost:3000` | CORS allow-list |
| `NEXT_PUBLIC_API_URL` | `http://localhost:4000` | API base baked into the browser bundle |
| `IDENTITY_API_URL` / `INCOME_API_URL` / `EDUCATION_API_URL` | `http://localhost:5001` | Simulated departments |
| `IDENTITY_API_KEY` / `INCOME_API_TOKEN` / `EDUCATION_BASIC_USER` / `EDUCATION_BASIC_PASS` | demo values | Per-department credentials |
| `SSO_AUTHORIZE_URL` | `http://localhost:5001/sso` | Where the **browser** is sent |
| `SSO_INTERNAL_URL` | `http://localhost:5001/sso` | Where the **API** exchanges the code (differs under Compose) |
| `SSO_CLIENT_ID` / `SSO_CLIENT_SECRET` | demo values | Relying-party credentials |
| `LEGACY_CSV_PATH` | `./data/legacy/beneficiaries.csv` | Legacy export |
| `CONNECTOR_TIMEOUT_MS` | `4000` | Per-department timeout |
| `WORKFLOW_MAX_ATTEMPTS` | `3` | Retries before an exception |
| `WORKFLOW_BACKOFF_MS` | `1500` | Exponential backoff base |
| `SLA_TARGET_DAYS` | `5` | Processing target |
| `UPLOAD_DIR` / `MAX_UPLOAD_BYTES` | `./data/uploads` / 5 MB | Documents |
| `GEMINI_API_KEY` | *(empty)* | **Optional.** Empty ⇒ rule-based validation |
| `GEMINI_MODEL` | `gemini-2.5-flash` | Model id |

No secret is committed. `.env` is git-ignored; `.env.example` holds placeholders only.

## 9. Docker setup (recommended)

```bash
git clone <repo> && cd govflow
docker compose up --build
```

That is the whole thing. The `api` container waits for Postgres, applies the schema with
`prisma db push`, runs the seed (idempotent — it skips if data already exists), and starts.

| Service | URL |
|---|---|
| Citizen / officer / admin UI | http://localhost:3000 |
| API | http://localhost:4000 |
| Swagger UI | http://localhost:4000/docs |
| OpenAPI JSON | http://localhost:4000/openapi.json |
| Simulated departments | http://localhost:5001 |

Useful commands:

```bash
docker compose logs -f worker            # watch the workflow engine
docker compose logs -f api
docker compose restart mock-departments  # clear all simulated outages
docker compose down                      # stop
docker compose down -v                   # stop and wipe the database
```

## 10. Local setup (without Docker for the app)

```bash
npm install
cp .env.example .env

npm run infra:up          # Postgres + Redis in Docker
npm run prisma:generate
npm run prisma:push       # apply the schema
npm run db:seed           # synthetic demo data

npm run dev               # mocks + API + worker + web, all together
```

Or run each process in its own terminal:

```bash
npm run dev:mocks    # simulated departments  :5001
npm run dev:api      # Express API            :4000
npm run dev:worker   # BullMQ worker
npm run dev:web      # Next.js UI             :3000
```

### Database commands

```bash
npm run prisma:push      # apply schema (declarative, no migration files)
npm run prisma:studio    # browse the data
npm run db:seed          # seed if empty
npm run db:seed -- --force   # wipe and reseed
npm run db:reset         # reset the database and reseed
```

`prisma db push` is deliberate over migrations: for a demo that gets reset repeatedly on
unfamiliar machines, a declarative sync has fewer ways to half-apply.

## 11. Demo credentials

Password for **every** account: `Password@123`

| Role | Email | Notes |
|---|---|---|
| Citizen | `rohan.prajapati@example.gov.in` | **No application yet — use this one for the live demo** |
| Citizen | `aditya.sharma@example.gov.in` | Has an approved application |
| Citizen | `vikram.shinde@example.gov.in` | Has a name + income mismatch |
| Citizen | `meera.iyer@example.gov.in` | Blocked by a connector failure |
| Officer | `officer@govflow.gov.in` | Education Department - scholarship queue only |
| Officer | `officer2@govflow.gov.in` | Revenue Department - income certificate and ration card queues only |
| Admin | `admin@govflow.gov.in` | Connector health, failure simulation, audit |

The login page lists the three main accounts and fills them in on click.

### Seeded data

10 citizens, 10 applications, 4 departments, and deliberately-planted problems: one
approved, one rejected, one name mismatch, one income disagreement between two registries,
one missing document, one connector failure with three exhausted retries, one application
at SLA risk, one overdue, one awaiting consent, one mid-flight.

## 12. Demo scenarios

Full script with talking points: **[docs/demo.md](docs/demo.md)**.

1. **Happy path** — citizen applies, four departments respond, officer approves, citizen
   sees `APPROVED`.
2. **Data mismatch** — Identity says `Rohan Prajapati`, Education says `Rohan P.`; GovFlow
   flags it and grades it `LOW` because it recognises an abbreviation.
3. **Department outage** — admin breaks the Income Department for real; watch retry 1/3 →
   2/3 → 3/3 → exception → officer notified → restore → resume → completion.
4. **Legacy ingestion** — a CSV export with no API goes through the identical connector
   contract; raw row and normalised record shown side by side.

## 13. API documentation

Swagger UI at **http://localhost:4000/docs**, spec at `/openapi.json`, written reference in
**[docs/api.md](docs/api.md)**.

Every response uses one envelope:

```jsonc
{ "success": true,  "data": { }, "error": null }
{ "success": false, "data": null, "error": { "code": "VALIDATION_ERROR", "message": "…" } }
```

## 14. Connector architecture

```ts
interface DepartmentConnector {
  getName(): string;
  healthCheck(): Promise<HealthStatus>;
  fetchCitizenData(identifier: string): Promise<RawFetchResult>;
  transform(data: unknown): NormalizedRecord;
  validate(data: unknown): ValidationResult;
  ingest(identifier: string): Promise<ConnectorFetchOutcome>;
}
```

`BaseConnector` implements `validate`, `transform` and `ingest` once. A concrete connector
supplies only the raw schema its department emits and any quality checks. `RestConnector`
adds auth, timeouts and error classification; `CsvConnector` adds file reading — and the
workflow engine cannot tell them apart.

Normalisation is declarative:

```ts
export const incomeMapping: FieldMappingSpec = {
  name: 'income-department-v2',
  rules: [
    { from: 'applicant_id',  to: 'citizenId',    transforms: ['trim', 'upper'], required: true },
    { from: 'annualIncome',  to: 'annualIncome', transforms: ['stripCurrency', 'number'], required: true },
    { from: 'certificate_no', to: 'certificateNumber', transforms: ['trim', 'upper'] },
  ],
};
```

**Adding a department:** a `DepartmentDefinition`, a `FieldMappingSpec`, a connector class,
and a workflow step. No change to the engine, the API or the UI. Details in
**[docs/workflows.md](docs/workflows.md)**.

## 15. AI and OCR

Two features, both advisory:

1. **Document extraction** — upload → text layer (or OCR) → field extraction → validation.
2. **Mismatch detection** — compare name, income, identifiers, districts and documents
   across every source.

**The platform works fully without an API key.** The deterministic rule engine is the
floor, not the fallback: it always runs. With `GEMINI_API_KEY` set, Gemini reviews the same
evidence and may add observations; it can never remove a rule finding. The UI states which
engine produced the report, and shows *"AI service unavailable — rule-based validation
used"* when no key is configured.

To enable it:

```bash
echo 'GEMINI_API_KEY=your-key-here' >> .env
docker compose up -d --force-recreate api worker
```

OCR uses a `DocumentProcessor` → `OCRProcessor` abstraction. Text-layer documents (the
synthetic certificates in `data/documents/`) are read directly and work offline.
`tesseract.js` is intentionally **not** a dependency — it downloads a large model at
runtime, which is the wrong trade for a demo. Installing it lights up the optical path
with no other code change; until then, image uploads report honestly that no OCR engine is
available rather than inventing fields.

## 16. Failure simulation

Admin → **Connectors** → pick a mode → **Simulate failure**.

| Mode | Effect |
|---|---|
| `ERROR_500` | Department returns HTTP 503 |
| `TIMEOUT` | Department never responds; the connector times out |
| `MALFORMED` | HTTP 200 with a body that breaks its own published contract |
| `UNAUTHORIZED` | Department rejects our credentials |

This is not a flag GovFlow reads and short-circuits — the admin console calls the simulated
department's control plane, so the next real HTTP call genuinely fails. What follows is
real BullMQ retry behaviour, a real exception row and a real notification.

Also available: **Test connector** (probe a department and see raw beside normalised) and
**Run legacy import** (ingest the CSV export).

## 17. Testing

```bash
npm test              # 155 tests
npm run typecheck     # every workspace, including the web app
npm run lint
```

Unit tests need nothing running. Integration tests need Postgres, Redis and the simulated
departments; they use a separate `govflow_test` database and a separate queue namespace, so
they never touch demo data — and they **skip with a clear message** rather than failing if
that infrastructure is absent.

Covered: connector transformation and the common data model; the mapping engine; retryable
vs non-retryable classification; document extraction; SLA states; mismatch detection;
authentication; RBAC across all three roles; consent gating; application creation; workflow
transitions; retry behaviour with a real BullMQ worker; exception creation; officer
department scoping; the identifier crosswalk and its non-retryable failure when a link is
absent; the full SSO round trip including replayed codes, forged state and unregistered
redirect URIs; the draft/pre-fill/submit lifecycle including the consent gate, a department
outage during pre-fill and per-field submission validation; every reconciliation verdict,
including the distinction between a citizen edit and a registry that moved; and an
end-to-end run from submission through four departments to officer approval.

## 18. Troubleshooting

| Symptom | Cause / fix |
|---|---|
| `docker compose up` fails on port 5432 or 6379 | Something local is already bound: `sudo lsof -i :5432`, stop it, or change the published port |
| Timeline stuck at `PROCESSING` | The worker is down: `docker compose logs -f worker` |
| All connectors red | `docker compose restart mock-departments` |
| A department stays red after a demo | Admin → Connectors → **Restore service** (state is intentionally sticky) |
| `Invalid GovFlow environment configuration` | A variable is set but empty in `.env`; delete the line to take the default |
| Login rejected on a fresh clone | The seed did not run: `docker compose exec api npx tsx prisma/seed.ts --force` |
| Web shows "API unreachable" | `NEXT_PUBLIC_API_URL` is baked at build time — rebuild after changing it |
| Integration tests skipped | Expected without infrastructure: `npm run infra:up && npm run dev:mocks` |
| Want a pristine demo | `docker compose down -v && docker compose up --build` |
| `PrismaConfigEnvError: Cannot resolve environment variable` | Only if you removed the default in `prisma.config.ts`; set `DATABASE_URL` or restore it |
| Prisma asks for `PRISMA_USER_CONSENT_FOR_DANGEROUS_AI_ACTION` | Prisma 7 guards destructive commands when it detects an AI agent in the environment. Run the command yourself in a normal shell |
| Styles missing after an edit to `globals.css` | Tailwind v4 has no config file — check the `@theme inline` block, not a `tailwind.config.ts` |

On **Zorin OS / Ubuntu**, if `docker compose` reports a permission error, add yourself to
the docker group and start a new session:

```bash
sudo usermod -aG docker "$USER" && newgrp docker
```

## 19. Prototype limitations

Stated plainly, because a demo that oversells itself is worse than one that does not:

- **Departments are simulated.** Real integration means real contracts, credentials,
  rate limits and support arrangements.
- **The identifier crosswalk is naive** — it assumes a shared numeric suffix across
  keyspaces. Real identity resolution is its own hard problem.
- **Consent is a working model, not a legal instrument.** No signed receipts, no expiry
  enforcement, no revocation propagation to departments.
- **OCR is a slot, not an implementation.** Text-layer documents work; scanned images
  report that no engine is installed.
- **Files are stored on a local volume**, not in object storage, and are not encrypted at rest.
- **A single worker process** with no dead-letter queue. Department calls are not
  idempotency-keyed.
- **Notifications poll**; there is no push transport.
- **`prisma db push`, not migrations** — deliberate for a resettable demo, wrong for
  production.
- **No rate limiting, no CSRF tokens, no refresh-token rotation.** JWTs live in
  `localStorage`, which is fine for a prototype and not for a public service.

## 20. Future scalability

- Horizontal workers by queue, plus per-department concurrency limits so one slow registry
  cannot starve the rest.
- A circuit breaker per connector, feeding the health cards that already exist.
- Response caching per department with TTLs the department owns.
- Outbox pattern for notifications; push transport when the volume justifies it.
- Connector versioning, so a department can change its contract without a redeploy.
- A department self-service portal for registering an endpoint and mapping.
- Multi-scheme support — the workflow definition is already data, not code.

---

## Licence

MIT. Synthetic data only; not for use with real citizen records without a security review.
