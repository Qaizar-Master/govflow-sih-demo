import cors from 'cors';
import express from 'express';
import helmet from 'helmet';
import swaggerUi from 'swagger-ui-express';
import { env } from '@govflow/contracts';
import { createLogger } from '@govflow/core';
import { errorHandler, notFoundHandler } from './middleware/error.js';
import { observe } from './middleware/observe.js';
import { openApiDocument } from './openapi.js';
import { adminRouter } from './routes/admin.js';
import { applicationsRouter } from './routes/applications.js';
import { authRouter } from './routes/auth.js';
import { metaRouter } from './routes/meta.js';
import { notificationsRouter } from './routes/notifications.js';
import { officerRouter } from './routes/officer.js';
import { ssoRouter } from './routes/sso.js';

const log = createLogger('api');

/** Builds the Express app. Exported separately so tests can mount it directly. */
export function createApp() {
  const app = express();

  app.set('trust proxy', 1);
  app.disable('x-powered-by');

  app.use(
    helmet({
      // Swagger UI needs inline styles; the API serves no other HTML.
      contentSecurityPolicy: false,
      crossOriginEmbedderPolicy: false,
    }),
  );

  app.use(
    cors({
      origin: (origin, callback) => {
        // Same-origin/server-to-server requests arrive without an Origin.
        if (!origin || env.corsOrigins.includes(origin)) return callback(null, true);
        callback(new Error(`Origin ${origin} is not allowed by CORS policy`));
      },
      credentials: true,
      methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
    }),
  );

  app.use(express.json({ limit: '256kb' }));
  app.use(express.urlencoded({ extended: false, limit: '256kb' }));
  app.use(observe);

  // ---- API documentation -------------------------------------------------
  app.get('/openapi.json', (_req, res) => {
    res.json(openApiDocument);
  });
  app.use(
    '/docs',
    swaggerUi.serve,
    swaggerUi.setup(openApiDocument as unknown as swaggerUi.JsonObject, {
      customSiteTitle: 'GovFlow API',
      swaggerOptions: { persistAuthorization: true, docExpansion: 'list' },
    }),
  );

  // ---- Routes ------------------------------------------------------------
  app.use('/api', metaRouter);
  // Mounted before authRouter so the SSO paths are matched first.
  app.use('/api/auth/sso', ssoRouter);
  app.use('/api/auth', authRouter);
  app.use('/api/applications', applicationsRouter);
  app.use('/api/notifications', notificationsRouter);
  app.use('/api/officer', officerRouter);
  app.use('/api/admin', adminRouter);

  app.get('/', (_req, res) => {
    res.json({
      service: 'GovFlow API',
      description:
        'Government Interoperability & Workflow Orchestration Platform (prototype, synthetic data only)',
      documentation: '/docs',
      openapi: '/openapi.json',
      health: '/api/health',
    });
  });

  app.use(notFoundHandler);
  app.use(errorHandler);

  log.info('express app constructed', {
    corsOrigins: env.corsOrigins,
    aiConfigured: env.aiEnabled,
  });

  return app;
}
