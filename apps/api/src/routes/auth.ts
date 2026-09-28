import { Router } from 'express';
import { z } from 'zod';
import { AuditAction, Role } from '@govflow/contracts';
import {
  hashPassword,
  listIdentifierLinks,
  prisma,
  recordAudit,
  verifyPassword,
} from '@govflow/core';
import { ApiError } from '../lib/api-error.js';
import { handler } from '../lib/async-handler.js';
import { ok } from '../lib/respond.js';
import { signToken } from '../lib/tokens.js';
import { authenticate } from '../middleware/auth.js';
import { validateBody } from '../middleware/validate.js';

export const authRouter = Router();

const emailSchema = z.string().trim().toLowerCase().email().max(160);

const registerSchema = z.object({
  name: z.string().trim().min(2).max(120),
  email: emailSchema,
  password: z
    .string()
    .min(8, 'Password must be at least 8 characters')
    .max(128)
    .regex(/[A-Za-z]/, 'Password must contain a letter')
    .regex(/\d/, 'Password must contain a digit'),
  /**
   * Optional link to an existing synthetic registry identity (e.g. CIT-1001).
   * Supplying one is what makes cross-department verification return data.
   */
  citizenExternalId: z.string().trim().toUpperCase().max(24).optional(),
  dateOfBirth: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'Expected YYYY-MM-DD')
    .optional(),
  district: z.string().trim().min(2).max(80).optional(),
  phone: z.string().trim().max(24).optional(),
});

const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1).max(128),
});

async function nextCitizenExternalId(): Promise<string> {
  // Self-registered citizens are allocated from a separate range so they never
  // collide with the pre-seeded synthetic registry identities.
  const count = await prisma.citizen.count();
  return `CIT-${2000 + count + 1}`;
}

authRouter.post(
  '/register',
  validateBody(registerSchema),
  handler(async (req, res) => {
    const body = req.body as z.infer<typeof registerSchema>;

    const existing = await prisma.user.findUnique({ where: { email: body.email } });
    if (existing) throw ApiError.conflict('An account with this email already exists');

    let citizenId: string;
    let registryDataAvailable = true;

    if (body.citizenExternalId) {
      const citizen = await prisma.citizen.findUnique({
        where: { externalId: body.citizenExternalId },
        include: { user: { select: { id: true } } },
      });
      if (!citizen) {
        throw ApiError.badRequest(
          `No citizen record exists for ${body.citizenExternalId} in the synthetic registry`,
        );
      }
      if (citizen.user) {
        throw ApiError.conflict(
          `${body.citizenExternalId} already has a GovFlow login. Sign in instead.`,
        );
      }
      citizenId = citizen.id;
    } else {
      if (!body.dateOfBirth || !body.district) {
        throw ApiError.badRequest(
          'Date of birth and district are required when no existing registry identifier is supplied',
        );
      }
      const created = await prisma.citizen.create({
        data: {
          externalId: await nextCitizenExternalId(),
          name: body.name,
          dateOfBirth: new Date(`${body.dateOfBirth}T00:00:00Z`),
          district: body.district,
          email: body.email,
          phone: body.phone ?? null,
        },
      });
      citizenId = created.id;
      // Nothing in the simulated departments knows this new identity, so
      // verification will legitimately come back empty. Say so up front.
      registryDataAvailable = false;
    }

    const user = await prisma.user.create({
      data: {
        name: body.name,
        email: body.email,
        passwordHash: await hashPassword(body.password),
        role: Role.CITIZEN as never,
        citizenId,
      },
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        departmentId: true,
        citizenId: true,
      },
    });

    await recordAudit({
      action: AuditAction.USER_REGISTERED,
      resourceType: 'User',
      resourceId: user.id,
      userId: user.id,
      actorRole: Role.CITIZEN,
      metadata: { linkedExistingRegistryIdentity: Boolean(body.citizenExternalId) },
      ipAddress: req.ip ?? null,
    });

    const token = signToken({
      sub: user.id,
      email: user.email,
      role: user.role as Role,
      departmentId: user.departmentId,
    });

    return ok(
      res,
      {
        token,
        user,
        registryDataAvailable,
        notice: registryDataAvailable
          ? null
          : 'This is a brand-new identity, so the simulated departments hold no records for it. Cross-department verification will report missing data. To see a full end-to-end run, register against an existing synthetic identity such as CIT-1001.',
      },
      201,
    );
  }),
);

authRouter.post(
  '/login',
  validateBody(loginSchema),
  handler(async (req, res) => {
    const { email, password } = req.body as z.infer<typeof loginSchema>;

    const user = await prisma.user.findUnique({ where: { email } });
    if (!user || !(await verifyPassword(password, user.passwordHash))) {
      await recordAudit({
        action: AuditAction.USER_LOGIN_FAILED,
        resourceType: 'User',
        resourceId: email,
        metadata: { reason: 'invalid credentials' },
        ipAddress: req.ip ?? null,
      });
      // One message for both cases: never reveal whether an email is registered.
      throw ApiError.unauthorized('Email or password is incorrect');
    }

    await recordAudit({
      action: AuditAction.USER_LOGIN,
      resourceType: 'User',
      resourceId: user.id,
      userId: user.id,
      actorRole: user.role as Role,
      ipAddress: req.ip ?? null,
    });

    const token = signToken({
      sub: user.id,
      email: user.email,
      role: user.role as Role,
      departmentId: user.departmentId,
    });

    return ok(res, {
      token,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
        departmentId: user.departmentId,
        citizenId: user.citizenId,
      },
    });
  }),
);

authRouter.get(
  '/me',
  authenticate,
  handler(async (req, res) => {
    const user = req.user!;
    const citizen = user.citizenId
      ? await prisma.citizen.findUnique({
          where: { id: user.citizenId },
          select: {
            externalId: true,
            name: true,
            dateOfBirth: true,
            district: true,
            email: true,
            phone: true,
          },
        })
      : null;
    const department = user.departmentId
      ? await prisma.department.findUnique({
          where: { id: user.departmentId },
          select: { code: true, name: true },
        })
      : null;

    return ok(res, {
      user,
      citizen: citizen
        ? { ...citizen, dateOfBirth: citizen.dateOfBirth.toISOString().slice(0, 10) }
        : null,
      department,
    });
  }),
);

/**
 * The citizen's departmental identifiers and where each one came from.
 *
 * Surfaced deliberately: provenance that nobody can see is provenance nobody
 * checks. A link marked SEED is synthetic demo data and says so; one marked
 * SSO_ASSERTION was vouched for by the identity provider at a stated time.
 */
authRouter.get(
  '/me/identifiers',
  authenticate,
  handler(async (req, res) => {
    const user = req.user!;
    if (!user.citizenId) return ok(res, { identityAssertedAt: null, links: [] });

    const [citizen, links] = await Promise.all([
      prisma.citizen.findUnique({
        where: { id: user.citizenId },
        select: { identityAssertedAt: true, ssoSubject: true },
      }),
      listIdentifierLinks(user.citizenId),
    ]);

    return ok(res, {
      identityAssertedAt: citizen?.identityAssertedAt?.toISOString() ?? null,
      identityProviderLinked: Boolean(citizen?.ssoSubject),
      links: Object.entries(links)
        .map(([departmentCode, link]) => ({
          departmentCode,
          identifier: link.identifier,
          source: link.source,
          verifiedAt: link.verifiedAt?.toISOString() ?? null,
        }))
        .sort((a, b) => a.departmentCode.localeCompare(b.departmentCode)),
    });
  }),
);
