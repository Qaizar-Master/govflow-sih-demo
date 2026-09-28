import '../setup/env.js';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { infraAvailable, resetDatabase, seedMinimal, skipMessage } from './helpers.js';

const available = await infraAvailable();
if (!available) skipMessage();

const PROVIDER = 'http://localhost:5001/sso';
const REDIRECT_URI = 'http://localhost:4000/api/auth/sso/callback';

interface Account {
  subject: string;
  name: string;
}

/**
 * Reads the provider's account chooser rather than recomputing its subject
 * derivation here. A test that re-implements the thing it is testing agrees
 * with itself for free.
 */
function parseAccounts(html: string): Account[] {
  const accounts: Account[] = [];
  const pattern = /value="(MP-[A-F0-9]+)"[\s\S]*?<strong>([^<]+)<\/strong>/g;
  let match = pattern.exec(html);
  while (match) {
    accounts.push({ subject: match[1]!, name: match[2]! });
    match = pattern.exec(html);
  }
  return accounts;
}

/** Drives the provider's half of the flow the way a browser would. */
async function authorizeAt(subject: string, state: string): Promise<string | null> {
  const response = await fetch(`${PROVIDER}/authorize`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ subject, redirect_uri: REDIRECT_URI, state }),
    redirect: 'manual',
  });
  const location = response.headers.get('location');
  return location ? (new URL(location).searchParams.get('code') ?? null) : null;
}

describe.skipIf(!available)('sign-in through the simulated identity provider', () => {
  let app: Express;

  beforeAll(async () => {
    const { createApp } = await import('../../apps/api/src/app.js');
    app = createApp();
  });

  beforeEach(async () => {
    await resetDatabase();
    await seedMinimal('CIT-1001');
  });

  /** Starts a flow and returns the state the API signed for it. */
  async function startFlow(): Promise<{ state: string; authorizeUrl: URL }> {
    const response = await request(app).get('/api/auth/sso/start').expect(302);
    const authorizeUrl = new URL(response.headers.location as string);
    return { state: authorizeUrl.searchParams.get('state')!, authorizeUrl };
  }

  async function accountsFor(state: string): Promise<Account[]> {
    const url = new URL(`${PROVIDER}/authorize`);
    url.searchParams.set('client_id', 'govflow-demo');
    url.searchParams.set('redirect_uri', REDIRECT_URI);
    url.searchParams.set('state', state);
    const html = await (await fetch(url)).text();
    return parseAccounts(html);
  }

  /** The whole journey, ending at the API's redirect back to the frontend. */
  async function signIn(name: string): Promise<{ location: URL; token: string | null }> {
    const { state } = await startFlow();
    const accounts = await accountsFor(state);
    const account = accounts.find((a) => a.name === name);
    expect(account, `provider offers an account for ${name}`).toBeDefined();

    const code = await authorizeAt(account!.subject, state);
    expect(code).toBeTruthy();

    const response = await request(app)
      .get('/api/auth/sso/callback')
      .query({ code, state })
      .expect(302);

    const location = new URL(response.headers.location as string);
    const fragment = new URLSearchParams(location.hash.replace(/^#/, ''));
    return { location, token: fragment.get('token') };
  }

  it('sends the citizen to the provider with a state and a registered redirect_uri', async () => {
    const { authorizeUrl } = await startFlow();
    expect(authorizeUrl.origin + authorizeUrl.pathname).toBe(`${PROVIDER}/authorize`);
    expect(authorizeUrl.searchParams.get('client_id')).toBe('govflow-demo');
    expect(authorizeUrl.searchParams.get('redirect_uri')).toBe(REDIRECT_URI);
    expect(authorizeUrl.searchParams.get('state')).toBeTruthy();
  });

  it('completes the round trip and issues a session that works', async () => {
    const { location, token } = await signIn('Rohan Prajapati');

    expect(location.pathname).toBe('/auth/callback');
    expect(token).toBeTruthy();
    // The token rides in the fragment, never the query string: a query string
    // reaches server logs and Referer headers.
    expect(location.search).not.toContain('token');

    const me = await request(app)
      .get('/api/auth/me')
      .set('authorization', `Bearer ${token}`)
      .expect(200);
    expect(me.body.data.user.role).toBe('CITIZEN');
    expect(me.body.data.citizen.externalId).toBe('CIT-1001');
  });

  it('replaces synthetic links with asserted ones, and records when', async () => {
    const { prisma } = await import('@govflow/core');

    const before = await prisma.identifierLink.findMany({ where: { departmentCode: 'INCOME' } });
    expect(before[0]?.source).toBe('SEED');
    expect(before[0]?.verifiedAt).toBeNull();

    const { token } = await signIn('Rohan Prajapati');

    const response = await request(app)
      .get('/api/auth/me/identifiers')
      .set('authorization', `Bearer ${token}`)
      .expect(200);

    expect(response.body.data.identityProviderLinked).toBe(true);
    expect(response.body.data.identityAssertedAt).toBeTruthy();

    const links = response.body.data.links as {
      departmentCode: string;
      source: string;
      verifiedAt: string | null;
    }[];
    // All four departments, every one of them now attributed to the provider.
    expect(links.map((l) => l.departmentCode).sort()).toEqual([
      'EDUCATION',
      'IDENTITY',
      'INCOME',
      'LEGACY',
    ]);
    expect(links.every((l) => l.source === 'SSO_ASSERTION')).toBe(true);
    expect(links.every((l) => l.verifiedAt !== null)).toBe(true);
  });

  /**
   * Regression. The provider first correlated departments by name, which broke
   * on exactly the citizen the demo runs on: the Education registry knows
   * CIT-1001 as "Rohan P.". Name matching dropped the link silently, and would
   * also have quietly resolved the mismatch the validation layer exists to find.
   */
  it('asserts the education link despite the registry holding an abbreviated name', async () => {
    const { token } = await signIn('Rohan Prajapati');
    const response = await request(app)
      .get('/api/auth/me/identifiers')
      .set('authorization', `Bearer ${token}`)
      .expect(200);

    const education = (response.body.data.links as { departmentCode: string; identifier: string }[])
      .find((l) => l.departmentCode === 'EDUCATION');
    expect(education?.identifier).toBe('STU-1001');
  });

  it('asserts nothing for a department that holds no record for the citizen', async () => {
    // Fatima Shaikh has no education enrolment. The honest outcome is a
    // missing link, not a fabricated identifier.
    await resetDatabase();
    await seedMinimal('CIT-1010');
    const { prisma } = await import('@govflow/core');
    await prisma.identifierLink.deleteMany({ where: { departmentCode: 'EDUCATION' } });

    const { token } = await signIn('Fatima Shaikh');
    const response = await request(app)
      .get('/api/auth/me/identifiers')
      .set('authorization', `Bearer ${token}`)
      .expect(200);

    const departments = (response.body.data.links as { departmentCode: string }[]).map(
      (l) => l.departmentCode,
    );
    expect(departments).not.toContain('EDUCATION');
    expect(departments.sort()).toEqual(['IDENTITY', 'INCOME', 'LEGACY']);
  });
});

describe.skipIf(!available)('the SSO flow refuses what it cannot trust', () => {
  let app: Express;

  beforeAll(async () => {
    const { createApp } = await import('../../apps/api/src/app.js');
    app = createApp();
  });

  beforeEach(async () => {
    await resetDatabase();
    await seedMinimal('CIT-1001');
  });

  /** Bounces are redirects to the login page, not JSON: a browser is mid-journey. */
  async function expectBounce(query: Record<string, string>, reason: string): Promise<void> {
    const response = await request(app).get('/api/auth/sso/callback').query(query).expect(302);
    const location = new URL(response.headers.location as string);
    expect(location.pathname).toBe('/login');
    expect(location.searchParams.get('sso')).toBe(reason);
  }

  it('rejects a callback carrying no code', async () => {
    await expectBounce({ state: 'anything' }, 'cancelled');
  });

  it('rejects a state this API did not sign', async () => {
    await expectBounce({ code: 'made-up', state: 'not-a-real-state' }, 'expired');
  });

  it('rejects a code the provider never issued', async () => {
    const start = await request(app).get('/api/auth/sso/start').expect(302);
    const state = new URL(start.headers.location as string).searchParams.get('state')!;
    await expectBounce({ code: 'never-issued', state }, 'exchange_failed');
  });

  it('will not let a code be redeemed twice', async () => {
    const start = await request(app).get('/api/auth/sso/start').expect(302);
    const state = new URL(start.headers.location as string).searchParams.get('state')!;

    const url = new URL(`${PROVIDER}/authorize`);
    url.searchParams.set('client_id', 'govflow-demo');
    url.searchParams.set('redirect_uri', REDIRECT_URI);
    url.searchParams.set('state', state);
    const accounts = parseAccounts(await (await fetch(url)).text());
    const code = await authorizeAt(accounts[0]!.subject, state);

    await request(app).get('/api/auth/sso/callback').query({ code, state }).expect(302);
    // Replaying a spent code must not mint a second session.
    await expectBounce({ code: code!, state }, 'exchange_failed');
  });

  it('refuses a redirect_uri the provider has not registered', async () => {
    const response = await fetch(`${PROVIDER}/authorize`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        subject: 'MP-0000000000000000',
        redirect_uri: 'http://attacker.example/steal',
        state: '',
      }),
      redirect: 'manual',
    });
    expect(response.status).toBe(400);
    expect(response.headers.get('location')).toBeNull();
  });

  it('refuses a token exchange with the wrong client secret', async () => {
    const response = await fetch(`${PROVIDER}/token`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code: 'irrelevant',
        redirect_uri: REDIRECT_URI,
        client_id: 'govflow-demo',
        client_secret: 'wrong-secret',
      }),
    });
    expect(response.status).toBe(401);
  });

  it('refuses userinfo without a valid access token', async () => {
    const response = await fetch(`${PROVIDER}/userinfo`, {
      headers: { authorization: 'Bearer not-a-token' },
    });
    expect(response.status).toBe(401);
  });
});

describe.skipIf(!available)('identity binding is conservative about re-binding', () => {
  beforeEach(async () => {
    await resetDatabase();
    await seedMinimal('CIT-1001');
  });

  it('refuses a second provider account claiming an already-bound identity', async () => {
    const { bindIdentityAssertion, IdentityBindingError } = await import('@govflow/core');

    const assertion = {
      subject: 'MP-AAAAAAAAAAAAAAAA',
      name: 'Rohan Prajapati',
      birthdate: '2003-05-12',
      district: 'Pune',
      departmentIdentifiers: [{ department: 'IDENTITY', identifier: 'CIT-1001' }],
    };
    await bindIdentityAssertion(assertion);

    // Two assertions claiming the same person is the shape of a takeover. The
    // safe answer is to refuse, not to reassign.
    const error = await bindIdentityAssertion({
      ...assertion,
      subject: 'MP-BBBBBBBBBBBBBBBB',
    }).catch((e) => e);

    expect(error).toBeInstanceOf(IdentityBindingError);
    expect(error.code).toBe('ALREADY_BOUND');
  });

  it('is idempotent when the same account signs in again', async () => {
    const { bindIdentityAssertion, prisma } = await import('@govflow/core');
    const assertion = {
      subject: 'MP-AAAAAAAAAAAAAAAA',
      name: 'Rohan Prajapati',
      birthdate: '2003-05-12',
      district: 'Pune',
      departmentIdentifiers: [
        { department: 'IDENTITY', identifier: 'CIT-1001' },
        { department: 'INCOME', identifier: 'INC-1001' },
      ],
    };

    const first = await bindIdentityAssertion(assertion);
    const second = await bindIdentityAssertion(assertion);

    expect(second.citizenId).toBe(first.citizenId);
    expect(second.userId).toBe(first.userId);
    expect(await prisma.citizen.count()).toBe(1);
  });

  it('refuses an assertion that names no registry identity', async () => {
    const { bindIdentityAssertion, IdentityBindingError } = await import('@govflow/core');
    const error = await bindIdentityAssertion({
      subject: 'MP-CCCCCCCCCCCCCCCC',
      name: 'Nobody',
      birthdate: '2000-01-01',
      district: 'Pune',
      departmentIdentifiers: [{ department: 'INCOME', identifier: 'INC-9999' }],
    }).catch((e) => e);

    expect(error).toBeInstanceOf(IdentityBindingError);
    expect(error.code).toBe('NO_IDENTITY_CLAIM');
  });
});
