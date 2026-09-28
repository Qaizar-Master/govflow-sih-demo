import crypto from 'node:crypto';
import { Router } from 'express';
import jwt from 'jsonwebtoken';
import { AuditAction, env, type Role } from '@govflow/contracts';
import { IdentityBindingError, bindIdentityAssertion, prisma, recordAudit } from '@govflow/core';
import { handler } from '../lib/async-handler.js';
import { signToken } from '../lib/tokens.js';

/**
 * SSO client for the simulated national identity provider.
 * ---------------------------------------------------------------------------
 * GovFlow is the relying party here, not the authority. It never sees a
 * password; it receives an assertion naming the citizen and their identifiers
 * at each department, and that assertion is what authorises the departmental
 * lookups the workflow makes later.
 *
 * The provider is simulated (see services/mock-departments/src/sso.ts) and the
 * `id_token` is HS256 rather than RS256/JWKS. The flow, the state handling and
 * the single-use code are real; the key management is not.
 */
export const ssoRouter = Router();

const CALLBACK_PATH = '/api/auth/sso/callback';
const STATE_TTL_SECONDS = 600;

function redirectUri(): string {
  return `${env.API_BASE_URL.replace(/\/$/, '')}${CALLBACK_PATH}`;
}

/**
 * CSRF state, signed rather than stored.
 *
 * A stateless JWT means no server-side session table and no Redis key to
 * expire, and it still does the one job state has: proving this callback
 * belongs to a flow this API started.
 */
function signState(returnTo: string): string {
  return jwt.sign({ nonce: crypto.randomBytes(16).toString('hex'), returnTo }, env.JWT_SECRET, {
    expiresIn: STATE_TTL_SECONDS,
    issuer: 'govflow',
    audience: 'govflow-sso-state',
  });
}

function verifyState(state: string): { returnTo: string } | null {
  try {
    const payload = jwt.verify(state, env.JWT_SECRET, {
      issuer: 'govflow',
      audience: 'govflow-sso-state',
    }) as { returnTo?: string };
    return { returnTo: payload.returnTo ?? '/dashboard' };
  } catch {
    return null;
  }
}

/** Verifies the id_token the way a relying party must: signature, then claims. */
function verifyIdToken(idToken: string): { sub: string } | null {
  try {
    const payload = jwt.verify(idToken, env.SSO_CLIENT_SECRET, {
      algorithms: ['HS256'],
      audience: env.SSO_CLIENT_ID,
    }) as { sub?: string };
    return payload.sub ? { sub: payload.sub } : null;
  } catch {
    return null;
  }
}

function frontend(path: string): string {
  return `${env.FRONTEND_URL.replace(/\/$/, '')}${path}`;
}

/** Sends the citizen to the provider with a signed state. */
ssoRouter.get(
  '/start',
  handler(async (req, res) => {
    const returnTo = typeof req.query.returnTo === 'string' ? req.query.returnTo : '/dashboard';
    const url = new URL(`${env.SSO_AUTHORIZE_URL.replace(/\/$/, '')}/authorize`);
    url.searchParams.set('client_id', env.SSO_CLIENT_ID);
    url.searchParams.set('redirect_uri', redirectUri());
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('scope', 'openid profile gov.identifiers');
    url.searchParams.set('state', signState(returnTo));
    res.redirect(302, url.toString());
  }),
);

/**
 * Exchanges the code, verifies the assertion and binds it.
 *
 * Failures redirect to the login page with a short reason rather than
 * rendering an error: the citizen is mid-journey in a browser, and a JSON body
 * is not an answer for them. Nothing from the provider is echoed back into the
 * URL.
 */
ssoRouter.get(
  '/callback',
  handler(async (req, res) => {
    const fail = (reason: string) =>
      res.redirect(302, frontend(`/login?sso=${encodeURIComponent(reason)}`));

    const code = typeof req.query.code === 'string' ? req.query.code : '';
    const state = typeof req.query.state === 'string' ? req.query.state : '';
    if (!code) return fail('cancelled');

    const verifiedState = verifyState(state);
    if (!verifiedState) return fail('expired');

    // --- code -> tokens -------------------------------------------------
    const tokenResponse = await fetch(`${env.SSO_INTERNAL_URL.replace(/\/$/, '')}/token`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        redirect_uri: redirectUri(),
        client_id: env.SSO_CLIENT_ID,
        client_secret: env.SSO_CLIENT_SECRET,
      }),
      signal: AbortSignal.timeout(env.CONNECTOR_TIMEOUT_MS),
    });
    if (!tokenResponse.ok) return fail('exchange_failed');

    const tokens = (await tokenResponse.json()) as {
      access_token?: string;
      id_token?: string;
    };
    if (!tokens.access_token || !tokens.id_token) return fail('exchange_failed');

    const claims = verifyIdToken(tokens.id_token);
    if (!claims) return fail('untrusted_assertion');

    // --- assertion ------------------------------------------------------
    const userinfoResponse = await fetch(`${env.SSO_INTERNAL_URL.replace(/\/$/, '')}/userinfo`, {
      headers: { authorization: `Bearer ${tokens.access_token}` },
      signal: AbortSignal.timeout(env.CONNECTOR_TIMEOUT_MS),
    });
    if (!userinfoResponse.ok) return fail('assertion_unavailable');

    const profile = (await userinfoResponse.json()) as {
      sub?: string;
      name?: string;
      birthdate?: string;
      district?: string;
      department_identifiers?: { department: string; identifier: string }[];
    };

    // The userinfo subject must match the signed id_token, or the two halves
    // of this exchange are not about the same person.
    if (!profile.sub || profile.sub !== claims.sub) return fail('untrusted_assertion');
    if (!profile.name || !profile.birthdate || !profile.district) return fail('incomplete_assertion');

    let binding;
    try {
      binding = await bindIdentityAssertion(
        {
          subject: profile.sub,
          name: profile.name,
          birthdate: profile.birthdate,
          district: profile.district,
          departmentIdentifiers: profile.department_identifiers ?? [],
        },
        { ipAddress: req.ip ?? null },
      );
    } catch (error) {
      if (error instanceof IdentityBindingError) return fail(error.code.toLowerCase());
      throw error;
    }

    const user = await prisma.user.findUniqueOrThrow({
      where: { id: binding.userId },
      select: { id: true, email: true, role: true, departmentId: true },
    });

    await recordAudit({
      action: AuditAction.USER_LOGIN,
      resourceType: 'User',
      resourceId: user.id,
      userId: user.id,
      actorRole: user.role as Role,
      metadata: { method: 'SSO', provider: 'MERIPEHCHAAN_SIMULATED' },
      ipAddress: req.ip ?? null,
    });

    const token = signToken({
      sub: user.id,
      email: user.email,
      role: user.role as Role,
      departmentId: user.departmentId,
    });

    // The token travels in the fragment so it never reaches a server log or a
    // Referer header on the way to the browser.
    const target = new URL(frontend('/auth/callback'));
    target.searchParams.set('returnTo', verifiedState.returnTo);
    target.hash = `token=${encodeURIComponent(token)}&linked=${binding.linkedDepartments.length}`;
    return res.redirect(302, target.toString());
  }),
);
