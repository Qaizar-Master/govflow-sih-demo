import path from 'node:path';
import fs from 'node:fs';
import dotenv from 'dotenv';
import { z } from 'zod';

/** Walk upwards to the monorepo root so every workspace loads the same .env. */
function findRepoRoot(start: string): string {
  let dir = start;
  for (let i = 0; i < 8; i += 1) {
    if (fs.existsSync(path.join(dir, 'package.json'))) {
      try {
        const pkg = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'));
        if (pkg.name === 'govflow') return dir;
      } catch {
        /* keep walking */
      }
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return start;
}

export const REPO_ROOT = findRepoRoot(process.cwd());

// Container images get their configuration from docker-compose `environment`,
// so a missing .env file is never fatal.
dotenv.config({ path: path.join(REPO_ROOT, '.env') });

const booleanish = z
  .string()
  .optional()
  .transform((v) => v === 'true' || v === '1');

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),

  DATABASE_URL: z
    .string()
    .default('postgresql://govflow:govflow@localhost:5432/govflow?schema=public'),
  REDIS_URL: z.string().default('redis://localhost:6379'),
  /** BullMQ key namespace. Tests override it to stay off the dev queue. */
  REDIS_QUEUE_PREFIX: z.string().default('govflow'),

  JWT_SECRET: z.string().min(8).default('dev-only-change-me-govflow-jwt-secret'),
  JWT_EXPIRES_IN: z.string().default('12h'),
  BCRYPT_ROUNDS: z.coerce.number().int().min(4).max(15).default(10),

  PORT: z.coerce.number().int().default(4000),
  API_BASE_URL: z.string().default('http://localhost:4000'),
  FRONTEND_URL: z.string().default('http://localhost:3000'),
  CORS_ORIGINS: z.string().default('http://localhost:3000'),

  IDENTITY_API_URL: z.string().default('http://localhost:5001'),
  INCOME_API_URL: z.string().default('http://localhost:5002'),
  EDUCATION_API_URL: z.string().default('http://localhost:5003'),
  IDENTITY_API_KEY: z.string().default('identity-demo-key'),
  INCOME_API_TOKEN: z.string().default('income-demo-bearer-token'),
  EDUCATION_BASIC_USER: z.string().default('education'),
  EDUCATION_BASIC_PASS: z.string().default('education-demo-pass'),

  LEGACY_CSV_PATH: z.string().default('./data/legacy/beneficiaries.csv'),

  CONNECTOR_TIMEOUT_MS: z.coerce.number().int().min(200).default(4000),
  WORKFLOW_MAX_ATTEMPTS: z.coerce.number().int().min(1).max(10).default(3),
  WORKFLOW_BACKOFF_MS: z.coerce.number().int().min(100).default(1500),
  SLA_TARGET_DAYS: z.coerce.number().min(0.01).default(5),

  UPLOAD_DIR: z.string().default('./data/uploads'),
  MAX_UPLOAD_BYTES: z.coerce.number().int().default(5 * 1024 * 1024),

  GEMINI_API_KEY: z.string().optional().default(''),
  GEMINI_MODEL: z.string().default('gemini-2.5-flash'),

  DISABLE_WORKER_IN_API: booleanish,
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  const detail = parsed.error.issues
    .map((i) => `  - ${i.path.join('.') || '(root)'}: ${i.message}`)
    .join('\n');
  throw new Error(`Invalid GovFlow environment configuration:\n${detail}`);
}

const raw = parsed.data;

function absolutise(p: string): string {
  return path.isAbsolute(p) ? p : path.resolve(REPO_ROOT, p);
}

export const env = {
  ...raw,
  UPLOAD_DIR: absolutise(raw.UPLOAD_DIR),
  LEGACY_CSV_PATH: absolutise(raw.LEGACY_CSV_PATH),
  corsOrigins: raw.CORS_ORIGINS.split(',')
    .map((s) => s.trim())
    .filter(Boolean),
  /** AI is strictly optional; everything degrades to rule-based validation. */
  aiEnabled: raw.GEMINI_API_KEY.trim().length > 0,
  isProduction: raw.NODE_ENV === 'production',
  isTest: raw.NODE_ENV === 'test',
} as const;

export type Env = typeof env;
