import type { Severity, ValidationStatus } from './enums.js';

export const FINDING_KIND = {
  NAME_MISMATCH: 'NAME_MISMATCH',
  DOB_MISMATCH: 'DOB_MISMATCH',
  DISTRICT_MISMATCH: 'DISTRICT_MISMATCH',
  INCOME_MISMATCH: 'INCOME_MISMATCH',
  IDENTIFIER_MISMATCH: 'IDENTIFIER_MISMATCH',
  MISSING_FIELD: 'MISSING_FIELD',
  MISSING_DOCUMENT: 'MISSING_DOCUMENT',
  DOCUMENT_FIELD_MISMATCH: 'DOCUMENT_FIELD_MISMATCH',
  DOCUMENT_TYPE_MISMATCH: 'DOCUMENT_TYPE_MISMATCH',
  STALE_DATA: 'STALE_DATA',
  ELIGIBILITY_HINT: 'ELIGIBILITY_HINT',
} as const;
export type FindingKind = (typeof FINDING_KIND)[keyof typeof FINDING_KIND];

export interface ValidationFinding {
  kind: FindingKind;
  severity: Severity;
  field: string;
  message: string;
  /** Value seen per source system, for side-by-side display. */
  observed: Record<string, string | number | null>;
  /** 0-1. Advisory only. */
  confidence: number;
}

export interface ValidationReport {
  status: ValidationStatus;
  /** 'GEMINI' when the AI assisted, 'RULE_BASED' for the deterministic engine. */
  engine: 'GEMINI' | 'RULE_BASED';
  engineNote: string;
  findings: ValidationFinding[];
  summary: string;
  generatedAt: string;
  /** Always true in GovFlow: AI never decides eligibility. */
  advisoryOnly: true;
}

export interface ExtractedDocumentFields {
  documentType?: string;
  name?: string | null;
  certificateNumber?: string | null;
  annualIncome?: number | null;
  issuedDate?: string | null;
  institution?: string | null;
  course?: string | null;
  district?: string | null;
  rawTextLength?: number;
}

export interface DocumentExtractionResult {
  fields: ExtractedDocumentFields;
  engine: 'GEMINI' | 'RULE_BASED';
  ocrEngine: 'TESSERACT' | 'TEXT_LAYER' | 'UNAVAILABLE';
  engineNote: string;
  confidence: number;
  textPreview: string;
}
