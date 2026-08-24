import fs from 'node:fs/promises';
import path from 'node:path';
import { createLogger } from '../logger.js';

const log = createLogger('ocr');

export type OcrEngine = 'TESSERACT' | 'TEXT_LAYER' | 'UNAVAILABLE';

export interface OcrResult {
  text: string;
  engine: OcrEngine;
  note: string;
}

const TEXT_EXTENSIONS = new Set(['.txt', '.md', '.csv', '.json']);
const TEXT_MIMES = new Set(['text/plain', 'text/markdown', 'text/csv', 'application/json']);

/**
 * Extracts a plain-text layer from an uploaded document.
 *
 * The prototype ships with synthetic text-based certificates, which take the
 * TEXT_LAYER path and always work offline. Scanned images and PDFs go through
 * the optional OCR slot below; if no OCR engine is installed the pipeline
 * degrades to UNAVAILABLE and the officer is told so, rather than the upload
 * failing.
 */
export class OCRProcessor {
  async extractText(filePath: string, mimeType: string): Promise<OcrResult> {
    const ext = path.extname(filePath).toLowerCase();

    if (TEXT_EXTENSIONS.has(ext) || TEXT_MIMES.has(mimeType)) {
      const text = await fs.readFile(filePath, 'utf8');
      return {
        text,
        engine: 'TEXT_LAYER',
        note: 'Read directly from the document text layer.',
      };
    }

    if (ext === '.pdf' || mimeType === 'application/pdf') {
      const text = await this.scanUncompressedPdfText(filePath);
      if (text.trim().length > 0) {
        return {
          text,
          engine: 'TEXT_LAYER',
          note: 'Extracted from the PDF text layer.',
        };
      }
    }

    const viaOcr = await this.tryOpticalRecognition(filePath);
    if (viaOcr) return viaOcr;

    return {
      text: '',
      engine: 'UNAVAILABLE',
      note: 'No text layer found and no OCR engine is installed in this prototype build. Officer review required.',
    };
  }

  /** Pulls text out of PDFs that store it uncompressed - enough for synthetic demo files. */
  private async scanUncompressedPdfText(filePath: string): Promise<string> {
    try {
      const buffer = await fs.readFile(filePath);
      const raw = buffer.toString('latin1');
      const chunks: string[] = [];
      const re = /\(((?:\\.|[^\\()])*)\)\s*Tj/g;
      let match: RegExpExecArray | null;
      while ((match = re.exec(raw)) !== null) {
        chunks.push(match[1]!.replace(/\\([()\\])/g, '$1'));
      }
      return chunks.join('\n');
    } catch {
      return '';
    }
  }

  /**
   * Optional OCR slot. tesseract.js is intentionally NOT a dependency: it pulls
   * a large language model at runtime, which is the wrong trade for a demo that
   * must work offline. Installing it makes this path light up with no code
   * changes elsewhere.
   */
  private async tryOpticalRecognition(filePath: string): Promise<OcrResult | null> {
    try {
      const moduleName = 'tesseract.js';
      const tesseract = (await import(/* @vite-ignore */ moduleName)) as {
        recognize: (
          image: string,
          lang: string,
        ) => Promise<{ data: { text: string } }>;
      };
      const { data } = await tesseract.recognize(filePath, 'eng');
      return {
        text: data.text,
        engine: 'TESSERACT',
        note: 'Optical character recognition via tesseract.js.',
      };
    } catch {
      log.debug('no OCR engine available; skipping optical recognition');
      return null;
    }
  }
}
