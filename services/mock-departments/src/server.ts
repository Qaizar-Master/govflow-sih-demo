import express, { type NextFunction, type Request, type Response } from 'express';
import { EDUCATION, IDENTITY, INCOME } from './data.js';
import { createSsoRouter } from './sso.js';

/**
 * SIMULATED DEPARTMENTAL SYSTEMS
 * ---------------------------------------------------------------------------
 * Three independent "departments" hosted in one process for demo simplicity.
 * Each keeps its own schema convention, its own identifier keyspace and its own
 * authentication mechanism - exactly the divergence GovFlow's connector layer
 * has to absorb.
 *
 * These are NOT real government systems and hold only synthetic data.
 */

const PORT = Number(process.env.MOCK_DEPARTMENTS_PORT ?? 5001);
const IDENTITY_API_KEY = process.env.IDENTITY_API_KEY ?? 'identity-demo-key';
const INCOME_API_TOKEN = process.env.INCOME_API_TOKEN ?? 'income-demo-bearer-token';
const EDUCATION_BASIC_USER = process.env.EDUCATION_BASIC_USER ?? 'education';
const EDUCATION_BASIC_PASS = process.env.EDUCATION_BASIC_PASS ?? 'education-demo-pass';

type FailureMode = 'OFF' | 'ERROR_500' | 'TIMEOUT' | 'MALFORMED' | 'UNAUTHORIZED';
type DeptCode = 'IDENTITY' | 'INCOME' | 'EDUCATION';

const DEPT_CODES: DeptCode[] = ['IDENTITY', 'INCOME', 'EDUCATION'];

/** Admin-controlled outage state. In-memory on purpose: it is a demo switch. */
const failureModes: Record<DeptCode, FailureMode> = {
  IDENTITY: 'OFF',
  INCOME: 'OFF',
  EDUCATION: 'OFF',
};

const requestCounts: Record<DeptCode, { total: number; failed: number }> = {
  IDENTITY: { total: 0, failed: 0 },
  INCOME: { total: 0, failed: 0 },
  EDUCATION: { total: 0, failed: 0 },
};

const app = express();
app.use(express.json());

app.use((req, _res, next) => {
  // eslint-disable-next-line no-console
  console.log(`[mock-departments] ${req.method} ${req.originalUrl}`);
  next();
});

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Applies the currently configured outage for a department. Returns true when
 * the response has already been sent and the handler must stop.
 */
async function applyFailureMode(code: DeptCode, res: Response): Promise<boolean> {
  const mode = failureModes[code];
  if (mode === 'OFF') return false;

  requestCounts[code].failed += 1;

  if (mode === 'ERROR_500') {
    res.status(503).json({
      error: 'ServiceUnavailable',
      message: `${code} department backend is temporarily unavailable`,
    });
    return true;
  }
  if (mode === 'UNAUTHORIZED') {
    res.status(401).json({ error: 'Unauthorized', message: 'credentials rejected' });
    return true;
  }
  if (mode === 'MALFORMED') {
    // Valid HTTP 200 carrying a payload that violates the published contract.
    res.status(200).type('application/json').send('{"unexpected": "shape", "citizen":');
    return true;
  }
  if (mode === 'TIMEOUT') {
    // Hang well past any sane client timeout, then answer nobody.
    await sleep(30_000);
    res.status(504).json({ error: 'GatewayTimeout' });
    return true;
  }
  return false;
}

function requireApiKey(req: Request, res: Response, next: NextFunction) {
  if (req.header('x-api-key') !== IDENTITY_API_KEY) {
    res.status(401).json({ error: 'Unauthorized', message: 'valid x-api-key header required' });
    return;
  }
  next();
}

function requireBearer(req: Request, res: Response, next: NextFunction) {
  const header = req.header('authorization') ?? '';
  if (header !== `Bearer ${INCOME_API_TOKEN}`) {
    res.status(401).json({ error: 'Unauthorized', message: 'bearer token required' });
    return;
  }
  next();
}

function requireBasic(req: Request, res: Response, next: NextFunction) {
  const header = req.header('authorization') ?? '';
  const expected = `Basic ${Buffer.from(`${EDUCATION_BASIC_USER}:${EDUCATION_BASIC_PASS}`).toString('base64')}`;
  if (header !== expected) {
    res.status(401).json({ error: 'Unauthorized', message: 'HTTP Basic credentials required' });
    return;
  }
  next();
}

// ===========================================================================
// Identity Registry - GET /api/identity/:citizenId   (API key)
// ===========================================================================
app.get('/api/identity/:citizenId', requireApiKey, async (req, res) => {
  requestCounts.IDENTITY.total += 1;
  if (await applyFailureMode('IDENTITY', res)) return;

  const id = req.params.citizenId.trim().toUpperCase();
  const row = IDENTITY.find((r) => r.citizenId.toUpperCase() === id);
  if (!row) {
    res.status(404).json({ error: 'NotFound', message: `no identity record for ${id}` });
    return;
  }
  res.json(row);
});

// ===========================================================================
// Income Department - GET /api/income/:id            (bearer token)
// ===========================================================================
app.get('/api/income/:id', requireBearer, async (req, res) => {
  requestCounts.INCOME.total += 1;
  if (await applyFailureMode('INCOME', res)) return;

  const id = req.params.id.trim().toUpperCase();
  const row = INCOME.find((r) => r.applicant_id.toUpperCase() === id);
  if (!row) {
    res.status(404).json({ error: 'NotFound', message: `no income record for ${id}` });
    return;
  }
  res.json(row);
});

// ===========================================================================
// Education Department - GET /api/student/:studentId  (HTTP Basic)
// ===========================================================================
app.get('/api/student/:studentId', requireBasic, async (req, res) => {
  requestCounts.EDUCATION.total += 1;
  if (await applyFailureMode('EDUCATION', res)) return;

  const id = req.params.studentId.trim().toUpperCase();
  const row = EDUCATION.find((r) => r.student_no.toUpperCase() === id);
  if (!row) {
    res.status(404).json({ error: 'NotFound', message: `no student record for ${id}` });
    return;
  }
  res.json(row);
});

// ===========================================================================
// DECISION INBOXES
//
// The write direction. Each department issues its OWN reference number, in its
// own format, and that reference - not GovFlow's application number - is the
// authoritative handle for the sanction afterwards.
//
// Both honour Idempotency-Key, because the caller will retry after a timeout
// and nobody should be sanctioned twice for one application.
// ===========================================================================

interface DecisionRecord {
  reference: string;
  receivedAt: string;
  payload: Record<string, unknown>;
}

/** Idempotency key -> the reference already issued for it. */
const decisionsByKey: Record<DeptCode, Map<string, DecisionRecord>> = {
  IDENTITY: new Map(),
  INCOME: new Map(),
  EDUCATION: new Map(),
};

let educationSequence = 0;
let incomeSequence = 0;

function idempotencyKeyOf(req: Request): string | null {
  const key = req.header('idempotency-key');
  return key && key.trim() !== '' ? key.trim() : null;
}

app.post('/api/education/decisions', requireBasic, async (req, res) => {
  requestCounts.EDUCATION.total += 1;
  if (await applyFailureMode('EDUCATION', res)) return;

  const key = idempotencyKeyOf(req);
  if (!key) {
    res.status(400).json({ error: 'BadRequest', message: 'Idempotency-Key header is required' });
    return;
  }

  const body = req.body as Record<string, unknown>;
  if (!body?.student_no || !body?.decision_status || !body?.partner_ref) {
    res.status(400).json({
      error: 'BadRequest',
      message: 'student_no, decision_status and partner_ref are required',
    });
    return;
  }

  const seen = decisionsByKey.EDUCATION.get(key);
  if (seen) {
    // A retry, not a second sanction. Same reference, flagged as a duplicate.
    res.status(200).json({ ack_id: seen.reference, received_at: seen.receivedAt, duplicate: true });
    return;
  }

  educationSequence += 1;
  const record: DecisionRecord = {
    reference: `EDU/SCH/2026/${String(educationSequence).padStart(5, '0')}`,
    receivedAt: new Date().toISOString(),
    payload: body,
  };
  decisionsByKey.EDUCATION.set(key, record);

  res.status(201).json({
    ack_id: record.reference,
    received_at: record.receivedAt,
    student_no: body.student_no,
    status: 'RECORDED',
  });
});

app.post('/api/income/decisions', requireBearer, async (req, res) => {
  requestCounts.INCOME.total += 1;
  if (await applyFailureMode('INCOME', res)) return;

  const key = idempotencyKeyOf(req);
  if (!key) {
    res.status(400).json({ error: 'BadRequest', message: 'Idempotency-Key header is required' });
    return;
  }

  const body = req.body as Record<string, unknown>;
  if (!body?.applicantId || !body?.outcome || !body?.externalRef) {
    res.status(400).json({
      error: 'BadRequest',
      message: 'applicantId, outcome and externalRef are required',
    });
    return;
  }

  const seen = decisionsByKey.INCOME.get(key);
  if (seen) {
    res.status(200).json({ reference: seen.reference, timestamp: seen.receivedAt, duplicate: true });
    return;
  }

  incomeSequence += 1;
  const record: DecisionRecord = {
    // A deliberately different shape from Education's: the whole point is that
    // no two departments agree on anything, references included.
    reference: `REV-2026-${String(400000 + incomeSequence)}`,
    receivedAt: new Date().toISOString(),
    payload: body,
  };
  decisionsByKey.INCOME.set(key, record);

  res.status(201).json({
    reference: record.reference,
    timestamp: record.receivedAt,
    applicantId: body.applicantId,
    state: 'RECORDED',
  });
});

/**
 * Demo and test control: forget every recorded decision.
 *
 * The store is in-memory and deliberately survives a GovFlow database reset,
 * which is realistic - a department does not forget because its partner
 * re-seeded. That makes an explicit reset necessary for repeatable runs.
 */
app.delete('/api/__decisions', (_req, res) => {
  for (const code of DEPT_CODES) decisionsByKey[code].clear();
  educationSequence = 0;
  incomeSequence = 0;
  res.json({ cleared: true });
});

/** Demo aid: what each department believes it has been told. */
app.get('/api/__decisions', (_req, res) => {
  res.json({
    note: 'Decisions these simulated departments have recorded. Synthetic data only.',
    education: [...decisionsByKey.EDUCATION.entries()].map(([key, r]) => ({ ...r, key })),
    income: [...decisionsByKey.INCOME.entries()].map(([key, r]) => ({ ...r, key })),
  });
});

// ===========================================================================
// Simulated national identity provider.
//
// Hosted here for the same reason the three departments share a process: a demo
// should not need six containers. It is conceptually a separate operator and
// shares no state with the registries above.
// ===========================================================================
app.use('/sso', createSsoRouter());

// ===========================================================================
// Health - honours the per-department outage switch
// ===========================================================================
app.get('/health', (req, res) => {
  const requested = String(req.query.department ?? '').toUpperCase();
  if (DEPT_CODES.includes(requested as DeptCode)) {
    const code = requested as DeptCode;
    const mode = failureModes[code];
    if (mode === 'OFF') {
      res.json({ status: 'ok', department: code, simulatedFailure: null });
      return;
    }
    res
      .status(503)
      .json({ status: 'unavailable', department: code, simulatedFailure: mode });
    return;
  }
  res.json({
    status: 'ok',
    service: 'mock-departments',
    departments: DEPT_CODES.map((c) => ({
      code: c,
      simulatedFailure: failureModes[c] === 'OFF' ? null : failureModes[c],
      requests: requestCounts[c],
    })),
  });
});

// ===========================================================================
// Demo control plane - the "Simulate Failure" switch behind the admin console
// ===========================================================================
app.get('/__control', (_req, res) => {
  res.json({
    departments: DEPT_CODES.map((c) => ({
      code: c,
      mode: failureModes[c],
      requests: requestCounts[c],
    })),
  });
});

app.post('/__control/:department', (req, res) => {
  const code = String(req.params.department).toUpperCase() as DeptCode;
  if (!DEPT_CODES.includes(code)) {
    res.status(404).json({ error: 'NotFound', message: `unknown department ${code}` });
    return;
  }
  const mode = String(req.body?.mode ?? 'OFF').toUpperCase() as FailureMode;
  const allowed: FailureMode[] = ['OFF', 'ERROR_500', 'TIMEOUT', 'MALFORMED', 'UNAUTHORIZED'];
  if (!allowed.includes(mode)) {
    res.status(400).json({ error: 'BadRequest', message: `mode must be one of ${allowed.join(', ')}` });
    return;
  }
  failureModes[code] = mode;
  // eslint-disable-next-line no-console
  console.log(`[mock-departments] ${code} failure mode -> ${mode}`);
  res.json({ department: code, mode });
});

// ===========================================================================
// Published contracts, so the divergence is visible during the demo
// ===========================================================================
app.get('/', (_req, res) => {
  res.json({
    service: 'GovFlow simulated department systems',
    disclaimer: 'Synthetic data only. Not connected to any real government system.',
    departments: [
      {
        code: 'IDENTITY',
        endpoint: 'GET /api/identity/:citizenId',
        auth: 'x-api-key header',
        keyspace: 'CIT-####',
        schema: { citizenId: 'string', fullName: 'string', dob: 'YYYY-MM-DD', district: 'string' },
      },
      {
        code: 'INCOME',
        endpoint: 'GET /api/income/:id',
        auth: 'Authorization: Bearer <token>',
        keyspace: 'INC-####',
        schema: { applicant_id: 'string', name: 'string', annualIncome: 'number|string', incomeYear: 'number' },
      },
      {
        code: 'EDUCATION',
        endpoint: 'GET /api/student/:studentId',
        auth: 'Authorization: Basic <base64>',
        keyspace: 'STU-####',
        schema: {
          student_no: 'string',
          studentName: 'string',
          institution_name: 'string',
          enrollment_status: 'ACTIVE|INACTIVE',
        },
      },
    ],
    identityProvider: {
      name: 'MeriPehchaan (Simulated)',
      discovery: 'GET /sso/.well-known/openid-configuration',
      authorize: 'GET /sso/authorize?client_id=&redirect_uri=&state=',
      token: 'POST /sso/token',
      userinfo: 'GET /sso/userinfo',
    },
    decisions: {
      education: 'POST /api/education/decisions  (Basic; Idempotency-Key required)',
      income: 'POST /api/income/decisions  (Bearer; Idempotency-Key required)',
      inspect: 'GET /api/__decisions',
      note: 'Each department issues its own reference format. Identity and the legacy export have no inbox at all.',
    },
    control: {
      inspect: 'GET /__control',
      simulate: 'POST /__control/:department { "mode": "ERROR_500|TIMEOUT|MALFORMED|UNAUTHORIZED|OFF" }',
    },
  });
});

app.use((_req, res) => {
  res.status(404).json({ error: 'NotFound', message: 'no such department endpoint' });
});

app.listen(PORT, () => {
  // eslint-disable-next-line no-console
  console.log(
    `[mock-departments] simulated IDENTITY / INCOME / EDUCATION registries + MeriPehchaan (Simulated) SSO listening on :${PORT}`,
  );
});
