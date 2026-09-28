# GovFlow — Demo script

Four scenarios, roughly **8–10 minutes** end to end. Every action below hits a real
backend operation; nothing is staged in the UI.

## Before you start

```bash
docker compose up --build          # schema and seed data apply automatically
```

Wait for `govflow-api` to log `starting API`, then open **http://localhost:3000**.

| Role | Email | Password |
|---|---|---|
| Citizen | `rohan.prajapati@example.gov.in` | `Password@123` |
| Officer (Education) | `officer@govflow.gov.in` | `Password@123` |
| Officer (Revenue) | `officer2@govflow.gov.in` | `Password@123` |
| Admin | `admin@govflow.gov.in` | `Password@123` |

Or click **Continue with MeriPehchaan (Simulated)** to sign in through the simulated
identity provider — no password, and it links the citizen's departmental identifiers
(see Demo 0). The two officers deliberately see **different queues**: Education owns
scholarships, Revenue owns income certificates and ration cards.

The login page lists these and fills them in on click. Rohan Prajapati is deliberately the
only seeded citizen **without** an application — he is the live-demo account.

Useful second tab: **http://localhost:4000/docs** (Swagger UI).

> Say this once, early: *every department here is simulated and holds synthetic data.*

---

## Demo 0 — Sign in through the identity provider (≈1 min)

**Point:** GovFlow is told how each department keys this citizen. It never guesses, and it
never sees a password.

1. On the login page, click **Continue with MeriPehchaan (Simulated)**.
2. You land on a visibly different site — a simulated national identity provider. It names
   what GovFlow is asking for: identity, date of birth, district, and the citizen's
   identifiers at four systems. Pick **Rohan Prajapati**.
3. You are returned signed in. Open **Profile → How departments identify you**.

| Department | Their identifier | Source |
|---|---|---|
| IDENTITY | `CIT-1001` | Verified by MeriPehchaan |
| INCOME | `INC-1001` | Verified by MeriPehchaan |
| EDUCATION | `STU-1001` | Verified by MeriPehchaan |
| LEGACY | `CIT-1001` | Verified by MeriPehchaan |

**What to say:** *"Four departments, four different numbers for one person. GovFlow doesn't
derive these from each other — real keyspaces don't line up. It's told them, and it records
who said so and when. That's what makes the next screen legitimate rather than a guess."*

If you sign in with the password instead, the same panel reads **Demo data** with no
verification date, and says so in a warning. That contrast is worth showing.

---

## Demo 1 — Pre-fill and reconciliation (≈4 min)

**Point:** the citizen barely types, and the officer can prove it.

1. Signed in as the citizen, go to **New application → Merit-cum-Means Scholarship →
   Continue**.
2. **Authorise access.** Three departments, each with a stated purpose. Leave them ticked
   and click **Continue**.
3. The form comes back **answered**: *"8 of 8 answers came from the departments."* Each
   field carries the department that supplied it. Identity fields are locked — only the
   registry can change those.
4. **Change the income** from `180000` to `98000`. A `changed` badge appears next to it.
   Submit.

**What to say:** *"The applicant typed one number — the amount they're asking for.
Everything else came from departments that already held it."*

5. Sign in as the **Education officer** → open the application → the **Form** tab.

| Field | Shown to applicant | Submitted | Registry now | Verdict |
|---|---|---|---|---|
| Annual family income | 180,000 | **98,000** | 180,000 | Changed by applicant |
| everything else | … | … | … | Matches registry |

**The line that lands:** *"Two mismatches can look identical. If the applicant's figure
differs from a registry that never moved, the applicant changed it. If it matches what
they were shown but the registry has since moved, the registry changed and they did
nothing wrong. Without storing what they were shown, an officer cannot tell those apart —
so we store it."*

`GF-SCH-2026-00003` in the seeded queue already shows this if you would rather not type.

---

## Demo 1b — Happy path (≈3 min)

**Point:** the citizen supplies almost nothing; GovFlow gathers the rest from four systems.

1. Sign in as the **citizen**. The dashboard is empty.
2. **New application.** Note the applicant block is pre-filled from the verified profile —
   nothing is re-keyed. Leave all three consent boxes ticked. Submit.
3. You land on the tracking page **immediately** with status `PROCESSING`. Say: *the API
   returned in milliseconds — it has not called a single department yet.*
4. Watch the timeline (it polls every 5 s). Within a few seconds: consent → identity →
   income → education → legacy cross-check → documents → data quality → officer review.
5. Open the **Verification** tab.
   - Four cards, one per source, each showing the mapping that produced it.
   - Scroll to **Common data model** — one record, every field tagged with its source.
   - Worth pausing on: income arrived from the department as the string `"1,80,000"`;
     the district arrived as `"  PUNE "`. Both are clean here.
6. Open the **Documents** tab. Upload two files from `data/documents/`:
   - `income-certificate-CIT-1001.txt` as *Income certificate*
   - `education-certificate-CIT-1001.txt` as *Bonafide / education certificate*

   Each upload shows the fields OCR + the extraction engine pulled out, and re-queues
   validation automatically.
7. Sign in as the **officer** (use a second browser profile or a private window).
   Review queue → open the application. Everything is on one screen: consolidated evidence,
   findings, documents, workflow, audit.
8. Write a justification and **Approve**.
9. Back as the citizen: status is `APPROVED`, the timeline is complete, and a notification
   has arrived. **Same database, two views.**

---

## Demo 1c — The decision leaves GovFlow (≈2 min)

**Point:** GovFlow is not where the decision lives. It is how the decision gets to where it
does live.

1. As the **Education officer**, approve any application in the queue.
2. Stay on the application. Within a second or two an **Recorded with the department**
   panel appears on the Evidence tab:

   > **Department of Higher Education (Simulated)** · Recorded
   > Their reference `EDU/SCH/2026/00001`

3. Prove it is really there — in a terminal:

```bash
curl -s localhost:5001/api/__decisions | python3 -m json.tool
```

The department holds the sanction under **its own** reference, against **its own**
identifier for the citizen (`STU-1001`), with the officer recorded as an opaque
`GF-OFF-…` handle rather than a name.

**The line that lands:** *"That reference is the one that matters. If GovFlow were deleted
tomorrow, the sanction would still exist — in the department authorised to grant it. We
hold coordination, never custody."*

**Show the failure too.** Set the Education Department to fail in the admin console, then
approve another application. The decision is still `APPROVED` and final; the panel reads
**Not delivered**, with the retry count and an officer exception raised. A departmental
outage never turns into an undecided applicant.

---

## Demo 2 — Data mismatch (≈1 min)

**Point:** GovFlow detects disagreement between departments — and grades it.

Still on the application from Demo 1, open **Issues** (as citizen or officer).

The Identity Registry holds `Rohan Prajapati`. The Education Department holds `Rohan P.`
GovFlow reports:

> **NAME_MISMATCH · LOW** — Possible name mismatch: EDUCATION records an abbreviated form
> of the name held by IDENTITY.

Two things to draw out:

- It is graded **LOW**, because the comparison recognises an abbreviated component rather
  than treating any difference as a red flag. A rule that cried wolf on every abbreviation
  would be ignored within a week.
- The panel says **Advisory only** and names the engine. Without a Gemini key it reads
  *"AI service unavailable — rule-based validation used"*, and the finding is identical.
  **The AI never decides.**

For a sharper mismatch, open the seeded application for **Vikram Shinde (CIT-1009)** in the
officer queue: the Income Department says ₹1,95,000, the legacy export says ₹2,05,000 — a
12% gap, graded **HIGH**, because a means-tested scheme turns on that number.

---

## Demo 3 — Department outage (≈3 min)

**Point:** the failure is real, the retries are real, and the recovery is real.

1. Sign in as the **admin** → **Connectors**. Four health cards.
2. On **State Income & Revenue Department**, choose `HTTP 503 — service unavailable` and
   click **Simulate failure**. The card turns red.

   Say: *this is not a flag GovFlow reads and short-circuits. The admin console reached
   into the simulated department's control plane. The next real HTTP call will genuinely
   fail.*

3. As the **citizen**, submit a **second** application with all consents.
4. Watch its timeline. Identity passes. Income shows `RETRYING` with a live
   `retry 1/3`, then `2/3`, then `3/3` — BullMQ exponential backoff, about 1.5s, 3s, 6s.
5. After the third attempt: step → `REQUIRES_REVIEW`, application → `REQUIRES_REVIEW`, and
   the citizen gets a plain-language notice naming the department.
6. As the **officer** → **Exceptions**: a `CONNECTOR_FAILURE`, severity `HIGH`, with
   `3/3 attempts`.
7. As the **admin** → **Monitoring** → connector call log: three `FAILURE` rows against
   `INCOME`, each with `UPSTREAM_SERVER_ERROR` and its duration. *Not a mock — those are
   the actual calls.*
8. **Connectors** → **Restore service** on Income.
9. As the **officer**, open the blocked application → **Re-run blocked step**. Income
   completes, and the workflow carries on to officer review.

Worth mentioning while it runs: the legacy CSV department is configured **non-blocking**.
If its export is missing, the failure is recorded and the workflow continues — losing a
cross-check should not stop a scholarship.

---

## Demo 4 — Legacy ingestion (≈1 min)

**Point:** a department with no API at all goes through the identical contract.

1. As the **admin** → **Connectors** → scroll to **Legacy CSV ingestion** → **Run legacy
   import**.
2. It reports rows read, rows normalised and any rejected with a reason.
3. Click **Test connector** on the legacy card. The raw CSV row appears beside the
   normalised record:

   | Raw CSV | → | Common data model |
   |---|---|---|
   | `beneficiary_no: "BEN1009"` | | `beneficiaryNumber: "BEN1009"` |
   | `applicant_name: "Vikram Shinde"` | | `name: "Vikram Shinde"` |
   | `yearly_income: "2,05,000"` | | `annualIncome: 205000` |
   | `citizen_ref: "CIT-1009"` | | `citizenId: "CIT-1009"` |

   *A file on disk and a REST API implement the same `DepartmentConnector` interface. The
   workflow engine cannot tell them apart.*

---

## Closers worth 30 seconds each

**Departments & mappings** (admin) — the full field-mapping table per department. *Adding
a department is a connector plus a mapping. No core code changes, and nobody migrates
their data.*

**Audit log** (admin) — filter by `DATA_ACCESSED`. Every cross-department read is recorded
with the consent scope that authorised it. Document contents and credentials are never
written here.

**Consent** (citizen) — a standing ledger of exactly who may query what, and why. Revoking
stops future lookups. Worth demonstrating that with a consent outstanding, the workflow
suspends and **zero** connector calls are made.

**Swagger** — `http://localhost:4000/docs`, every endpoint documented.

---

## If something misbehaves

| Symptom | Fix |
|---|---|
| Timeline stuck at `PROCESSING` | Worker down: `docker compose logs -f worker` |
| Every connector red | `docker compose restart mock-departments` |
| A department stuck red after the demo | Admin → Connectors → **Restore service** |
| Want a clean slate mid-demo | `docker compose exec api npx tsx prisma/seed.ts --force` |
| Login rejected | Reseed as above; the password is `Password@123` |

## Reset to a pristine demo state

```bash
docker compose down -v && docker compose up --build
```
