import { Router } from 'express';
import { DEPARTMENTS, SERVICES, env } from '@govflow/contracts';
import { prisma } from '@govflow/core';
import { handler } from '../lib/async-handler.js';
import { ok } from '../lib/respond.js';

export const metaRouter = Router();

/** Liveness + dependency check. Unauthenticated on purpose. */
metaRouter.get(
  '/health',
  handler(async (_req, res) => {
    let database = 'up';
    try {
      await prisma.$queryRaw`SELECT 1`;
    } catch {
      database = 'down';
    }
    return ok(res, {
      status: database === 'up' ? 'ok' : 'degraded',
      service: 'govflow-api',
      database,
      aiConfigured: env.aiEnabled,
      timestamp: new Date().toISOString(),
    });
  }),
);

/**
 * Public description of the interoperability surface: which departments exist,
 * what shape they speak and how GovFlow normalises them.
 */
metaRouter.get('/meta/departments', (_req, res) => {
  ok(res, {
    disclaimer:
      'GovFlow is a prototype. All departments below are simulated and hold synthetic data only. No real government system is connected.',
    departments: DEPARTMENTS.map((def) => ({
      code: def.code,
      name: def.name,
      type: def.type,
      description: def.description,
      connectorType: def.connector.connectorType,
      identifierPrefix: def.identifierPrefix,
      blocking: def.blocking,
      auth:
        def.connector.connectorType === 'REST_JSON' ? def.connector.auth.kind : 'FILE_ACCESS',
      endpoint:
        def.connector.connectorType === 'REST_JSON'
          ? `${def.connector.baseUrl}${def.connector.resourcePath}`
          : def.connector.filePath,
      mapping: {
        name: def.mapping.name,
        rules: def.mapping.rules.map((r) => `${r.from} -> ${r.to}`),
      },
    })),
  });
});

/**
 * The service catalogue. Three services share one engine and one set of
 * connectors - the difference between them is entirely this configuration.
 */
metaRouter.get('/meta/services', (_req, res) => {
  ok(res, {
    maxAttempts: env.WORKFLOW_MAX_ATTEMPTS,
    services: SERVICES.map((service) => ({
      serviceType: service.serviceType,
      name: service.name,
      summary: service.summary,
      owningDepartment: service.owningDepartment,
      slaTargetDays: service.slaTargetDays,
      consentScopes: service.consentScopes,
      policy: service.policy,
      steps: service.steps,
      // The headline: no service needs a connector of its own.
      departmentsUsed: [
        ...new Set(service.steps.map((s) => s.departmentCode).filter(Boolean)),
      ],
    })),
  });
});
