import type { DocumentExtractionResult } from '@govflow/contracts';
import { OCRProcessor } from './ocr.js';
import { extractFields } from './extract.js';

export * from './ocr.js';
export * from './extract.js';
export * from './dates.js';

/**
 * DocumentProcessor
 *   OCRProcessor    -> text layer or optical recognition
 *   GeminiValidator -> structured fields (rules are the always-on floor)
 */
export class DocumentProcessor {
  private readonly ocr = new OCRProcessor();

  async process(
    filePath: string,
    mimeType: string,
    documentType: string,
  ): Promise<DocumentExtractionResult> {
    const ocrResult = await this.ocr.extractText(filePath, mimeType);
    const extraction = await extractFields(ocrResult.text, documentType);

    return {
      ...extraction,
      ocrEngine: ocrResult.engine,
      engineNote: `${ocrResult.note} ${extraction.engineNote}`.trim(),
    };
  }
}

export const documentProcessor = new DocumentProcessor();
