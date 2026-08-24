# GovFlow — API reference

Interactive documentation (Swagger UI): **http://localhost:4000/docs**
Machine-readable spec: **http://localhost:4000/openapi.json**

## Conventions

Every response uses the same envelope.

```jsonc
// success
{ "success": true, "data": { }, "error": null }

// failure
{ "success": false, "data": null,
  "error": { "code": "VALIDATION_ERROR", "message": "…", "details": [ ] } }
```

| Code | HTTP | When |
|---|---|---|
| `VALIDATION_ERROR` | 400 | Body or query failed schema validation |
| `UNAUTHORIZED` | 401 | Missing, malformed or expired token |
| `FORBIDDEN` | 403 | Authenticated, but the role is not permitted |
| `NOT_FOUND` | 404 | No such resource — also returned for resources you may not see |
| `CONFLICT` | 409 | Duplicate email, or an application already decided |
| `UPSTREAM_ERROR` | 502 | A department system is unavailable |
| `INTERNAL_ERROR` | 500 | Unexpected — details are logged server-side, never returned |

Authentication is `Authorization: Bearer <jwt>`. The token carries the role, but the role
is **re-read from the database on every request**, so a change takes effect immediately
rather than at token expiry.

## Authorisation matrix

| Endpoint group | CITIZEN | OFFICER | ADMIN |
|---|:--:|:--:|:--:|
| `/api/auth/*` | ● | ● | ● |
| `/api/applications` (own only) | ● | ● | ● |
| `POST /api/applications` | ● | ✗ | ✗ |
| `POST /api/applications/:id/consent` | ● | ✗ | ✗ |
| `POST /api/applications/:id/documents` | ● | ✗ | ✗ |
| `POST /api/applications/:id/notes` | ✗ | ● | ● |
| `/api/officer/*` | ✗ | ● | ● |
| `/api/admin/*` | ✗ | ✗ | ● |

A citizen requesting another citizen's application receives **404, not 403** — a 403 would
confirm the id exists.

## Public

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/api/health` | Liveness + database + AI configuration |
| `GET` | `/api/meta/departments` | Every department's contract, auth scheme and field mapping |
| `GET` | `/api/meta/workflow` | Workflow definition, SLA target, scheme policy |

## Auth

| Method | Path | Notes |
|---|---|---|
| `POST` | `/api/auth/register` | Pass `citizenExternalId` (e.g. `CIT-1001`) to link an existing synthetic identity |
| `POST` | `/api/auth/login` | Returns `{ token, user }` |
| `GET` | `/api/auth/me` | Session identity, citizen record, department |

```bash
curl -s localhost:4000/api/auth/login \
  -H 'content-type: application/json' \
  -d '{"email":"officer@govflow.gov.in","password":"Password@123"}'
```

## Applications

| Method | Path | Notes |
|---|---|---|
| `GET` | `/api/applications` | `?status=&search=&page=&pageSize=` — citizens see only their own |
| `POST` | `/api/applications` | Returns immediately with `PROCESSING`; no department is called on the request thread |
| `GET` | `/api/applications/:id` | Full detail: verification, documents, timeline, SLA, audit |
| `GET` | `/api/applications/:id/timeline` | Step statuses and retry counts |
| `POST` | `/api/applications/:id/consent` | `{ departmentCode, granted }` — granting the last scope resumes the workflow |
| `DELETE` | `/api/applications/:id/consent/:code` | Revoke |
| `POST` | `/api/applications/:id/documents` | `multipart/form-data` with `file` + `documentType` |
| `GET` | `/api/applications/:id/documents/:docId/content` | Download the stored file |
| `DELETE` | `/api/applications/:id/documents/:docId` | Remove |
| `POST` | `/api/applications/:id/revalidate` | Re-run document + mismatch checks |
| `POST` | `/api/applications/:id/retry` | Re-queue the first incomplete step |

Uploads accept `text/plain`, `application/pdf`, `image/png`, `image/jpeg` up to
`MAX_UPLOAD_BYTES` (default 5 MB). The client filename is never used on disk — files are
stored under a generated name with an extension taken from the MIME allow-list.

## Officer

| Method | Path | Notes |
|---|---|---|
| `GET` | `/api/officer/metrics` | Queue counters |
| `GET` | `/api/officer/applications` | All applications, filterable |
| `GET` | `/api/officer/applications/:id` | Detail including internal review notes |
| `POST` | `/api/officer/applications/:id/approve` | `{ notes }`, minimum 5 characters |
| `POST` | `/api/officer/applications/:id/reject` | `{ notes }` |
| `POST` | `/api/officer/applications/:id/resume` | Re-queue a blocked step |
| `GET` | `/api/officer/exceptions` | `?status=OPEN,ACKNOWLEDGED&severity=HIGH` |
| `POST` | `/api/officer/exceptions/:id/resolve` | `{ notes, status }` |

Approve and reject are the **only** paths to a terminal state, and both require an officer
session. No AI code path can reach them.

## Admin

| Method | Path | Notes |
|---|---|---|
| `GET` | `/api/admin/metrics` | Applications, SLA, exceptions, connectors, queue, API |
| `GET` | `/api/admin/health` | Live probe of every connector + queue + AI status |
| `GET` | `/api/admin/departments` | Registry including the full field-mapping specification |
| `GET` | `/api/admin/connectors` | Health cards |
| `POST` | `/api/admin/connectors/:code/simulate-failure` | `{ mode }` — genuinely breaks the department |
| `POST` | `/api/admin/connectors/:code/restore` | Restore service |
| `POST` | `/api/admin/connectors/:code/test` | Probe; returns raw **and** normalised payloads |
| `POST` | `/api/admin/legacy/import` | Ingest the legacy CSV export |
| `GET` | `/api/admin/audit` | `?action=&resourceType=&page=` |
| `GET` | `/api/admin/connector-logs` | `?connector=&status=` |
| `GET` | `/api/admin/queue` | BullMQ depth |

Failure modes: `ERROR_500`, `TIMEOUT`, `MALFORMED`, `UNAUTHORIZED`.

The connector probe is the clearest single view of what GovFlow does:

```bash
TOKEN=$(curl -s localhost:4000/api/auth/login -H 'content-type: application/json' \
  -d '{"email":"admin@govflow.gov.in","password":"Password@123"}' \
  | python3 -c 'import sys,json;print(json.load(sys.stdin)["data"]["token"])')

curl -s -X POST localhost:4000/api/admin/connectors/INCOME/test \
  -H "authorization: Bearer $TOKEN" -H 'content-type: application/json' \
  -d '{"citizenExternalId":"CIT-1009"}' | python3 -m json.tool
```

```jsonc
{
  "rawFromDepartment":  { "applicant_id": "INC-1009", "annualIncome": "1,95,000", … },
  "normalizedCommonModel": { "citizenId": "INC-1009", "annualIncome": 195000, … }
}
```

## Notifications

| Method | Path | Notes |
|---|---|---|
| `GET` | `/api/notifications` | `?unreadOnly=true&limit=30`; includes `unreadCount` |
| `PATCH` | `/api/notifications/:id/read` | Mark one read |
| `POST` | `/api/notifications/read-all` | Mark all read |

The UI polls this every 15 seconds. WebSockets were considered and rejected: a second
transport and a second failure mode, for no benefit at this scale.

## Simulated department contracts

Served directly by the mock service on port 5001 — `GET http://localhost:5001/` lists them.

| Department | Endpoint | Auth | Keyspace |
|---|---|---|---|
| Identity | `GET /api/identity/:citizenId` | `x-api-key` header | `CIT-####` |
| Income | `GET /api/income/:id` | `Authorization: Bearer` | `INC-####` |
| Education | `GET /api/student/:studentId` | `Authorization: Basic` | `STU-####` |
| Legacy | `data/legacy/beneficiaries.csv` | file access | `BEN####` + `citizen_ref` crosswalk |

Control plane (demo only): `GET /__control`, `POST /__control/:department { "mode": … }`.
