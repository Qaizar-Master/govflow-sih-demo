import crypto from 'node:crypto';
import express, { type Request, type Response, type Router } from 'express';
import { EDUCATION, IDENTITY, INCOME } from './data.js';

/**
 * MERIPEHCHAAN (SIMULATED) - a stand-in national identity provider.
 * ---------------------------------------------------------------------------
 * This is NOT a departmental system. It shares a process with the simulated
 * departments for the same reason they share one with each other: a demo
 * should not need six containers. Conceptually it is a separate operator.
 *
 * It implements the subset of OAuth 2.0 / OIDC that GovFlow actually uses:
 * authorization code, token exchange, userinfo. Simplifications, stated
 * plainly so nobody mistakes this for a production integration:
 *
 *   - `id_token` is signed HS256 with the client secret. Real MeriPehchaan and
 *     DigiLocker sign RS256 and publish a JWKS. The verification *shape* is the
 *     same; the key management is not.
 *   - There is no password. The account chooser is a list of synthetic
 *     citizens, because authenticating a fake person proves nothing.
 *   - `userinfo` returns the citizen's departmental identifiers directly. In
 *     production this is closer to DigiLocker's issued-documents list, where
 *     the citizen consents to share each issuer's reference. The point that
 *     survives the simplification: *the identity provider is what knows how a
 *     person is keyed across departments* - GovFlow must be told, not guess.
 *
 * Nothing here holds real data, and no real credential is ever accepted.
 */

const ISSUER = 'https://meripehchaan.simulated.gov.in';
const CLIENT_ID = process.env.SSO_CLIENT_ID ?? 'govflow-demo';
const CLIENT_SECRET = process.env.SSO_CLIENT_SECRET ?? 'sso-demo-client-secret';
const CODE_TTL_MS = 5 * 60_000;
const TOKEN_TTL_SECONDS = 600;

/**
 * Redirect targets this provider will hand a code to. An open redirect_uri is
 * the classic OAuth hole, so it is an allowlist even in a simulation.
 */
const ALLOWED_REDIRECTS = (
  process.env.SSO_ALLOWED_REDIRECTS ??
  'http://localhost:4000/api/auth/sso/callback,http://api:4000/api/auth/sso/callback'
)
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

// ---------------------------------------------------------------------------
// The identities this provider can assert
// ---------------------------------------------------------------------------

export interface DepartmentIdentifier {
  department: string;
  identifier: string;
}

export interface SsoIdentity {
  subject: string;
  name: string;
  birthdate: string;
  district: string;
  departmentIdentifiers: DepartmentIdentifier[];
}

/**
 * The provider's enrolment register: which department holds a record for whom,
 * and under which number.
 *
 * Stated explicitly rather than correlated on the fly. Two earlier shortcuts
 * are wrong in ways worth naming:
 *
 *   - *Matching on name* fails on exactly the data this demo is built around.
 *     The Education registry knows CIT-1001 as "Rohan P.", so name-matching
 *     silently drops the link and the citizen loses a department without any
 *     error. Worse, it is the mismatch GovFlow's validation layer exists to
 *     *detect* - resolving it here would hide the demo's own point.
 *   - *Deriving the number from the suffix* is the guess this whole mechanism
 *     replaces. An identity provider does not infer enrolments; it holds them.
 *
 * The gaps are deliberate and load-bearing: CIT-1010 has no education record,
 * so the assertion carries no EDUCATION identifier and GovFlow must fail
 * honestly rather than invent one.
 */
const ENROLMENT_REGISTER: Record<string, { INCOME?: string; EDUCATION?: string }> = {
  'CIT-1001': { INCOME: 'INC-1001', EDUCATION: 'STU-1001' },
  'CIT-1002': { INCOME: 'INC-1002', EDUCATION: 'STU-1002' },
  'CIT-1003': { INCOME: 'INC-1003', EDUCATION: 'STU-1003' },
  'CIT-1004': { INCOME: 'INC-1004', EDUCATION: 'STU-1004' },
  'CIT-1005': { INCOME: 'INC-1005', EDUCATION: 'STU-1005' },
  'CIT-1006': { INCOME: 'INC-1006', EDUCATION: 'STU-1006' },
  'CIT-1007': { INCOME: 'INC-1007', EDUCATION: 'STU-1007' },
  'CIT-1008': { INCOME: 'INC-1008', EDUCATION: 'STU-1008' },
  'CIT-1009': { INCOME: 'INC-1009', EDUCATION: 'STU-1009' },
  // No education enrolment on record.
  'CIT-1010': { INCOME: 'INC-1010' },
};

/**
 * Warns if the register drifts out of step with the datasets it describes.
 * A provider asserting an identifier no department recognises is a bug worth
 * seeing at boot rather than mid-demo.
 */
function auditRegister(): void {
  for (const [citizenId, enrolment] of Object.entries(ENROLMENT_REGISTER)) {
    if (enrolment.INCOME && !INCOME.some((r) => r.applicant_id === enrolment.INCOME)) {
      // eslint-disable-next-line no-console
      console.warn(`[sso] register names ${enrolment.INCOME} for ${citizenId}, unknown to Income`);
    }
    if (enrolment.EDUCATION && !EDUCATION.some((r) => r.student_no === enrolment.EDUCATION)) {
      // eslint-disable-next-line no-console
      console.warn(
        `[sso] register names ${enrolment.EDUCATION} for ${citizenId}, unknown to Education`,
      );
    }
  }
}

function buildIdentities(): SsoIdentity[] {
  auditRegister();
  return IDENTITY.map((row) => {
    const enrolment = ENROLMENT_REGISTER[row.citizenId] ?? {};

    const identifiers: DepartmentIdentifier[] = [
      { department: 'IDENTITY', identifier: row.citizenId },
      // The legacy export is keyed by the canonical registry id (its own
      // beneficiary number is an internal detail it carries as a column).
      { department: 'LEGACY', identifier: row.citizenId },
    ];
    if (enrolment.INCOME) {
      identifiers.push({ department: 'INCOME', identifier: enrolment.INCOME });
    }
    if (enrolment.EDUCATION) {
      identifiers.push({ department: 'EDUCATION', identifier: enrolment.EDUCATION });
    }

    return {
      // Opaque to GovFlow on purpose: a pairwise subject is not a registry id,
      // and code that assumes otherwise is code that guesses.
      subject: `MP-${crypto.createHash('sha256').update(row.citizenId).digest('hex').slice(0, 16).toUpperCase()}`,
      name: row.fullName,
      birthdate: row.dob,
      district: row.district.trim(),
      departmentIdentifiers: identifiers,
    };
  });
}

const IDENTITIES = buildIdentities();
const bySubject = new Map(IDENTITIES.map((i) => [i.subject, i]));

// ---------------------------------------------------------------------------
// Short-lived grant state. In-memory on purpose: it is a demo provider.
// ---------------------------------------------------------------------------
interface Grant {
  subject: string;
  redirectUri: string;
  expiresAt: number;
  accessToken?: string;
}

const codes = new Map<string, Grant>();
const accessTokens = new Map<string, { subject: string; expiresAt: number }>();

function sweep(): void {
  const now = Date.now();
  for (const [code, grant] of codes) if (grant.expiresAt < now) codes.delete(code);
  for (const [token, session] of accessTokens) {
    if (session.expiresAt < now) accessTokens.delete(token);
  }
}

const randomId = (bytes = 24) => crypto.randomBytes(bytes).toString('base64url');

// ---------------------------------------------------------------------------
// Minimal HS256 JWT, so this service keeps its single dependency
// ---------------------------------------------------------------------------
function base64url(input: Buffer | string): string {
  return Buffer.from(input).toString('base64url');
}

function signJwt(claims: Record<string, unknown>, secret: string): string {
  const header = base64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const payload = base64url(JSON.stringify(claims));
  const signature = crypto
    .createHmac('sha256', secret)
    .update(`${header}.${payload}`)
    .digest('base64url');
  return `${header}.${payload}.${signature}`;
}

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------
export function createSsoRouter(): Router {
  const router = express.Router();
  router.use(express.urlencoded({ extended: false }));

  /** Discovery, so the shape is recognisable even though GovFlow hardcodes it. */
  router.get('/.well-known/openid-configuration', (_req, res) => {
    res.json({
      issuer: ISSUER,
      authorization_endpoint: '/sso/authorize',
      token_endpoint: '/sso/token',
      userinfo_endpoint: '/sso/userinfo',
      response_types_supported: ['code'],
      grant_types_supported: ['authorization_code'],
      id_token_signing_alg_values_supported: ['HS256'],
      scopes_supported: ['openid', 'profile', 'gov.identifiers'],
      simulated: true,
    });
  });

  /** Account chooser. Rendered server-side so it is obviously not GovFlow. */
  router.get('/authorize', (req: Request, res: Response) => {
    const clientId = String(req.query.client_id ?? '');
    const redirectUri = String(req.query.redirect_uri ?? '');
    const state = String(req.query.state ?? '');

    if (clientId !== CLIENT_ID) {
      res.status(400).send(renderError('Unknown client_id.'));
      return;
    }
    if (!ALLOWED_REDIRECTS.includes(redirectUri)) {
      res.status(400).send(renderError('redirect_uri is not registered for this client.'));
      return;
    }
    res.type('html').send(renderChooser(redirectUri, state));
  });

  /** "Authentication". Issues a one-time code bound to the redirect_uri. */
  router.post('/authorize', (req: Request, res: Response) => {
    sweep();
    const { subject, redirect_uri: redirectUri, state } = req.body as Record<string, string>;

    if (!bySubject.has(subject)) {
      res.status(400).send(renderError('Unknown subject.'));
      return;
    }
    if (!ALLOWED_REDIRECTS.includes(redirectUri)) {
      res.status(400).send(renderError('redirect_uri is not registered for this client.'));
      return;
    }

    const code = randomId();
    codes.set(code, { subject, redirectUri, expiresAt: Date.now() + CODE_TTL_MS });

    const target = new URL(redirectUri);
    target.searchParams.set('code', code);
    if (state) target.searchParams.set('state', state);
    res.redirect(302, target.toString());
  });

  /** Code -> tokens. The code is single-use and bound to its redirect_uri. */
  router.post('/token', (req: Request, res: Response) => {
    sweep();
    const body = req.body as Record<string, string>;

    if (body.grant_type !== 'authorization_code') {
      res.status(400).json({ error: 'unsupported_grant_type' });
      return;
    }
    if (body.client_id !== CLIENT_ID || body.client_secret !== CLIENT_SECRET) {
      res.status(401).json({ error: 'invalid_client' });
      return;
    }

    const grant = codes.get(body.code ?? '');
    if (!grant || grant.expiresAt < Date.now()) {
      res.status(400).json({ error: 'invalid_grant', error_description: 'Code is unknown or expired' });
      return;
    }
    if (grant.redirectUri !== body.redirect_uri) {
      res.status(400).json({ error: 'invalid_grant', error_description: 'redirect_uri mismatch' });
      return;
    }
    // Single use: a replayed code must not mint a second session.
    codes.delete(body.code!);

    const identity = bySubject.get(grant.subject)!;
    const accessToken = randomId(32);
    accessTokens.set(accessToken, {
      subject: identity.subject,
      expiresAt: Date.now() + TOKEN_TTL_SECONDS * 1000,
    });

    const now = Math.floor(Date.now() / 1000);
    const idToken = signJwt(
      {
        iss: ISSUER,
        aud: CLIENT_ID,
        sub: identity.subject,
        iat: now,
        exp: now + TOKEN_TTL_SECONDS,
        name: identity.name,
        birthdate: identity.birthdate,
        district: identity.district,
      },
      CLIENT_SECRET,
    );

    res.json({
      access_token: accessToken,
      id_token: idToken,
      token_type: 'Bearer',
      expires_in: TOKEN_TTL_SECONDS,
      scope: 'openid profile gov.identifiers',
    });
  });

  /** The assertion GovFlow actually needs: who, and how they are keyed. */
  router.get('/userinfo', (req: Request, res: Response) => {
    sweep();
    const header = req.header('authorization') ?? '';
    const token = header.toLowerCase().startsWith('bearer ') ? header.slice(7).trim() : '';
    const session = accessTokens.get(token);

    if (!session || session.expiresAt < Date.now()) {
      res.status(401).json({ error: 'invalid_token' });
      return;
    }

    const identity = bySubject.get(session.subject)!;
    res.json({
      sub: identity.subject,
      name: identity.name,
      birthdate: identity.birthdate,
      district: identity.district,
      department_identifiers: identity.departmentIdentifiers,
      assertion_issued_at: new Date().toISOString(),
    });
  });

  return router;
}

// ---------------------------------------------------------------------------
// Presentation
// ---------------------------------------------------------------------------
const escape = (value: string): string =>
  value.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

const SHELL = (title: string, body: string): string => `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${title}</title>
<style>
  :root { color-scheme: light }
  body { margin:0; background:#f4f6f8; font:14px/1.5 system-ui,-apple-system,sans-serif; color:#111 }
  .wrap { max-width:620px; margin:0 auto; padding:32px 16px 64px }
  .banner { background:#fef3c7; border:1px solid #fcd34d; color:#78350f; padding:10px 14px;
            border-radius:8px; font-size:13px; margin-bottom:24px }
  .brand { display:flex; align-items:center; gap:10px; margin-bottom:6px }
  .brand b { font-size:20px; letter-spacing:-.01em }
  .sub { color:#555; margin:0 0 24px }
  .card { background:#fff; border:1px solid #e2e5e9; border-radius:12px; overflow:hidden }
  button.row { display:flex; width:100%; gap:12px; align-items:center; text-align:left;
               padding:14px 16px; background:#fff; border:0; border-bottom:1px solid #eef0f2;
               cursor:pointer; font:inherit }
  button.row:last-child { border-bottom:0 }
  button.row:hover { background:#f7f9fb }
  .avatar { width:34px; height:34px; border-radius:50%; background:#dbeafe; color:#1d4ed8;
            display:grid; place-items:center; font-weight:600; flex:none }
  .who { flex:1; min-width:0 }
  .who strong { display:block }
  .who span { color:#666; font-size:12.5px }
  .arrow { color:#9aa3ad }
  .foot { color:#666; font-size:12.5px; margin-top:20px }
</style></head><body><div class="wrap">${body}</div></body></html>`;

function renderChooser(redirectUri: string, state: string): string {
  const rows = IDENTITIES.map((identity) => {
    const initials = identity.name
      .split(' ')
      .map((part) => part[0])
      .join('')
      .slice(0, 2);
    const departments = identity.departmentIdentifiers.map((d) => d.identifier).join(' · ');
    return `<button class="row" type="submit" name="subject" value="${escape(identity.subject)}">
      <span class="avatar">${escape(initials)}</span>
      <span class="who"><strong>${escape(identity.name)}</strong>
        <span>${escape(identity.district)} · ${escape(departments)}</span></span>
      <span class="arrow">&rsaquo;</span>
    </button>`;
  }).join('');

  return SHELL(
    'MeriPehchaan (Simulated)',
    `<div class="banner"><strong>Simulated identity provider.</strong> This is not MeriPehchaan
       and holds no real data. Every account below is synthetic.</div>
     <div class="brand"><b>MeriPehchaan</b> <span style="color:#666">(Simulated)</span></div>
     <p class="sub"><strong>GovFlow</strong> is requesting your name, date of birth, district and
       your identifiers at the Identity, Income, Education and legacy beneficiary systems.
       Choose an account to continue.</p>
     <form method="post" action="/sso/authorize">
       <input type="hidden" name="redirect_uri" value="${escape(redirectUri)}">
       <input type="hidden" name="state" value="${escape(state)}">
       <div class="card">${rows}</div>
     </form>
     <p class="foot">GovFlow never sees a password. It receives an assertion naming these
       identifiers, which is what lets it query each department for the right record.</p>`,
  );
}

function renderError(message: string): string {
  return SHELL(
    'Request rejected',
    `<div class="brand"><b>MeriPehchaan</b> <span style="color:#666">(Simulated)</span></div>
     <div class="card" style="padding:16px"><strong>Request rejected.</strong>
       <p style="margin:8px 0 0;color:#555">${escape(message)}</p></div>`,
  );
}
