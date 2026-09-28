import crypto from 'node:crypto';
import { AuditAction, IdentifierLinkSource, Role } from '@govflow/contracts';
import { prisma } from '../db.js';
import { recordAudit } from '../audit.js';
import { hashPassword } from '../password.js';
import { createLogger } from '../logger.js';
import { linkDepartmentIdentifier } from './crosswalk.js';

const log = createLogger('sso');

/**
 * What an identity provider tells GovFlow about a person.
 *
 * Note what is absent: no password, no document, no address, no income. An
 * assertion answers exactly two questions - who this is, and how they are
 * keyed at each department - and those two answers are the whole reason
 * GovFlow may query a registry on their behalf.
 */
export interface IdentityAssertion {
  /** Pairwise subject from the provider. Opaque; never a registry identifier. */
  subject: string;
  name: string;
  /** YYYY-MM-DD. */
  birthdate: string;
  district: string;
  departmentIdentifiers: { department: string; identifier: string }[];
}

export interface BindingResult {
  userId: string;
  citizenId: string;
  citizenExternalId: string;
  /** True when this assertion created the GovFlow account rather than matching one. */
  created: boolean;
  linkedDepartments: string[];
}

export class IdentityBindingError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = 'IdentityBindingError';
    this.code = code;
  }
}

function slugify(name: string): string {
  return name.toLowerCase().replace(/[^a-z]+/g, '.').replace(/^\.|\.$/g, '');
}

/**
 * Binds an identity assertion to a GovFlow account.
 *
 * This is the step Phase A left as a hole. Before it, GovFlow trusted its own
 * `User.citizenId` row - a link it had written itself - and then queried four
 * departments on the strength of it. Now the departmental identifiers arrive
 * from the provider that actually knows them, and every resulting
 * `IdentifierLink` is stamped `SSO_ASSERTION` with the time it was asserted.
 *
 * Deliberately conservative: a citizen already bound to a different subject is
 * an error, never a silent re-bind. Two assertions claiming the same person is
 * the exact shape of an account-takeover, and the safe answer is to refuse and
 * let a human look.
 */
export async function bindIdentityAssertion(
  assertion: IdentityAssertion,
  context: { ipAddress?: string | null } = {},
): Promise<BindingResult> {
  const identityClaim = assertion.departmentIdentifiers.find((d) => d.department === 'IDENTITY');
  if (!identityClaim) {
    throw new IdentityBindingError(
      'NO_IDENTITY_CLAIM',
      'The assertion carries no Identity Registry identifier, so there is nothing to bind to.',
    );
  }

  let citizen = await prisma.citizen.findUnique({ where: { ssoSubject: assertion.subject } });
  let created = false;

  if (!citizen) {
    const byRegistryId = await prisma.citizen.findUnique({
      where: { externalId: identityClaim.identifier },
    });

    if (byRegistryId) {
      if (byRegistryId.ssoSubject && byRegistryId.ssoSubject !== assertion.subject) {
        throw new IdentityBindingError(
          'ALREADY_BOUND',
          'This registry identity is already bound to a different identity-provider account.',
        );
      }
      citizen = byRegistryId;
    } else {
      citizen = await prisma.citizen.create({
        data: {
          externalId: identityClaim.identifier,
          name: assertion.name,
          dateOfBirth: new Date(`${assertion.birthdate}T00:00:00Z`),
          district: assertion.district,
        },
      });
      created = true;
    }
  }

  citizen = await prisma.citizen.update({
    where: { id: citizen.id },
    data: { ssoSubject: assertion.subject, identityAssertedAt: new Date() },
  });

  // The identifiers are the payload that matters: they are what makes a
  // departmental lookup addressed rather than guessed.
  const verifiedAt = new Date();
  const linkedDepartments: string[] = [];
  for (const claim of assertion.departmentIdentifiers) {
    try {
      await linkDepartmentIdentifier({
        citizenId: citizen.id,
        departmentCode: claim.department,
        externalIdentifier: claim.identifier,
        source: IdentifierLinkSource.SSO_ASSERTION,
        verifiedAt,
      });
      linkedDepartments.push(claim.department);
    } catch {
      // A department GovFlow does not know about is the provider's business,
      // not an error: assert what we can use, ignore the rest.
      log.warn('assertion named an unknown department', { department: claim.department });
    }
  }

  let user = await prisma.user.findUnique({ where: { citizenId: citizen.id } });
  if (!user) {
    // No password is set that anyone can use: this account signs in through the
    // provider. A random hash keeps the column honest without creating a
    // credential.
    const passwordHash = await hashPassword(crypto.randomBytes(24).toString('base64url'));
    const base = slugify(assertion.name) || 'citizen';
    let email = `${base}@example.gov.in`;
    if (await prisma.user.findUnique({ where: { email } })) {
      email = `${base}.${citizen.externalId.toLowerCase()}@example.gov.in`;
    }
    user = await prisma.user.create({
      data: {
        name: assertion.name,
        email,
        passwordHash,
        role: Role.CITIZEN as never,
        citizenId: citizen.id,
      },
    });
    created = true;
  }

  await recordAudit({
    action: AuditAction.IDENTITY_ASSERTED,
    resourceType: 'Citizen',
    resourceId: citizen.id,
    userId: user.id,
    actorRole: Role.CITIZEN,
    // Subject and department codes only - never the identifiers themselves.
    metadata: {
      provider: 'MERIPEHCHAAN_SIMULATED',
      subject: assertion.subject,
      linkedDepartments,
      accountCreated: created,
    },
    ipAddress: context.ipAddress ?? null,
  });

  log.info('identity assertion bound', {
    citizenId: citizen.id,
    linkedDepartments,
    created,
  });

  return {
    userId: user.id,
    citizenId: citizen.id,
    citizenExternalId: citizen.externalId,
    created,
    linkedDepartments,
  };
}
