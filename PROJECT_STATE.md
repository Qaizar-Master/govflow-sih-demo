# GovFlow — Project State & Design Record

> Living record of what exists, why it is shaped this way, what was deliberately
> rejected, and what remains. Written to survive a context reset — anyone (human
> or agent) picking this up should be able to start from this file alone.
>
> **Last verified:** 2026-09-18 · commit `7cf94bc`

---

## 0. One-paragraph summary

GovFlow is an **interoperability middleware layer** for government service
delivery, built for a Smart India Hackathon problem statement about departments
that cannot exchange information. A citizen applies once; GovFlow gathers the
supporting evidence from four independently-built departmental systems (three
REST APIs with different schemas and auth mechanisms, one legacy CSV export),
normalises it into a common data model, orchestrates a multi-step workflow with
real retries and exception handling, reconciles what the sources say about one
person, and presents assembled evidence to a departmental officer who makes the
decision. **All departments are simulated with synthetic data.** Nothing
connects to a real government system.

---

## 1. Current status

| | |
|---|---|
| Tests | **122 passing** (11 files: 6 unit, 5 integration) |
| Typecheck | clean (root + web) |
| Lint | clean, `--max-warnings 0` |
| Docker | `docker compose up --build` boots, migrates and seeds itself |
| Backend | ~10,260 lines TS |
| Frontend | ~6,315 lines TS/TSX, 19 pages |
| API | 38 documented OpenAPI paths |
| Data model | 15 Prisma models |
| Services | 3 |
| Connectors | 4 |

### Phase A applied (2026-09-18)

Three coherence fixes landed: officers are scoped to their department's
services, the identifier crosswalk is stored rather than derived, and the
pre-fill overclaim on `/applications/new` is corrected. See §6.5.

**Rebuild note.** Compose bakes the source into the API, worker and web images
rather than bind-mounting it, so `docker compose restart` after a code change
runs the *old* code and silently looks like the change did not work. Any source
change needs `docker compose build <service> && docker compose up -d <service>`.

---

## 2. Stack

| Layer | Choice |
|---|---|
| Frontend | Next.js 15 (App Router), **Tailwind CSS v4.3** (CSS-first, no config file), shadcn/ui |
| Backend | Node 22/24, Express 4, TypeScript, REST/JSON, OpenAPI 3 |
| Database | PostgreSQL 16 + **Prisma 7.9** (query compiler + `@prisma/adapter-pg` driver adapter) |
| Async | Redis 7 + BullMQ |
| AI | Gemini (optional, off by default) with a deterministic rule engine as the floor |
| Auth | JWT + bcrypt + RBAC enforced in Express |
| Infra | Docker Compose (6 services) |
| Tests | Vitest + Supertest |

Backend TypeScript runs **directly via `tsx`** — no build step. Typechecking
still covers every workspace.

### Two version-specific gotchas that have bitten twice

1. **`prisma generate` after every schema enum change**, or you get
   `Invalid value for argument 'status'. Expected ApplicationStatus.`
2. **Tailwind v4 has no `tailwind.config.ts`.** Tokens live in `@theme inline`
   inside `apps/web/app/globals.css`.

---

## 3. Repository layout

```
govflow-sih-demo/
├── apps/
│   ├── api/                    Express API — routes, middleware, OpenAPI doc
│   └── web/                    Next.js UI — citizen / officer / admin consoles
├── services/mock-departments/  One service, three simulated registries (:5001)
├── workers/workflow-worker/    BullMQ consumer executing workflow steps
├── packages/
│   ├── contracts/              Enums, CDM (Zod), field mappings, SERVICE CATALOGUE,
│   │                           department registry, env config
│   ├── connector-sdk/          BaseConnector, RestConnector, CsvConnector,
│   │                           mapping engine, error classification
│   └── core/                   Workflow engine, validation, documents, audit,
│                               exceptions, SLA, metrics, Prisma client
├── prisma/                     schema.prisma + seed.ts
├── prisma.config.ts            Prisma 7 config (datasource URL + seed command)
├── data/legacy/                beneficiaries.csv  (the legacy department)
├── data/documents/             Synthetic certificates (committed; demo uploads these)
├── tests/                      unit/ + integration/
├── docs/                       architecture.md, api.md, workflows.md, demo.md,
│                               arch.png, services.png
└── docker/                     Dockerfile.node, Dockerfile.web, entrypoint-api.sh
```

`packages/core` is an addition to the originally-specified layout: the workflow
engine must be callable from both the API (enqueue/read) and the worker
(execute), so it lives in one place.

---

## 4. What is built

### 4.1 Connector framework — the core of the project

Four connectors behind one `DepartmentConnector` interface. The divergence
between them is deliberate: it is the interoperability problem being solved.

| Connector | Transport | Schema style | Auth | Keyspace | Yields |
|---|---|---|---|---|---|
| Identity | REST | `camelCase` | API key header | `CIT-####` | name, dateOfBirth, district, gender, identityVerified |
| Income | REST | `snake_case` | Bearer token | `INC-####` | name, annualIncome, incomeYear, currency, certificateNumber |
| Education | REST | third convention | HTTP Basic | `STU-####` | name, institution, educationStatus, course, academicYear, percentage |
| Legacy | **CSV file** | flat file | file access | `BEN####` + `citizen_ref` | name, annualIncome, verificationStatus, beneficiaryNumber, lastUpdated |

Every connector runs the same pipeline:

```
fetch (own auth + timeout)
  → schema-validate the RAW payload (Zod, upstream contract)
  → apply declarative field mapping
  → normalise (trim, titleCase, stripCurrency, date dialects)
  → validate against the common data model (Zod)
  → quality checks (non-fatal warnings)
  → log the call to ConnectorLog
  → return normalised facts
```

**All connectors are `GET`-only.** There is no write-back. (See §7.)

Normalisation examples that actually run: `"1,95,000"` → `195000`;
`"  KOLHAPUR "` → `"Kolhapur"`; `"18/04/2026"` → `2026-04-18`.

**Dependency rule:** department-specific schemas exist only in `connector-sdk`
and the mappings in `contracts`. Nothing in `core` references `applicant_id` or
`student_no`.

### 4.2 Service catalogue — three services, zero extra connectors

| Service | Departments | Steps | SLA | Distinguishing policy |
|---|---|---|---|---|
| `SCHOLARSHIP` | Identity, Income, Education, Legacy | 9 | 5 days | ceiling ₹2,50,000 · active enrolment · 2 required documents |
| `INCOME_CERTIFICATE` | Identity, Income | 7 | 3 days | an *issuance*, not a benefit → no means test, no required documents |
| `RATION_CARD` | Identity, Income, Legacy | 8 | 7 days | ceiling ₹1,80,000 · **duplicate-benefit check** against the legacy register |

All three compose from one shared step vocabulary. **A test asserts that no
service can introduce a department outside the registry**, so "adding a service
adds no integration" is enforced rather than claimed.

Application numbers carry the service: `GF-SCH-`, `GF-INC-`, `GF-PDS-`.

### 4.3 Workflow engine

Nine step types; each service selects and orders a subset. Steps are
materialised as persisted `WorkflowStep` rows up front, so the timeline shows
future steps as `PENDING` rather than guessing.

`POST /api/applications` returns in milliseconds with `PROCESSING` — **no
department is contacted on the request thread.** Each step is one BullMQ job;
the engine persists the outcome and enqueues the next, so the chain is
restartable from the database alone.

**Retry policy** (`WORKFLOW_MAX_ATTEMPTS=3`, exponential backoff from 1500ms):

| Failure | Kind | Retryable |
|---|---|---|
| connection refused / timeout / HTTP 5xx / CSV missing | transport | yes |
| 404 / 401 / 4xx / malformed body / schema violation | contract | no |

Exhausted retries → step `REQUIRES_REVIEW`, `Exception` row raised, officers
notified, citizen told in plain language. **Blocking** departments suspend the
workflow; **non-blocking** ones (Legacy) record the failure and continue.

### 4.4 The three gates (added late; see §6 for why)

1. **Consent gate** — no department contacted until every scope for that service
   is `GRANTED`. Provably: with consent outstanding, `ConnectorLog` and
   `NormalizedRecord` are both empty.
2. **Document gate** — `DOCUMENT_VALIDATION` refuses to complete if the
   service's `requiredDocuments` are absent. Parks on the citizen.
3. **Data-quality routing** — findings are routed by *who can resolve them*.

### 4.5 Citizen-vs-officer routing

New status **`AWAITING_CITIZEN_ACTION`** (distinct from `REQUIRES_REVIEW`).

| Blocker | Resolvable by | Routes to |
|---|---|---|
| `MISSING_DOCUMENT`, missing consent | Citizen | **back to citizen** |
| name/income mismatch, eligibility hint, duplicate flag | Officer judgement | forward to officer |
| department unreachable | Admin / time | park + exception |

Citizen-blocked applications are **excluded from the officer queue** but still
counted (`officerMetrics.awaitingCitizen`) so nothing is invisible.

### 4.6 Validation — advisory, never decisive

Deterministic rule engine, **always runs**, before the AI key is even checked:

- name mismatch across sources (distinguishes abbreviation from different person)
- income disagreement (>10% between two government sources = HIGH)
- identifier crosswalk failure
- missing sources / missing fields (only for departments the service consults)
- missing required documents
- stale data (income assessment year)
- document field mismatch vs registries
- **document type mismatch** (advisory classifier)
- eligibility hints (income ceiling, enrolment status, age bounds)
- **duplicate-benefit flag** (ration card only)

`GEMINI_API_KEY` is optional. With a key, Gemini reviews the same evidence and
may *add* observations; it can never remove a rule finding. Without one, the
report is identical minus AI commentary and labelled
*"AI service unavailable — rule-based validation used."*

**AI never decides.** `recordOfficerDecision` requires an officer user id. There
is no code path from a model to `APPROVED`.

### 4.7 Document processing — entirely local by default

Verified: **zero network references** in `ocr.ts`, `extract.ts`, `classify.ts`,
`dates.ts`. Exactly one outbound AI call exists in the codebase
(`validation/gemini.ts`), gated behind `isAiEnabled()` at both call sites.

```
OCRProcessor        text layer · PDF text-stream scan · optional Tesseract slot
extractFieldsWithRules   regex → name, cert no., income, date, institution, course, district
classifyDocument         weighted keyword scoring → is this the declared type?
```

**Raw document text is never persisted** — `textPreview` lives only in memory.
Only the structured fields and the `typeCheck` verdict are stored, because a
sanctioned benefit must be defensible years later.

Document type classification is **advisory**: it flags
`DOCUMENT_TYPE_MISMATCH` for the officer and never blocks. Every ambiguous case
(no text layer, unrecognisable content, narrow scoring margin, `OTHER`) resolves
to "matches" — wrongly blocking a citizen is far worse than costing an officer a
moment.

### 4.8 Security

- bcrypt password hashing, JWT (HS256, 12h, issuer `govflow`)
- **role re-read from the database on every request** — a role change takes
  effect immediately, not at token expiry
- Ownership checks return **404 not 403**, so an id cannot be probed
- Upload allow-list (txt/pdf/png/jpeg), 5MB cap, **server-generated filenames**
- Audit log: 28 action types; never document contents, credentials or secrets
- Errors: stable codes, safe messages, no stack traces to clients

### 4.9 Demo scenarios (all verified in Docker)

1. **Happy path** — apply → 4 departments → documents → officer approves
2. **Data mismatch** — Identity `Rohan Prajapati` vs Education `Rohan P.`,
   graded LOW because it recognises abbreviation
3. **Department outage** — admin breaks Income *for real* via the mock control
   plane → retry 1/3 → 2/3 → 3/3 → exception → restore → resume → completion
4. **Legacy ingestion** — CSV with no API through the identical connector contract

---

## 5. What GovFlow is and is not — the settled position

This was argued out at length. It is the most important section.

### Is

- **Originates** applications — the citizen applies here, once
- **Pre-fills** from registries that already hold the answers *(designed, not built)*
- **Brokers consent** — purpose-bound, revocable, auditable
- **Translates** four schemas, four keyspaces, four auth methods into one model
- **Orchestrates** the workflow across departments
- **Retries, raises exceptions, notifies**
- **Reconciles** sources and flags disagreement
- **Detects duplicate claims across schemes** — structurally impossible inside
  any one department
- **Assembles evidence** onto one officer screen
- **Logs every access** with the consent that authorised it

Holds: the application, workflow state, consent ledger, audit trail, and the
evidence a decision rested on.

### Is not

- Not a citizen database — fetches at the moment of need
- Not a document store — DigiLocker holds documents; we hold a reference + hash
- Not an identity provider — MeriPehchaan authenticates; we are a relying party
- Not a payment handler — money goes to the treasury directly
- Not an issuing authority — departments issue certificates
- Not an employer of officers — they are departmental; we are their console
- Not a decision-maker
- Not a portal — we ship one as a *reference client*; departments may use their own
- Not a tracker — tracking is a by-product of holding the workflow

### The invariant

> **If GovFlow were deleted tomorrow, nothing authoritative should be lost.**

The moment something exists *only* in GovFlow, it has stopped being middleware.

### The one-liner

> We don't replace any government system. We do the coordination between them
> that today happens by email.

### Where we redirect, and where we don't

| Redirect to | For | Why |
|---|---|---|
| National SSO (MeriPehchaan) | login | only they can prove who you are |
| Treasury gateway | payment | money must land in a government account |
| DigiLocker | documents | the issuer's signed copy is authoritative |

We do **not** redirect for applying, form-filling, tracking, or officer review.
Redirect for **transactions that need an authority**; keep **coordination**,
because no authority owns it.

*(None of the three redirects are built yet — see §7.)*

---

## 6. Design critiques raised, and how each resolved

| Critique | Resolution |
|---|---|
| A step marked COMPLETE with no basis | **Fixed** — document gate; the step parks instead of completing |
| Handing incomplete applications to an officer | **Fixed** — `AWAITING_CITIZEN_ACTION` + routing by who can resolve |
| No check that the file matches the declared type | **Fixed** — advisory classifier, never blocks |
| "We're middleware" vs "we hold applications" | We hold **coordination**, never **custody** |
| "Don't hold data" vs "pre-fill needs data" | Fetch-on-demand; store only the post-decision evidence snapshot |
| "For the officer" vs "citizens apply here" | **Both** — citizens originate, officers get an assembled file |
| "Everything redirects, so what's left?" | Transactions have owners; the space *between* them does not |
| "Verification complete" but no predicate | Partly fixed. **Identity binding is still assumed, not proven** |
| Unified tracking as the USP | Rejected — portals already track. **Pre-fill is the USP** |
| Is GovFlow just a tracker? | Only if it *federated*. It **originates**, so no |
| Does pre-fill require storing user data? | **No** — that would make us a duplicate database |
| Chatbot? | **Recommended against** — the UI should already answer those questions |

### 6.5 Phase A — coherence fixes (2026-09-18)

Three defects, none of them features, all of them things a judge would ask about.

**1. Officers were not scoped to their department.** Every officer saw every
application, so a scholarship officer could approve a ration card. Ownership
already existed as data (`ServiceDefinition.owningDepartment`), so the fix was
to read it: `serviceTypesOwnedBy(departmentCode)` in contracts, an
`officerServiceScope()` middleware helper, and `assertOfficerScope()` on every
officer-addressable resource — queue, detail, approve, reject, resume, review
notes, exception list, exception resolve. Metrics are scoped by the same set,
because a header reading "14 awaiting review" above a list of four is its own
kind of bug.

Two decisions worth keeping:
- **Out-of-scope is 404, not 403.** A 403 confirms the application number
  exists. This matches how a citizen is refused someone else's application.
- **An officer with no department is refused, not widened.** A missing
  department is a misconfigured account; treating it as "sees everything" is
  exactly the failure mode being fixed.

Admins stay unrestricted — they operate the platform rather than adjudicate on
it. The seed now creates one officer per owning department (Education →
scholarships; Revenue → income certificates and ration cards), and seeded
decisions, notes, exception resolutions and notifications are attributed
through `officerFor(service)` so the demo's own history obeys the rule the API
now enforces.

**2. The identifier crosswalk was string surgery.** `toDepartmentIdentifier`
took `CIT-1001`, stripped the prefix and pasted on `INC-`. It worked only
because the synthetic dataset aligned the suffixes. Against a real registry
that logic would confidently fetch and show an officer *somebody else's*
income record.

Replaced by an `IdentifierLink` table — `(citizenId, departmentCode) →
externalIdentifier`, plus a `source` (`SEED` / `SSO_ASSERTION` /
`OFFICER_ASSERTED`) and `verifiedAt`. `source` is deliberately not optional:
an unattributed link is indistinguishable from a guess. The runtime path is
`resolveDepartmentIdentifier()`, which throws a **non-retryable**
`IDENTIFIER_NOT_LINKED` connector error when no link exists — retrying cannot
establish a fact about a citizen, so it surfaces as an exception rather than
three pointless attempts.

The old helper survives as `deriveSeedIdentifier`, used only by the seed and
test fixtures to *populate* the table, with a comment saying why it must never
be used at runtime.

This is also the seam Phase B plugs into: mock SSO writes
`source: SSO_ASSERTION` rows and nothing else in the engine changes.

**3. The pre-fill overclaim.** `/applications/new` said *"Read from your
verified profile. Nothing here is re-keyed."* Neither half was true — it renders
our own `Citizen` row and nothing is re-fetched. Now states that live registry
pre-fill is not enabled yet.

Verified end to end: Education officer sees 9 scholarships, Revenue officer
sees 4 certificate/ration files, admin sees 13; cross-department read, approve
and note all return 404; all four connectors resolve through stored links
(`CIT-1001 → INC-1001 / STU-1001`, `source: SEED`); a live workflow completes
every department lookup and parks correctly at the document gate. 10 new tests
in `tests/integration/department-scope.test.ts`; suite 103 → 122.

### Principles extracted

1. **Block on objectively determinable absence; advise on subjective mismatch.**
2. **Pre-fill is the promise; reconciliation is the proof.**
3. Route blockers by **who can resolve them**, not by severity.
4. Connector quality checks report **facts**, never scheme eligibility
   (per-service policy decides that).
5. **Look identifiers up, never derive them** — and record where each link came
   from. A link with no provenance is a guess wearing a table.
6. **Refuse a misconfigured account; never widen it.** Missing scope means no
   access, not total access.

---

## 7. Known gaps — stated plainly

| Gap | Impact |
|---|---|
| **No write-back.** Every connector is `GET`-only. The officer approves and nothing leaves GovFlow. | Biggest architectural hole. Makes it *feel* like a tracker. |
| **No pre-fill.** The applicant block on `/applications/new` displays our own `Citizen` row, not live registry data. | The stated USP does not exist yet. The wording no longer overclaims (Phase A). |
| **No form schema.** No `formSchema` anywhere; no real source exists across Indian departments today. | Needed for pre-fill. |
| **Identity binding is assumed.** We trust our own `User.citizenId` link. Every `IdentifierLink` is `source: SEED`, which is honest but carries no assurance. | Pre-filling on an unverified binding is a data-leak shape, not just untidy. The crosswalk is now recorded and attributed (Phase A), so this gap is visible rather than hidden — but it is not closed. |
| **Documents stored as files on disk.** Should be a DigiLocker reference + hash. | Contradicts the stated position. |
| **No SSO, no payments.** | Two named PS/flow items. |
| **Gemini path never exercised.** No key was ever configured. | Unverified. Rule path is what the tests prove. |
| **AI privacy question unresolved.** Enabling Gemini sends name, DOB, district, income, institution to a third-party API. | Parked, not answered. |
| No jurisdiction/district scoping, no multi-level approval, no grievances, no MDM dedupe, no rate limiting, JWTs in `localStorage`, `prisma db push` not migrations. | Prototype limitations, documented in README §19. |

---

## 8. Agreed target flow

```
ONBOARDING (once)
  Citizen authenticates via national SSO → verified identity binding
  No data transferred; we hold an identifier, not a profile

APPLICATION
  1. Pick a service                → DRAFT created
  2. Grant consent                 → recorded against the draft
  3. GovFlow queries registries    → LIVE, read-only, consent-gated
  4. Form renders PRE-FILLED       → each field badged with its source
  5. Citizen fills the 3-4 fields no registry holds
  6. Submit                        → DRAFT → SUBMITTED, workflow starts

PROCESSING
  7. Evidence gathered + reconciled
  8. Gates: consent → documents → data quality
       citizen-fixable → back to citizen
       judgement calls → forward to officer
  9. Payment (if any) → redirect to treasury, verify reference server-side

DECISION
  10. Departmental officer decides — our console, or their system via our API
  11. Write-back to the department's system of record
  12. Department issues its own reference; we show THAT as authoritative
```

Two crosswalks, same pattern:
`CIT-1001 ⇄ INC-1001 ⇄ STU-1001` (identity) and
`GF-SCH-2026-00011 ⇄ MH/SCH/2026/88213` (application reference).

The mapping engine runs three directions — one built, two not:

```
department → CDM     ingestion    ✅ built (4 mappings)
CDM → form field     pre-fill     ❌ trivial
CDM → department     write-back   ❌ the real prize
```

---

## 9. Roadmap (agreed priority)

| # | Work | Effort | Why |
|---|---|---|---|
| ~~1~~ | ~~Officer scoped to owning department~~ | done | Phase A — see §6.5 |
| 2 | Mock SSO / identity binding | ~2–3h | Prerequisite for *safe* pre-fill. Now has somewhere to land: it populates `IdentifierLink` with `source: SSO_ASSERTION` |
| 3 | Pre-fill + form schema + DRAFT flow | ~3–4h | **The USP**; requires the whole stack beneath it |
| 4 | Officer time-saved metric | ~1h | Highest pitch return per hour |
| 5 | Write-back connector | larger | Turns a viewer into infrastructure |
| 6 | Payment step (mock treasury gateway) | ~2h | Reuses the citizen-gate pattern |

2-before-3 is the correct engineering order. 3-before-2 is defensible for demo
value, but the identity caveat must then be stated out loud.

---

## 10. Running it

### Full Docker

```bash
docker stop booking-db booking-redis     # free :5432 / :6379 first
docker compose up --build                # migrates + seeds automatically
```

UI http://localhost:3000 · API http://localhost:4000 · Swagger /docs · mocks :5001

### Local dev (4 processes + 2 containers)

```bash
npm install
cp .env.example .env
npm run infra:up          # postgres + redis only
npm run prisma:generate
npm run prisma:push
npm run db:seed
npm run dev               # mocks + api + worker + web
```

### Demo credentials — password `Password@123`

| Role | Email |
|---|---|
| Citizen | `rohan.prajapati@example.gov.in` — **no application; use for live demo** |
| Officer | `officer@govflow.gov.in` — Education Dept; sees **scholarships only** |
| Officer | `officer2@govflow.gov.in` — Revenue Dept; sees **income certificates + ration cards only** |
| Admin | `admin@govflow.gov.in` — unrestricted |

Other seeded citizens: `vikram.shinde@` (name + income mismatch),
`meera.iyer@` (connector failure), `aditya.sharma@` (approved).

### Commands

```bash
npm test                  # 122 tests
npm run typecheck
npm run lint
npm run db:seed -- --force        # wipe + reseed
docker compose exec api npx tsx prisma/seed.ts --force
```

---

## 11. Operational traps (each cost real time)

1. **Stale host worker processes.** Orphaned `workflow-worker` processes on the
   host connect to the same Redis and steal jobs, running old code — producing
   symptoms that look like a broken rebuild. Check before suspecting the image:
   ```bash
   ps -eo pid,etimes,cmd | grep -E "tsx|preflight.cjs" | grep -v grep
   ```
2. **`prisma generate` after every schema enum change.**
3. **Never `pkill -f` with a pattern that appears in your own command** — it
   kills the shell (exit 144).
4. **`NEXT_PUBLIC_API_URL` is baked at build time**; rebuild the web image after
   changing it.
5. **Compose reads `.env`** for `${VAR}` substitution, but only variables
   referenced in `docker-compose.yml` reach containers.
6. **Prisma 7 refuses destructive commands when it detects an AI agent** — run
   `db:reset` yourself in a normal shell.

---

## 12. Positioning for the demo

**Lead with the officer console, not the citizen portal.** "Five inboxes and a
phone become one screen" survives every redirect objection.

Honest ratings given during review:

- **As an SIH entry: 8/10** — addresses the PS completely, actually built and
  working, most entries at this stage are a Figma file
- **As a real product: 4/10** — blockers are political not technical; API Setu
  is the same category with a state sponsor
- **As engineering: 8/10** — the connector abstraction, consent gate and routing
  are better than typical

The gap between 8 and 4 is not fixable by better code.

### Lines that hold up

> Three services, three different workflows, three different sets of
> departments. Four connectors, written once.

> Payments go to the treasury. Documents stay in DigiLocker. Identity stays with
> MeriPehchaan. The decision stays with the department. GovFlow does the part
> nobody owns — the coordination between them.

> GovFlow isn't a portal — it's what portals plug into.

---

## 13. Real-world integration notes

Verified against the **DigiLocker Authorized Partner API Specification v2.0**
(Feb 2021, NeGD/MeitY, hosted at `meripehchaan.gov.in`):

- Standard OAuth 2.0 / OIDC with PKCE (cites RFC 6749, 7636, 8252)
- `GET /public/oauth2/1/authorize` → `POST /public/oauth2/2/token`
  (returns `access_token` + OIDC `id_token`)
- `GET /public/oauth2/2/files/issued` → issued documents with `issuer`,
  `doctype`, `uri` (e.g. `in.gov.cbse-HSCER-201412345678`)
- `GET /public/oauth2/1/xml/uri` → **machine-readable XML** with an `hmac`
  response header (SHA256, keyed on client secret)

**Consequence: with DigiLocker, OCR disappears entirely.** Certificates arrive
as signed structured XML. Parsing becomes the legacy-paper fallback.

**Blocker:** `client_id`/`client_secret` come from the Partners Portal; the spec
documents production URLs only, with no public sandbox. Hence the simulated
services. *(Onboarding terms change — verify before quoting in a presentation.)*

India's national SSO is **MeriPehchaan** (citizens) / **Jan Parichay**
(government employees). GovFlow would be a relying party, never an IdP.

---

## 14. AI configuration

```bash
echo 'GEMINI_API_KEY=your-key' >> .env
docker compose up -d --force-recreate api worker     # env read at boot
```

Confirm live: `/api/admin/health` → `ai.configured: true`; validation badge
flips from grey *Rule-based* to blue *AI-assisted*; the startup warning stops.

**Recommendation: demo without it.** The mismatch shown is caught identically by
the rule engine, and *"this works with no AI configured, and AI never decides
eligibility"* is a stronger claim than a badge. Also: the path is unverified,
needs outbound network on venue wifi, and the privacy objection is unresolved.

For a structural guarantee rather than a default, add a hard `AI_ENABLED=false`
deployment flag that makes the Gemini module unreachable.

---

## 15. Key files

| Path | Why it matters |
|---|---|
| `packages/contracts/src/workflow.ts` | Service catalogue — steps, policy, consent scopes |
| `packages/contracts/src/departments.ts` | The four departments and their divergence |
| `packages/contracts/src/mapping.ts` | Declarative normalisation rules |
| `packages/connector-sdk/src/base-connector.ts` | fetch→validate→map→normalise, once |
| `packages/core/src/workflow/engine.ts` | Step execution, gates, retry/exception, decision |
| `packages/core/src/validation/rules.ts` | Deterministic mismatch detection |
| `packages/core/src/documents/classify.ts` | Advisory document-type check |
| `apps/api/src/middleware/auth.ts` | JWT + RBAC + ownership |
| `prisma/schema.prisma` | 14 models |
| `docs/demo.md` | Click-by-click script with talking points |
