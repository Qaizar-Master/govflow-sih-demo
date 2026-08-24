import {
  type DocumentExtractionResult,
  type ExtractedDocumentFields,
} from '@govflow/contracts';
import { generateJson, isAiEnabled, AI_UNAVAILABLE_NOTE } from '../validation/gemini.js';
import { toIsoDateSafe } from './dates.js';

const MAX_TEXT_CHARS = 6000;

function firstMatch(text: string, patterns: RegExp[]): string | null {
  for (const pattern of patterns) {
    const m = pattern.exec(text);
    if (m?.[1]) return m[1].trim().replace(/\s+/g, ' ');
  }
  return null;
}

function toNumber(value: string | null): number | null {
  if (!value) return null;
  const n = Number(value.replace(/[^0-9.]/g, ''));
  return Number.isFinite(n) ? n : null;
}

/** Deterministic field extraction. Always available, no network, no key. */
export function extractFieldsWithRules(text: string): ExtractedDocumentFields {
  const name = firstMatch(text, [
    /(?:applicant\s+name|student\s+name|name\s+of\s+(?:applicant|student))\s*[:-]\s*(.+)/i,
    /\bname\s*[:-]\s*(.+)/i,
  ]);
  const certificateNumber = firstMatch(text, [
    /(?:certificate|cert)\.?\s*(?:no\.?|number|id)\s*[:-]\s*(\S+)/i,
    /\bref(?:erence)?\s*(?:no\.?|number)\s*[:-]\s*(\S+)/i,
  ]);
  const income = firstMatch(text, [
    /(?:total\s+)?annual\s+(?:family\s+)?income\s*[:-]\s*(?:inr|rs\.?|₹)?\s*([\d,.]+)/i,
    /\bincome\s*[:-]\s*(?:inr|rs\.?|₹)?\s*([\d,.]+)/i,
  ]);
  const issued = firstMatch(text, [
    /(?:date\s+of\s+issue|issued\s+on|issue\s+date)\s*[:-]\s*(\d{1,4}[/-]\d{1,2}[/-]\d{2,4})/i,
    /\bdate\s*[:-]\s*(\d{1,4}[/-]\d{1,2}[/-]\d{2,4})/i,
  ]);
  const institution = firstMatch(text, [
    /(?:institution|institute|college|university|school)\s*(?:name)?\s*[:-]\s*(.+)/i,
  ]);
  const course = firstMatch(text, [/(?:course|programme|program|branch)\s*[:-]\s*(.+)/i]);
  const district = firstMatch(text, [/\bdistrict\s*[:-]\s*(.+)/i]);

  return {
    name,
    certificateNumber,
    annualIncome: toNumber(income),
    issuedDate: toIsoDateSafe(issued),
    institution,
    course,
    district,
    rawTextLength: text.length,
  };
}

const SYSTEM_INSTRUCTION = `You extract structured fields from Indian government
certificates for a workflow platform. Return ONLY JSON:
{"name": string|null, "certificateNumber": string|null, "annualIncome": number|null,
"issuedDate": "YYYY-MM-DD"|null, "institution": string|null, "course": string|null,
"district": string|null}
Copy values verbatim from the document. Never invent a value; use null when a field is
absent. annualIncome must be a plain number with no separators or currency symbol.`;

/**
 * Field extraction from document text.
 *
 * Rules run first and are always the floor. If Gemini is configured it gets a
 * second pass and fills in fields the regexes missed; it can never blank out a
 * field the rules already found.
 */
export async function extractFields(
  text: string,
  documentType: string,
): Promise<Omit<DocumentExtractionResult, 'ocrEngine'>> {
  const ruleFields = extractFieldsWithRules(text);
  const populated = Object.values(ruleFields).filter((v) => v !== null && v !== undefined).length;
  const textPreview = text.slice(0, 400);

  if (!isAiEnabled()) {
    return {
      fields: { ...ruleFields, documentType },
      engine: 'RULE_BASED',
      engineNote: AI_UNAVAILABLE_NOTE,
      confidence: text.trim().length === 0 ? 0 : Math.min(0.85, populated / 7 + 0.2),
      textPreview,
    };
  }

  const ai = await generateJson<ExtractedDocumentFields>(
    SYSTEM_INSTRUCTION,
    `Document type: ${documentType}\n\n--- DOCUMENT TEXT ---\n${text.slice(0, MAX_TEXT_CHARS)}`,
  );

  if (!ai) {
    return {
      fields: { ...ruleFields, documentType },
      engine: 'RULE_BASED',
      engineNote: 'Gemini was configured but unreachable - rule-based extraction used.',
      confidence: Math.min(0.85, populated / 7 + 0.2),
      textPreview,
    };
  }

  const merged: ExtractedDocumentFields = {
    documentType,
    name: ruleFields.name ?? ai.name ?? null,
    certificateNumber: ruleFields.certificateNumber ?? ai.certificateNumber ?? null,
    annualIncome:
      ruleFields.annualIncome ??
      (typeof ai.annualIncome === 'number' ? ai.annualIncome : null),
    issuedDate: ruleFields.issuedDate ?? toIsoDateSafe(ai.issuedDate ?? null),
    institution: ruleFields.institution ?? ai.institution ?? null,
    course: ruleFields.course ?? ai.course ?? null,
    district: ruleFields.district ?? ai.district ?? null,
    rawTextLength: text.length,
  };

  const mergedPopulated = Object.values(merged).filter((v) => v !== null && v !== undefined).length;

  return {
    fields: merged,
    engine: 'GEMINI',
    engineNote: 'Fields extracted with Gemini, with the rule-based extractor as the floor.',
    confidence: Math.min(0.95, mergedPopulated / 8 + 0.3),
    textPreview,
  };
}
