import {
  FINDING_KIND,
  Severity,
  type ValidationFinding,
  type ValidationReport,
} from '@govflow/contracts';
import { createLogger } from '../logger.js';
import { AI_UNAVAILABLE_NOTE, generateJson, isAiEnabled } from './gemini.js';
import { deriveStatus, runRuleBasedValidation, summarise, type ValidationSubject } from './rules.js';

export * from './rules.js';
export * from './names.js';
export { isAiEnabled, AI_UNAVAILABLE_NOTE } from './gemini.js';

const log = createLogger('validation');

const VALID_KINDS = new Set<string>(Object.values(FINDING_KIND));
const VALID_SEVERITIES = new Set<string>(Object.values(Severity));

interface AiValidationResponse {
  summary?: string;
  findings?: {
    kind?: string;
    severity?: string;
    field?: string;
    message?: string;
    confidence?: number;
  }[];
}

const SYSTEM_INSTRUCTION = `You are a data-quality assistant inside GovFlow, a government
interoperability platform. You review already-normalised records that were fetched from
several independent department registries for one scholarship applicant.

Your job is ADVISORY ONLY. You must never state or imply an eligibility decision, an
approval, or a rejection - a human officer decides. Report only observations about data
consistency, completeness and plausibility.

Respond with JSON of the form:
{"summary": string, "findings": [{"kind": string, "severity": "LOW|MEDIUM|HIGH|CRITICAL",
"field": string, "message": string, "confidence": number}]}

"kind" must be one of: NAME_MISMATCH, DOB_MISMATCH, DISTRICT_MISMATCH, INCOME_MISMATCH,
IDENTIFIER_MISMATCH, MISSING_FIELD, MISSING_DOCUMENT, DOCUMENT_FIELD_MISMATCH, STALE_DATA,
ELIGIBILITY_HINT. Keep messages under 200 characters and written for a government officer.`;

function dedupe(findings: ValidationFinding[]): ValidationFinding[] {
  const seen = new Set<string>();
  const out: ValidationFinding[] = [];
  for (const f of findings) {
    const key = `${f.kind}:${f.field}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(f);
  }
  return out;
}

/**
 * Produces the advisory validation report for an application.
 *
 * The deterministic rules ALWAYS run - they are the platform's guarantee. When a
 * Gemini key is configured the model reviews the same evidence and may add
 * observations the rules do not encode; its output is filtered, deduplicated
 * against the rule findings, and clearly labelled. Without a key nothing breaks:
 * the report is identical minus the AI commentary.
 */
export async function produceValidationReport(
  subject: ValidationSubject,
): Promise<ValidationReport> {
  const baseline = runRuleBasedValidation(subject);

  if (!isAiEnabled()) {
    return { ...baseline, engineNote: AI_UNAVAILABLE_NOTE };
  }

  const evidence = {
    identity: subject.identity ?? null,
    income: subject.income ?? null,
    education: subject.education ?? null,
    legacyBeneficiary: subject.legacy ?? null,
    uploadedDocuments: subject.documents.map((d) => ({
      documentType: d.documentType,
      extractedFields: d.extracted ?? null,
    })),
    departmentsUnreachable: subject.unavailableSources ?? [],
    rulesAlreadyFound: baseline.findings.map((f) => ({ kind: f.kind, field: f.field })),
  };

  const ai = await generateJson<AiValidationResponse>(
    SYSTEM_INSTRUCTION,
    `Review this applicant's cross-department evidence and report any data-quality
observations the listed rule findings have not already covered.

${JSON.stringify(evidence, null, 2)}`,
  );

  if (!ai) {
    return {
      ...baseline,
      engineNote: 'Gemini was configured but unreachable - rule-based validation used.',
    };
  }

  const aiFindings: ValidationFinding[] = (ai.findings ?? [])
    .filter((f) => f.kind && VALID_KINDS.has(f.kind) && f.message)
    .map((f) => ({
      kind: f.kind as ValidationFinding['kind'],
      severity: (VALID_SEVERITIES.has(f.severity ?? '')
        ? f.severity
        : Severity.LOW) as ValidationFinding['severity'],
      field: f.field ?? 'general',
      message: `${f.message}`.slice(0, 400),
      observed: {},
      confidence:
        typeof f.confidence === 'number' && f.confidence >= 0 && f.confidence <= 1
          ? Number(f.confidence.toFixed(2))
          : 0.5,
    }));

  // Rule findings come first and win on conflict - AI never overrides them.
  const merged = dedupe([...baseline.findings, ...aiFindings]);
  const aiAdded = merged.length - baseline.findings.length;

  log.info('AI-assisted validation completed', {
    ruleFindings: baseline.findings.length,
    aiAdded,
  });

  return {
    status: deriveStatus(merged),
    engine: 'GEMINI',
    engineNote: `Gemini reviewed the evidence and added ${aiAdded} observation(s) on top of ${baseline.findings.length} rule finding(s).`,
    findings: merged,
    summary: ai.summary ? `${ai.summary}` .slice(0, 600) : summarise(merged),
    generatedAt: new Date().toISOString(),
    advisoryOnly: true,
  };
}
