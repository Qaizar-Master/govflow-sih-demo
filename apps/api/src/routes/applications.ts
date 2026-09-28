import { Router } from 'express';
import { z } from 'zod';
import {
  ApplicationStatus,
  AuditAction,
  DocumentType,
  Role,
  ServiceType,
  ValidationStatus,
} from '@govflow/contracts';
import {
  addReviewNote,
  createApplication,
  createDraftApplication,
  DraftValidationError,
  documentProcessor,
  getApplicationDetail,
  getTimeline,
  listApplications,
  prefillApplication,
  prisma,
  recordAudit,
  resumeWorkflow,
  revalidateApplication,
  setConsent,
  submitDraftApplication,
  revokeConsent,
} from '@govflow/core';
import { ApiError } from '../lib/api-error.js';
import { handler } from '../lib/async-handler.js';
import { ok } from '../lib/respond.js';
import { safeDisplayName, uploadDocument } from '../lib/uploads.js';
import {
  assertApplicationAccess,
  assertOfficerScope,
  authenticate,
  requireRole,
} from '../middleware/auth.js';
import { validateBody, validateQuery } from '../middleware/validate.js';

export const applicationsRouter = Router();
applicationsRouter.use(authenticate);

const createSchema = z.object({
  serviceType: z.nativeEnum(ServiceType).optional(),
  requestedAmount: z.coerce.number().int().min(0).max(1_000_000).optional(),
  institutionClaim: z.string().trim().max(160).optional(),
  /** Consent scopes the citizen granted on the submission form. Scopes that do
   *  not apply to the chosen service are simply ignored. */
  consents: z.array(z.enum(['IDENTITY', 'INCOME', 'EDUCATION'])).default([]),
});

/**
 * The draft lifecycle: open, pre-fill, submit.
 *
 * Kept distinct from POST /applications, which submits in one shot. Pre-fill
 * needs an application to exist first, because consent is recorded per
 * application and no department may be contacted without it.
 */
const draftSchema = z.object({ serviceType: z.nativeEnum(ServiceType) });

applicationsRouter.post(
  '/draft',
  requireRole(Role.CITIZEN),
  validateBody(draftSchema),
  handler(async (req, res) => {
    const body = req.body as z.infer<typeof draftSchema>;
    const citizenId = req.user!.citizenId;
    if (!citizenId) throw ApiError.badRequest('This account is not linked to a citizen record');

    const draft = await createDraftApplication({
      citizenId,
      serviceType: body.serviceType,
      actorUserId: req.user!.id,
    });

    return ok(
      res,
      {
        applicationId: draft.id,
        applicationNumber: draft.applicationNumber,
        status: draft.status,
        consents: draft.consents.map((c) => ({
          departmentCode: c.departmentCode,
          purpose: c.purpose,
          status: c.status,
        })),
      },
      201,
    );
  }),
);

/**
 * Answers the form from the departments the citizen has consented to.
 *
 * A POST rather than a GET: it contacts external systems and records both an
 * audit entry and the snapshot the later reconciliation depends on. Calling it
 * twice is safe - the snapshot is replaced, not appended.
 */
applicationsRouter.post(
  '/:id/prefill',
  requireRole(Role.CITIZEN),
  handler(async (req, res) => {
    const applicationId = req.params.id!;
    await assertApplicationAccess(req, applicationId);

    const application = await prisma.application.findUniqueOrThrow({
      where: { id: applicationId },
      select: { status: true },
    });
    if (application.status !== ApplicationStatus.DRAFT) {
      throw ApiError.conflict('This application has already been submitted');
    }

    return ok(res, await prefillApplication(applicationId));
  }),
);

const submitSchema = z.object({
  values: z.record(z.union([z.string(), z.number(), z.null()])),
});

applicationsRouter.post(
  '/:id/submit',
  requireRole(Role.CITIZEN),
  validateBody(submitSchema),
  handler(async (req, res) => {
    const applicationId = req.params.id!;
    await assertApplicationAccess(req, applicationId);
    const body = req.body as z.infer<typeof submitSchema>;

    try {
      const submitted = await submitDraftApplication({
        applicationId,
        values: body.values,
        actorUserId: req.user!.id,
      });
      return ok(res, {
        applicationId: submitted.id,
        applicationNumber: submitted.applicationNumber,
        status: submitted.status,
      });
    } catch (error) {
      if (error instanceof DraftValidationError) {
        throw ApiError.badRequest(error.message, error.fieldErrors);
      }
      if (error instanceof Error && error.message.includes('already been submitted')) {
        throw ApiError.conflict(error.message);
      }
      throw error;
    }
  }),
);

const listQuerySchema = z.object({
  status: z.string().optional(),
  search: z.string().trim().max(120).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

function parseStatuses(raw?: string): ApplicationStatus[] | undefined {
  if (!raw) return undefined;
  const valid = new Set<string>(Object.values(ApplicationStatus));
  const parsed = raw
    .split(',')
    .map((s) => s.trim().toUpperCase())
    .filter((s) => valid.has(s)) as ApplicationStatus[];
  return parsed.length ? parsed : undefined;
}

// ---------------------------------------------------------------------------
// POST /api/applications - returns immediately; the workflow runs on the queue
// ---------------------------------------------------------------------------
applicationsRouter.post(
  '/',
  requireRole(Role.CITIZEN),
  validateBody(createSchema),
  handler(async (req, res) => {
    const user = req.user!;
    if (!user.citizenId) {
      throw ApiError.badRequest('This account is not linked to a citizen record');
    }
    const body = req.body as z.infer<typeof createSchema>;

    const application = await createApplication({
      citizenId: user.citizenId,
      serviceType: body.serviceType,
      requestedAmount: body.requestedAmount ?? null,
      institutionClaim: body.institutionClaim ?? null,
      grantedConsents: body.consents,
      actorUserId: user.id,
    });

    const outstanding = application.consents.filter((c) => c.status !== 'GRANTED').length;

    return ok(
      res,
      {
        applicationId: application.id,
        applicationNumber: application.applicationNumber,
        status: application.status,
        currentStep: application.currentStep,
        outstandingConsents: outstanding,
        message:
          outstanding > 0
            ? 'Application created. Cross-department verification starts as soon as the remaining consents are granted.'
            : 'Application created. Cross-department verification has been queued.',
      },
      201,
    );
  }),
);

// ---------------------------------------------------------------------------
// GET /api/applications
// ---------------------------------------------------------------------------
applicationsRouter.get(
  '/',
  validateQuery(listQuerySchema),
  handler(async (req, res) => {
    const user = req.user!;
    const query = req.query as unknown as z.infer<typeof listQuerySchema>;

    const result = await listApplications({
      // A citizen only ever sees their own applications, enforced here.
      citizenId: user.role === Role.CITIZEN ? user.citizenId ?? '__none__' : undefined,
      statuses: parseStatuses(query.status),
      search: query.search,
      page: query.page,
      pageSize: query.pageSize,
    });

    return ok(res, result);
  }),
);

// ---------------------------------------------------------------------------
// GET /api/applications/:id
// ---------------------------------------------------------------------------
applicationsRouter.get(
  '/:id',
  handler(async (req, res) => {
    await assertApplicationAccess(req, req.params.id!);
    const detail = await getApplicationDetail(req.params.id!);
    if (!detail) throw ApiError.notFound('Application not found');

    // Citizens see their own audit trail but not internal officer notes.
    if (req.user!.role === Role.CITIZEN) {
      return ok(res, { ...detail, reviewNotes: [] });
    }
    return ok(res, detail);
  }),
);

applicationsRouter.get(
  '/:id/timeline',
  handler(async (req, res) => {
    await assertApplicationAccess(req, req.params.id!);
    return ok(res, { timeline: await getTimeline(req.params.id!) });
  }),
);

// ---------------------------------------------------------------------------
// Consent
// ---------------------------------------------------------------------------
const consentSchema = z.object({
  departmentCode: z.enum(['IDENTITY', 'INCOME', 'EDUCATION']),
  granted: z.boolean().default(true),
});

applicationsRouter.post(
  '/:id/consent',
  requireRole(Role.CITIZEN),
  validateBody(consentSchema),
  handler(async (req, res) => {
    const applicationId = req.params.id!;
    await assertApplicationAccess(req, applicationId);
    const body = req.body as z.infer<typeof consentSchema>;

    const result = await setConsent({
      applicationId,
      departmentCode: body.departmentCode,
      granted: body.granted,
      actorUserId: req.user!.id,
    });

    return ok(res, {
      consent: {
        id: result.consent.id,
        departmentCode: result.consent.departmentCode,
        status: result.consent.status,
        grantedAt: result.consent.grantedAt?.toISOString() ?? null,
      },
      outstandingConsents: result.outstanding,
      workflowResumed: result.outstanding === 0,
    });
  }),
);

applicationsRouter.delete(
  '/:id/consent/:departmentCode',
  requireRole(Role.CITIZEN),
  handler(async (req, res) => {
    const applicationId = req.params.id!;
    await assertApplicationAccess(req, applicationId);
    const consent = await revokeConsent({
      applicationId,
      departmentCode: req.params.departmentCode!,
      actorUserId: req.user!.id,
    });
    return ok(res, { id: consent.id, status: consent.status });
  }),
);

// ---------------------------------------------------------------------------
// Documents
// ---------------------------------------------------------------------------
applicationsRouter.post(
  '/:id/documents',
  requireRole(Role.CITIZEN),
  uploadDocument,
  handler(async (req, res) => {
    const applicationId = req.params.id!;
    await assertApplicationAccess(req, applicationId);

    const file = req.file;
    if (!file) throw ApiError.badRequest('No file was uploaded under the field name "file"');

    const documentType = String(req.body?.documentType ?? '').toUpperCase();
    if (!Object.values(DocumentType).includes(documentType as DocumentType)) {
      throw ApiError.badRequest(
        `documentType must be one of: ${Object.values(DocumentType).join(', ')}`,
      );
    }

    const document = await prisma.document.create({
      data: {
        applicationId,
        documentType: documentType as never,
        fileName: safeDisplayName(file.originalname),
        storagePath: file.path,
        mimeType: file.mimetype,
        sizeBytes: file.size,
        extractionStatus: 'PROCESSING' as never,
      },
    });

    await recordAudit({
      action: AuditAction.DOCUMENT_UPLOADED,
      resourceType: 'Document',
      resourceId: document.id,
      userId: req.user!.id,
      actorRole: Role.CITIZEN,
      // Never the contents - only what is needed to trace the upload.
      metadata: {
        applicationId,
        documentType,
        mimeType: file.mimetype,
        sizeBytes: file.size,
      },
    });

    // Extraction is fast for the text-layer documents the prototype uses, so it
    // runs inline and the citizen sees the parsed fields immediately. The
    // workflow's document step re-runs it for anything uploaded later.
    let extraction = null;
    try {
      const result = await documentProcessor.process(
        document.storagePath,
        document.mimeType,
        documentType,
      );
      await prisma.document.update({
        where: { id: document.id },
        data: {
          extractionStatus: 'COMPLETED' as never,
          extractedData: result.fields as never,
          extractionEngine: `${result.ocrEngine}+${result.engine}`,
          validationStatus: (result.ocrEngine === 'UNAVAILABLE'
            ? ValidationStatus.WARNING
            : ValidationStatus.PASSED) as never,
          validationNotes: result.engineNote,
        },
      });
      extraction = {
        engine: result.engine,
        ocrEngine: result.ocrEngine,
        note: result.engineNote,
        confidence: result.confidence,
        fields: result.fields,
      };
    } catch {
      await prisma.document.update({
        where: { id: document.id },
        data: {
          extractionStatus: 'FAILED' as never,
          validationStatus: ValidationStatus.WARNING as never,
          validationNotes: 'Extraction failed; officer review required.',
        },
      });
    }

    // If the automated passes already ran, new evidence must be re-assessed
    // rather than sitting unnoticed behind a completed step.
    const { requeued } = await revalidateApplication(applicationId, { userId: req.user!.id });

    return ok(
      res,
      {
        id: document.id,
        documentType,
        fileName: document.fileName,
        sizeBytes: document.sizeBytes,
        extraction,
        revalidationQueued: requeued,
      },
      201,
    );
  }),
);

applicationsRouter.delete(
  '/:id/documents/:documentId',
  requireRole(Role.CITIZEN),
  handler(async (req, res) => {
    const applicationId = req.params.id!;
    await assertApplicationAccess(req, applicationId);
    const document = await prisma.document.findFirst({
      where: { id: req.params.documentId!, applicationId },
    });
    if (!document) throw ApiError.notFound('Document not found on this application');
    await prisma.document.delete({ where: { id: document.id } });
    return ok(res, { id: document.id, deleted: true });
  }),
);

// ---------------------------------------------------------------------------
// Citizen-initiated retry (e.g. after a department is restored)
// ---------------------------------------------------------------------------
applicationsRouter.post(
  '/:id/retry',
  handler(async (req, res) => {
    const applicationId = req.params.id!;
    await assertApplicationAccess(req, applicationId);
    const result = await resumeWorkflow(applicationId, { userId: req.user!.id });
    return ok(res, {
      resumedStep: result.resumedStep,
      message: result.resumedStep
        ? `Workflow resumed at ${result.resumedStep}.`
        : 'Nothing to resume - this application has already been decided.',
    });
  }),
);

// ---------------------------------------------------------------------------
// Notes (officers only, but mounted here so the resource path stays natural)
// ---------------------------------------------------------------------------
const noteSchema = z.object({ note: z.string().trim().min(3).max(2000) });

applicationsRouter.post(
  '/:id/notes',
  requireRole(Role.OFFICER, Role.ADMIN),
  validateBody(noteSchema),
  handler(async (req, res) => {
    const applicationId = req.params.id!;
    // Same department scope as the queue: an officer cannot annotate a file
    // they are not competent to decide.
    await assertOfficerScope(req, applicationId);

    const note = await addReviewNote(
      applicationId,
      req.user!.id,
      (req.body as z.infer<typeof noteSchema>).note,
    );
    return ok(
      res,
      {
        id: note.id,
        note: note.note,
        author: note.author,
        createdAt: note.createdAt.toISOString(),
      },
      201,
    );
  }),
);

// ---------------------------------------------------------------------------
// Document download - officers need to read what the citizen actually uploaded
// ---------------------------------------------------------------------------
applicationsRouter.get(
  '/:id/documents/:documentId/content',
  handler(async (req, res) => {
    const applicationId = req.params.id!;
    await assertApplicationAccess(req, applicationId);

    const document = await prisma.document.findFirst({
      where: { id: req.params.documentId!, applicationId },
      select: { storagePath: true, fileName: true, mimeType: true },
    });
    if (!document) throw ApiError.notFound('Document not found on this application');

    // storagePath is server-generated, never client-supplied, so it cannot
    // escape the upload directory.
    res.setHeader('content-type', document.mimeType);
    res.setHeader('content-disposition', `inline; filename="${document.fileName}"`);
    res.sendFile(document.storagePath, (error) => {
      if (error && !res.headersSent) {
        res.status(410).json({
          success: false,
          data: null,
          error: { code: 'NOT_FOUND', message: 'The stored file is no longer available' },
        });
      }
    });
    return res;
  }),
);

// ---------------------------------------------------------------------------
// Explicit re-validation (also triggered automatically on document upload)
// ---------------------------------------------------------------------------
applicationsRouter.post(
  '/:id/revalidate',
  handler(async (req, res) => {
    const applicationId = req.params.id!;
    await assertApplicationAccess(req, applicationId);
    const { requeued } = await revalidateApplication(applicationId, { userId: req.user!.id });
    return ok(res, {
      requeued,
      message: requeued
        ? 'Document validation and mismatch detection have been re-queued.'
        : 'Nothing to re-validate: the automated checks have not run yet, or the application is already decided.',
    });
  }),
);
