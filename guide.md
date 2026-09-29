# GovFlow — Demo Video Guide

For whoever is recording the demo. Everything here has been verified against a
running build. Read §1 and §2 before you start filming; they decide what the
video is actually *about*.

**Target runtime: 5–6 minutes.** A tighter 3-minute cut is marked at the end.

---

## 1. What GovFlow is

> **GovFlow is an interoperability and workflow layer that sits between a
> citizen and the several government departments a single service actually
> depends on.**

A scholarship application is not one transaction. It needs an identity record,
an income assessment, an enrolment confirmation, and a check against an old
beneficiary register. Four systems, four schemas, four ways of identifying the
same person, and today a citizen re-types everything into a form while an
officer chases each department by hand.

GovFlow does three things:

1. **Connects** — one connector per department, normalising each into a common
   data model. REST and CSV behave identically to everything downstream.
2. **Pre-fills** — the citizen's form comes back already answered from the
   registries that hold the data, each value attributed to its department.
3. **Coordinates and hands back** — it orchestrates the workflow, gives the
   officer one assembled file, and delivers the decision to the department
   that owns the outcome.

### The one line that matters

> **GovFlow holds coordination, never custody.**

It is not a new database of citizens. It does not issue documents, hold money,
or become the record of anything. The invariant we designed to:

> **If GovFlow were deleted tomorrow, nothing authoritative would be lost.**

Say this out loud in the video. It is the answer to the sharpest question a
judge can ask, and the product is actually built to survive it.

### Say this once, early

*"Every department in this demo is simulated and holds synthetic data. No real
government system is connected, and no real person's data appears anywhere."*

Do not skip this. It costs four seconds and it protects every other claim.

---

## 2. What the video is about

**The USP is pre-fill, and the proof is reconciliation.**

Pre-filling a form is a convenience — plenty of products claim it. What makes
it *evidence* is that at decision time an officer can see three things side by
side:

| | |
|---|---|
| **Shown** | what the registry said when the citizen opened the form |
| **Submitted** | what the citizen actually sent |
| **Registry now** | what the registry says at the moment of decision |

Two mismatches look identical on the surface and mean opposite things:

- The citizen's figure differs from a registry that never moved → **the citizen
  changed it.** Worth a look.
- The citizen's figure matches what they were shown, but the registry has since
  moved → **the registry changed and the applicant did nothing wrong.**

You cannot tell those apart unless you stored what the citizen was shown. That
is the single most defensible idea in the project, and the reconciliation
screen is the shot to build the video around.

Second-strongest: **the decision leaves GovFlow.** The officer approves, and
the owning department records it under *its own* reference number, which is
what GovFlow then displays. That is the custody invariant made visible rather
than merely asserted.

---

## 3. Before you record

```bash
cd ~/Desktop/govflow-sih-demo
docker compose up -d                              # six containers
npx tsx prisma/seed.ts --force                    # pristine demo data
curl -X DELETE localhost:5001/api/__decisions     # clear department receipts
```

Wait for all six to report healthy:

```bash
docker compose ps
```

Then check three URLs load before you hit record:

| URL | What it is |
|---|---|
| http://localhost:3000 | The app |
| http://localhost:4000/docs | Swagger, 45 endpoints |
| http://localhost:5001 | The simulated departments |

**Accounts — password `Password@123` for every one:**

| Role | Email | Use for |
|---|---|---|
| Citizen | `rohan.prajapati@example.gov.in` | The live run. **No application yet** — this is the point. |
| Officer (Education) | `officer@govflow.gov.in` | Scholarships only |
| Officer (Revenue) | `officer2@govflow.gov.in` | Income certificates + ration cards |
| Admin | `admin@govflow.gov.in` | Connector health, failure simulation |

**Two browser profiles or windows** — one signed in as the citizen, one as the
officer. Switching accounts on camera wastes fifteen seconds and breaks the
narrative.

### Recording notes

- Zoom the browser to **110–125%**. Default text is too small on video.
- The reconciliation table is the hero shot. Make sure all five columns fit
  without horizontal scrolling before you record.
- Several pages poll every few seconds. Pause a beat after each action so the
  new state lands on camera rather than mid-transition.

---

## 4. The walkthrough

### Segment 0 — Identity (≈40s)

On the login page, click **Continue with MeriPehchaan (Simulated)**.

You land on a visibly different site — a simulated national identity provider.
It names exactly what GovFlow is asking for. Pick **Rohan Prajapati**. You come
back signed in.

Go to **Profile → How departments identify you**:

| Department | Their identifier | Source |
|---|---|---|
| IDENTITY | `CIT-1001` | Verified by MeriPehchaan |
| INCOME | `INC-1001` | Verified by MeriPehchaan |
| EDUCATION | `STU-1001` | Verified by MeriPehchaan |
| LEGACY | `CIT-1001` | Verified by MeriPehchaan |

> *"One person, four departments, four different numbers. GovFlow doesn't
> derive these from each other — real government keyspaces don't line up. It's
> told them by the identity provider, and it records who said so and when.
> That's what makes the next screen legitimate rather than a guess."*

**Worth showing if you have the seconds:** sign in with the password instead
and the same panel reads *Demo data* with no verification date, plus a warning.
The contrast makes the provenance point land without you having to explain it.

---

### Segment 1 — Pre-fill (≈70s) · **the USP**

As the citizen: **New application → Merit-cum-Means Scholarship → Continue.**

**Authorise access.** Three departments, each with a stated purpose.

> *"Nothing is fetched until the citizen authorises it. Untick one and that
> department is never contacted — the field just comes back blank for them to
> fill in themselves."*

Click **Continue**. The form comes back **answered**:

> **8 of 8 answers came from the departments.**

Scroll it slowly. Point out:
- Each field badged with the department that supplied it
- Identity fields **locked** — only the registry can change those
- **Amount applied for** is empty, because no department holds it

> *"The applicant types one number — the amount they're asking for. Everything
> else came from departments that already had it."*

**Now the important bit.** Change **Annual family income** from `180000` to
`98000`. A `changed` badge appears next to the field. Submit.

---

### Segment 2 — Reconciliation (≈80s) · **the payoff**

Switch to the **Education officer** window. Open the application you just
submitted → the **Form** tab.

| Field | Shown to applicant | Submitted | Registry now | Verdict |
|---|---|---|---|---|
| Annual family income | 180,000 | **98,000** | 180,000 | Changed by applicant |
| everything else | … | … | … | Matches registry |

**The narration this whole video exists for:**

> *"Two mismatches can look identical. If the applicant's figure differs from a
> registry that never moved, the applicant changed it. If it matches what they
> were shown but the registry has since moved, the registry changed and they
> did nothing wrong. Without storing what they were shown, an officer cannot
> tell those apart. So we store it."*

Add:

> *"And GovFlow reports the difference — it doesn't decide what it means. A
> changed figure might be an applicant correcting an out-of-date assessment.
> That judgement belongs to the officer."*

**Pre-seeded alternative:** `GF-SCH-2026-00003` (Vikram Shinde) already carries
this — income shown `195,000`, submitted `107,250`, registry `195,000`, one
field flagged and seven matching. Use it if you'd rather not type on camera, or
as a second example.

---

### Segment 3 — The decision leaves (≈60s)

Still as the officer, **approve** the application with a short note.

Within a second or two the **Evidence** tab shows:

> **Department of Higher Education (Simulated)** · Recorded
> Their reference `EDU/SCH/2026/00001`

Then cut to a terminal:

```bash
curl -s localhost:5001/api/__decisions | python3 -m json.tool
```

The department holds the sanction under **its own** reference, against **its
own** identifier for the citizen (`STU-1001`), with the officer recorded as an
opaque `GF-OFF-…` handle rather than a name.

> *"That reference is the one that matters. If GovFlow were deleted tomorrow,
> the sanction would still exist — in the department authorised to grant it. We
> hold coordination, never custody."*

---

### Segment 4 — It fails honestly (≈50s)

This segment is worth more than it looks. Anyone can demo a happy path.

As the **admin**: **Connectors → Education Department → Simulate failure
(500)**. Then approve a different application as the officer.

- The application is still **APPROVED**, and final.
- The receipt panel reads **Not delivered**, with a retry count.
- An **officer exception** is raised.

> *"The officer decided; the department is down. Those are different facts, and
> we keep them separate — a departmental outage must never look like an
> undecided applicant. Delivery retries on its own, and it's idempotent, so a
> retry can't sanction the same file twice."*

Turn the department back on and show it deliver.

---

### Segment 5 — Two officers, two queues (≈30s)

Sign in as `officer2@govflow.gov.in`.

- Education officer: **9 scholarships**
- Revenue officer: **4** income certificates and ration cards
- Admin: **13**

> *"An officer works for one department, and a department owns some services
> and not others. A Revenue officer has no standing to approve a scholarship,
> so they never see one. Out-of-scope requests return 'not found' rather than
> 'forbidden' — a 'forbidden' would confirm the application exists."*

---

### Segment 6 — Closer: what it saved (≈40s)

Officer dashboard → **Effort avoided**.

> *"Two numbers, and we keep them honest by keeping them apart. The counts are
> measured — this many lookups really completed, this many answers really came
> from a registry. The minutes per task are our assumption, they're printed
> right there, and they're a config value. Halve them and the estimate halves.
> If you think twelve minutes to ring a department is generous, change it and
> watch the number move. That's the difference between a claim and evidence."*

End on the invariant:

> *"GovFlow connects departments, fills the form, coordinates the workflow, and
> hands the decision back. It never becomes the record. Delete it tomorrow and
> nothing authoritative is lost."*

---

## 5. The 3-minute cut

If you need it shorter, keep **Segments 1, 2 and 3** and open with thirty
seconds of §1. Pre-fill → reconciliation → the decision leaving is the complete
argument. Drop 0, 4, 5 and 6 before you touch those three.

---

## 6. Do not show

- **The AI/Gemini path.** No key is configured and it has never been exercised.
  Everything you'll see runs on the deterministic rule engine, which is what
  the tests cover. Don't mention AI validation as a working feature.
- **An empty officer queue.** If you've approved everything, reseed.
- **The `questions.txt` file** if your editor is on screen — working notes.
- **Live external calls.** There are none, and that's a feature. Say the
  departments are simulated rather than implying anything is reaching the
  internet.

---

## 7. If something breaks mid-record

| Symptom | Fix |
|---|---|
| A page shows stale or missing data | Reseed: `npx tsx prisma/seed.ts --force` |
| A department is stuck failing | Admin → Connectors → restore, or `curl -X POST localhost:5001/__control/education -H 'content-type: application/json' -d '{"mode":"OFF"}'` |
| Department already holds your test decisions | `curl -X DELETE localhost:5001/api/__decisions` |
| A code change seems to have no effect | Compose bakes source into images: `docker compose build api worker web && docker compose up -d` |
| Ports 5432 / 6379 refuse to bind | Another project is using them. Stop it, then `docker compose up -d` |
| Everything looks wrong | `docker compose down -v && docker compose up -d --build`, then reseed. Takes a few minutes. |

---

## 8. Feature reference

Built in four phases. Useful if you want to mention something in passing or
answer a question after the video.

### Phase A — coherence

| Feature | What it does |
|---|---|
| Officer department scoping | An officer sees only the services their department owns |
| Stored identifier crosswalk | `CIT-1001 → INC-1001` is looked up, not derived from the string |
| Non-retryable missing-link error | No identifier on record fails immediately rather than retrying |

### Phase B — identity

| Feature | What it does |
|---|---|
| Simulated MeriPehchaan | OAuth2/OIDC subset: authorize, token, userinfo, discovery |
| SSO sign-in | GovFlow never sees a password |
| Identity binding | Asserted identifiers stored with a timestamp; re-binding to a different account is refused |
| Provenance panel | *Demo data* vs *Verified by MeriPehchaan*, per department |

### Phase C — pre-fill *(the USP)*

| Feature | What it does |
|---|---|
| Declarative form schemas | A form is data; each field declares which department fills it |
| DRAFT lifecycle | An inert application that holds consent, so pre-fill has somewhere to happen |
| Pre-fill | Answers the form from the registries, behind the consent gate |
| Per-field status | Consent-required / unavailable / not-held — a department that's down never produces a silent blank |
| Three-way reconciliation | Shown, submitted, registry-now, with seven distinct verdicts |

### Phase D — write-back

| Feature | What it does |
|---|---|
| Outbound connectors | The same mapping engine, in reverse |
| Department decision inboxes | Each issues its own reference format |
| Delivery as a separate step | With retries; an outage never looks like indecision |
| Idempotency | A retry after a timeout cannot sanction the same file twice |
| Declared capability | The legacy CSV has no inbox and says so, rather than pretending |

### Plus

| Feature | What it does |
|---|---|
| Time-saved metric | Measured counts kept strictly apart from assumed minutes |

**Scale:** 174 tests, 45 documented API endpoints, 17 data models, 4 connectors,
3 services, 6 containers.

---

## 9. Claims you can make, and how to phrase them

| Safe | Not safe |
|---|---|
| "Four simulated departments, four different schemas and auth methods" | "Integrated with government systems" |
| "Payload shapes modelled on government APIs; the data is synthetic" | "Real government data" |
| "A simulated national identity provider" | "MeriPehchaan integration" |
| "The rule engine does the validation; AI is an optional assist that's off" | "AI-powered validation" |
| "GovFlow never becomes the record of the decision" | "GovFlow issues the certificate" |

When in doubt, say **simulated**. The engineering is strong enough that it does
not need to be oversold, and a single overclaim is the fastest way to lose a
technical judge's trust in everything else you said.
