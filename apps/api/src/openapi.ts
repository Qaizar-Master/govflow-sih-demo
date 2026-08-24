import { env } from '@govflow/contracts';

const envelope = (dataSchema: object) => ({
  type: 'object',
  required: ['success', 'data', 'error'],
  properties: {
    success: { type: 'boolean', example: true },
    data: dataSchema,
    error: { nullable: true, example: null },
  },
});

const errorResponse = {
  description: 'Standard error envelope',
  content: {
    'application/json': {
      schema: {
        type: 'object',
        required: ['success', 'data', 'error'],
        properties: {
          success: { type: 'boolean', example: false },
          data: { nullable: true, example: null },
          error: {
            type: 'object',
            properties: {
              code: {
                type: 'string',
                enum: [
                  'VALIDATION_ERROR',
                  'UNAUTHORIZED',
                  'FORBIDDEN',
                  'NOT_FOUND',
                  'CONFLICT',
                  'UPSTREAM_ERROR',
                  'INTERNAL_ERROR',
                ],
              },
              message: { type: 'string' },
              details: {},
            },
          },
        },
      },
    },
  },
};

const jsonBody = (schema: object, required = true) => ({
  required,
  content: { 'application/json': { schema } },
});

const okResponse = (description: string, dataSchema: object = { type: 'object' }) => ({
  description,
  content: { 'application/json': { schema: envelope(dataSchema) } },
});

const idParam = {
  name: 'id',
  in: 'path',
  required: true,
  schema: { type: 'string' },
  description: 'Application id (cuid)',
};

const common = {
  400: errorResponse,
  401: errorResponse,
  403: errorResponse,
  404: errorResponse,
};

export const openApiDocument = {
  openapi: '3.0.3',
  info: {
    title: 'GovFlow API',
    version: '1.0.0',
    description: `Government Interoperability & Workflow Orchestration Platform - **prototype**.

All departmental systems behind this API are **simulated** and hold **synthetic data only**.
No real government registry is connected.

Every response uses the envelope \`{ "success": boolean, "data": object|null, "error": object|null }\`.

Authentication is JWT bearer. Roles: \`CITIZEN\`, \`OFFICER\`, \`ADMIN\`; authorisation is
enforced in Express middleware, never in the browser.`,
  },
  servers: [{ url: env.API_BASE_URL, description: 'Local GovFlow API' }],
  tags: [
    { name: 'Auth', description: 'Registration, login and session identity' },
    { name: 'Applications', description: 'Citizen application lifecycle, consent and documents' },
    { name: 'Officer', description: 'Review queue, decisions and the exception queue' },
    { name: 'Admin', description: 'Connector health, failure simulation, audit and metrics' },
    { name: 'Meta', description: 'Health and the published interoperability surface' },
  ],
  components: {
    securitySchemes: {
      bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' },
    },
  },
  security: [{ bearerAuth: [] }],
  paths: {
    '/api/health': {
      get: {
        tags: ['Meta'],
        summary: 'Liveness and dependency check',
        security: [],
        responses: { 200: okResponse('Service status') },
      },
    },
    '/api/meta/departments': {
      get: {
        tags: ['Meta'],
        summary: 'Published contracts of every simulated department, with field mappings',
        security: [],
        responses: { 200: okResponse('Department registry') },
      },
    },
    '/api/meta/services': {
      get: {
        tags: ['Meta'],
        summary: 'The service catalogue: workflow, policy and consent scopes per service',
        description:
          'Three services share one workflow engine and one set of connectors. The difference between them is entirely this configuration.',
        security: [],
        responses: { 200: okResponse('Service catalogue') },
      },
    },
    '/api/auth/register': {
      post: {
        tags: ['Auth'],
        summary: 'Register a citizen account',
        description:
          'Supply `citizenExternalId` (e.g. CIT-1001) to link the login to an existing synthetic registry identity, which is what makes cross-department verification return data.',
        security: [],
        requestBody: jsonBody({
          type: 'object',
          required: ['name', 'email', 'password'],
          properties: {
            name: { type: 'string', example: 'Rohan Prajapati' },
            email: { type: 'string', format: 'email' },
            password: { type: 'string', minLength: 8, example: 'Password@123' },
            citizenExternalId: { type: 'string', example: 'CIT-1001' },
            dateOfBirth: { type: 'string', example: '2003-05-12' },
            district: { type: 'string', example: 'Pune' },
            phone: { type: 'string' },
          },
        }),
        responses: { 201: okResponse('Account created with a JWT'), ...common, 409: errorResponse },
      },
    },
    '/api/auth/login': {
      post: {
        tags: ['Auth'],
        summary: 'Exchange credentials for a JWT',
        security: [],
        requestBody: jsonBody({
          type: 'object',
          required: ['email', 'password'],
          properties: {
            email: { type: 'string', example: 'officer@govflow.gov.in' },
            password: { type: 'string', example: 'Password@123' },
          },
        }),
        responses: { 200: okResponse('Token and user'), 401: errorResponse },
      },
    },
    '/api/auth/me': {
      get: {
        tags: ['Auth'],
        summary: 'Current session identity, citizen record and department',
        responses: { 200: okResponse('Session identity'), 401: errorResponse },
      },
    },
    '/api/applications': {
      get: {
        tags: ['Applications'],
        summary: 'List applications (citizens see only their own)',
        parameters: [
          { name: 'status', in: 'query', schema: { type: 'string' }, description: 'Comma-separated statuses' },
          { name: 'search', in: 'query', schema: { type: 'string' } },
          { name: 'page', in: 'query', schema: { type: 'integer', default: 1 } },
          { name: 'pageSize', in: 'query', schema: { type: 'integer', default: 20 } },
        ],
        responses: { 200: okResponse('Paginated applications with SLA assessment'), ...common },
      },
      post: {
        tags: ['Applications'],
        summary: 'Submit a scholarship application',
        description:
          'Returns immediately with status PROCESSING. Departmental calls run asynchronously on BullMQ - no department is contacted on the request thread.',
        requestBody: jsonBody({
          type: 'object',
          properties: {
            serviceType: {
              type: 'string',
              enum: ['SCHOLARSHIP', 'INCOME_CERTIFICATE', 'RATION_CARD'],
              default: 'SCHOLARSHIP',
            },
            requestedAmount: { type: 'integer', example: 50000 },
            institutionClaim: { type: 'string' },
            consents: {
              type: 'array',
              items: { type: 'string', enum: ['IDENTITY', 'INCOME', 'EDUCATION'] },
              description: 'Scopes consented to at submission time',
            },
          },
        }),
        responses: { 201: okResponse('Application accepted'), ...common },
      },
    },
    '/api/applications/{id}': {
      get: {
        tags: ['Applications'],
        summary: 'Full application detail: verification, documents, timeline, SLA, audit',
        parameters: [idParam],
        responses: { 200: okResponse('Application detail'), ...common },
      },
    },
    '/api/applications/{id}/timeline': {
      get: {
        tags: ['Applications'],
        summary: 'Workflow step timeline with per-step status and retry counts',
        parameters: [idParam],
        responses: { 200: okResponse('Timeline'), ...common },
      },
    },
    '/api/applications/{id}/consent': {
      post: {
        tags: ['Applications'],
        summary: 'Grant or deny consent for one department scope',
        description:
          'Granting the final outstanding scope releases the parked workflow automatically.',
        parameters: [idParam],
        requestBody: jsonBody({
          type: 'object',
          required: ['departmentCode'],
          properties: {
            departmentCode: { type: 'string', enum: ['IDENTITY', 'INCOME', 'EDUCATION'] },
            granted: { type: 'boolean', default: true },
          },
        }),
        responses: { 200: okResponse('Consent recorded'), ...common },
      },
    },
    '/api/applications/{id}/consent/{departmentCode}': {
      delete: {
        tags: ['Applications'],
        summary: 'Revoke a previously granted consent',
        parameters: [
          idParam,
          { name: 'departmentCode', in: 'path', required: true, schema: { type: 'string' } },
        ],
        responses: { 200: okResponse('Consent revoked'), ...common },
      },
    },
    '/api/applications/{id}/documents': {
      post: {
        tags: ['Applications'],
        summary: 'Upload a supporting document (multipart/form-data)',
        description:
          'Accepts text/plain, application/pdf, image/png, image/jpeg up to the configured size limit. OCR and field extraction run immediately.',
        parameters: [idParam],
        requestBody: {
          required: true,
          content: {
            'multipart/form-data': {
              schema: {
                type: 'object',
                required: ['file', 'documentType'],
                properties: {
                  file: { type: 'string', format: 'binary' },
                  documentType: {
                    type: 'string',
                    enum: [
                      'IDENTITY_PROOF',
                      'INCOME_CERTIFICATE',
                      'EDUCATION_CERTIFICATE',
                      'OTHER',
                    ],
                  },
                },
              },
            },
          },
        },
        responses: { 201: okResponse('Document stored with extracted fields'), ...common },
      },
    },
    '/api/applications/{id}/documents/{documentId}': {
      delete: {
        tags: ['Applications'],
        summary: 'Remove an uploaded document',
        parameters: [
          idParam,
          { name: 'documentId', in: 'path', required: true, schema: { type: 'string' } },
        ],
        responses: { 200: okResponse('Deleted'), ...common },
      },
    },
    '/api/applications/{id}/documents/{documentId}/content': {
      get: {
        tags: ['Applications'],
        summary: 'Download the stored document',
        parameters: [
          idParam,
          { name: 'documentId', in: 'path', required: true, schema: { type: 'string' } },
        ],
        responses: { 200: { description: 'File stream' }, ...common },
      },
    },
    '/api/applications/{id}/retry': {
      post: {
        tags: ['Applications'],
        summary: 'Re-queue the first step that has not completed',
        parameters: [idParam],
        responses: { 200: okResponse('Workflow resumed'), ...common },
      },
    },
    '/api/applications/{id}/notes': {
      post: {
        tags: ['Officer'],
        summary: 'Add a review note (officer/admin)',
        parameters: [idParam],
        requestBody: jsonBody({
          type: 'object',
          required: ['note'],
          properties: { note: { type: 'string', minLength: 3 } },
        }),
        responses: { 201: okResponse('Note added'), ...common },
      },
    },
    '/api/officer/metrics': {
      get: {
        tags: ['Officer'],
        summary: 'Queue counters for the officer dashboard',
        responses: { 200: okResponse('Officer metrics'), ...common },
      },
    },
    '/api/officer/applications': {
      get: {
        tags: ['Officer'],
        summary: 'Review queue across all citizens',
        parameters: [
          { name: 'status', in: 'query', schema: { type: 'string' } },
          { name: 'search', in: 'query', schema: { type: 'string' } },
          { name: 'page', in: 'query', schema: { type: 'integer' } },
          { name: 'pageSize', in: 'query', schema: { type: 'integer' } },
        ],
        responses: { 200: okResponse('Paginated queue'), ...common },
      },
    },
    '/api/officer/applications/{id}': {
      get: {
        tags: ['Officer'],
        summary: 'Application detail including officer notes',
        parameters: [idParam],
        responses: { 200: okResponse('Application detail'), ...common },
      },
    },
    '/api/officer/applications/{id}/approve': {
      post: {
        tags: ['Officer'],
        summary: 'Approve an application',
        description: 'The only path to APPROVED. Requires an OFFICER or ADMIN session.',
        parameters: [idParam],
        requestBody: jsonBody({
          type: 'object',
          required: ['notes'],
          properties: { notes: { type: 'string', minLength: 5 } },
        }),
        responses: { 200: okResponse('Approved'), ...common, 409: errorResponse },
      },
    },
    '/api/officer/applications/{id}/reject': {
      post: {
        tags: ['Officer'],
        summary: 'Reject an application',
        parameters: [idParam],
        requestBody: jsonBody({
          type: 'object',
          required: ['notes'],
          properties: { notes: { type: 'string', minLength: 5 } },
        }),
        responses: { 200: okResponse('Rejected'), ...common, 409: errorResponse },
      },
    },
    '/api/officer/applications/{id}/resume': {
      post: {
        tags: ['Officer'],
        summary: 'Re-queue a blocked workflow step',
        parameters: [idParam],
        responses: { 200: okResponse('Resumed'), ...common },
      },
    },
    '/api/officer/exceptions': {
      get: {
        tags: ['Officer'],
        summary: 'Exception queue',
        parameters: [
          { name: 'status', in: 'query', schema: { type: 'string', default: 'OPEN,ACKNOWLEDGED' } },
          { name: 'severity', in: 'query', schema: { type: 'string' } },
        ],
        responses: { 200: okResponse('Exceptions'), ...common },
      },
    },
    '/api/officer/exceptions/{id}/resolve': {
      post: {
        tags: ['Officer'],
        summary: 'Resolve, acknowledge or ignore an exception',
        parameters: [{ ...idParam, description: 'Exception id' }],
        requestBody: jsonBody({
          type: 'object',
          required: ['notes'],
          properties: {
            notes: { type: 'string' },
            status: { type: 'string', enum: ['RESOLVED', 'ACKNOWLEDGED', 'IGNORED'] },
          },
        }),
        responses: { 200: okResponse('Updated'), ...common },
      },
    },
    '/api/notifications': {
      get: {
        tags: ['Applications'],
        summary: 'In-app notifications for the current user (polled)',
        parameters: [
          { name: 'unreadOnly', in: 'query', schema: { type: 'string', enum: ['true', 'false'] } },
          { name: 'limit', in: 'query', schema: { type: 'integer', default: 30 } },
        ],
        responses: { 200: okResponse('Notifications with unread count'), ...common },
      },
    },
    '/api/notifications/{id}/read': {
      patch: {
        tags: ['Applications'],
        summary: 'Mark one notification read',
        parameters: [{ ...idParam, description: 'Notification id' }],
        responses: { 200: okResponse('Marked'), ...common },
      },
    },
    '/api/notifications/read-all': {
      post: {
        tags: ['Applications'],
        summary: 'Mark every notification read',
        responses: { 200: okResponse('Marked'), ...common },
      },
    },
    '/api/admin/metrics': {
      get: {
        tags: ['Admin'],
        summary: 'Platform metrics: applications, SLA, exceptions, connectors, queue, API',
        responses: { 200: okResponse('Metrics'), ...common },
      },
    },
    '/api/admin/health': {
      get: {
        tags: ['Admin'],
        summary: 'Live health of every department connector plus queue and AI status',
        responses: { 200: okResponse('Integration health'), ...common },
      },
    },
    '/api/admin/departments': {
      get: {
        tags: ['Admin'],
        summary: 'Department registry with the full field-mapping specification',
        responses: { 200: okResponse('Departments'), ...common },
      },
    },
    '/api/admin/connectors': {
      get: {
        tags: ['Admin'],
        summary: 'Connector health cards',
        responses: { 200: okResponse('Connector health'), ...common },
      },
    },
    '/api/admin/connectors/{code}/simulate-failure': {
      post: {
        tags: ['Admin'],
        summary: 'Make a department genuinely fail',
        description:
          'Reaches into the simulated department control plane so real connector calls fail, BullMQ retries, and an exception is raised once retries are exhausted.',
        parameters: [
          {
            name: 'code',
            in: 'path',
            required: true,
            schema: { type: 'string', enum: ['IDENTITY', 'INCOME', 'EDUCATION', 'LEGACY'] },
          },
        ],
        requestBody: jsonBody({
          type: 'object',
          properties: {
            mode: {
              type: 'string',
              enum: ['ERROR_500', 'TIMEOUT', 'MALFORMED', 'UNAUTHORIZED'],
              default: 'ERROR_500',
            },
          },
        }),
        responses: { 200: okResponse('Failure armed'), ...common, 502: errorResponse },
      },
    },
    '/api/admin/connectors/{code}/restore': {
      post: {
        tags: ['Admin'],
        summary: 'Restore a department to normal service',
        parameters: [
          { name: 'code', in: 'path', required: true, schema: { type: 'string' } },
        ],
        responses: { 200: okResponse('Restored'), ...common },
      },
    },
    '/api/admin/connectors/{code}/test': {
      post: {
        tags: ['Admin'],
        summary: 'Probe a connector and see the raw payload beside the normalised model',
        parameters: [
          { name: 'code', in: 'path', required: true, schema: { type: 'string' } },
        ],
        requestBody: jsonBody({
          type: 'object',
          properties: { citizenExternalId: { type: 'string', default: 'CIT-1001' } },
        }),
        responses: { 200: okResponse('Probe result'), ...common },
      },
    },
    '/api/admin/legacy/import': {
      post: {
        tags: ['Admin'],
        summary: 'Ingest the legacy CSV beneficiary export',
        description: 'Reads, schema-validates, maps and normalises every row, reporting rejects.',
        responses: { 200: okResponse('Import summary'), ...common, 502: errorResponse },
      },
    },
    '/api/admin/audit': {
      get: {
        tags: ['Admin'],
        summary: 'Audit log',
        parameters: [
          { name: 'action', in: 'query', schema: { type: 'string' } },
          { name: 'resourceType', in: 'query', schema: { type: 'string' } },
          { name: 'page', in: 'query', schema: { type: 'integer' } },
          { name: 'pageSize', in: 'query', schema: { type: 'integer' } },
        ],
        responses: { 200: okResponse('Audit entries'), ...common },
      },
    },
    '/api/admin/connector-logs': {
      get: {
        tags: ['Admin'],
        summary: 'Every connector call with status, latency and error kind',
        parameters: [
          { name: 'connector', in: 'query', schema: { type: 'string' } },
          { name: 'status', in: 'query', schema: { type: 'string', enum: ['SUCCESS', 'FAILURE'] } },
        ],
        responses: { 200: okResponse('Connector logs'), ...common },
      },
    },
    '/api/admin/queue': {
      get: {
        tags: ['Admin'],
        summary: 'BullMQ queue depth',
        responses: { 200: okResponse('Queue counts'), ...common, 502: errorResponse },
      },
    },
  },
} as const;
