import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import multer from 'multer';
import { env } from '@govflow/contracts';

/** Only formats the document pipeline can actually read. */
const ALLOWED = new Map<string, string>([
  ['text/plain', '.txt'],
  ['application/pdf', '.pdf'],
  ['image/png', '.png'],
  ['image/jpeg', '.jpg'],
]);

fs.mkdirSync(env.UPLOAD_DIR, { recursive: true });

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, env.UPLOAD_DIR),
  filename: (_req, file, cb) => {
    // The client-supplied name is never used on disk: a random name plus an
    // extension derived from the allow-list removes any path-traversal or
    // double-extension risk.
    const ext = ALLOWED.get(file.mimetype) ?? '.bin';
    cb(null, `${Date.now()}-${crypto.randomBytes(8).toString('hex')}${ext}`);
  },
});

export const uploadDocument = multer({
  storage,
  limits: { fileSize: env.MAX_UPLOAD_BYTES, files: 1 },
  fileFilter: (_req, file, cb) => {
    if (!ALLOWED.has(file.mimetype)) {
      const error = new Error(
        `Unsupported file type: ${file.mimetype}. Allowed: ${[...ALLOWED.keys()].join(', ')}`,
      );
      // Tagged so the error middleware can answer 400 rather than 500.
      (error as NodeJS.ErrnoException).code = 'UNSUPPORTED_FILE_TYPE';
      cb(error);
      return;
    }
    cb(null, true);
  },
}).single('file');

/** Display name kept for the UI, stripped of anything path-like. */
export function safeDisplayName(original: string): string {
  return path
    .basename(original)
    .replace(/[^\w.\- ]/g, '_')
    .slice(0, 120);
}
