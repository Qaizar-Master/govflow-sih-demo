import { formFields, type FieldAuthority } from '@govflow/contracts';
import { prisma } from '../db.js';
import { assembleFacts } from '../workflow/facts.js';
import type { PrefilledField } from './index.js';

/**
 * RECONCILIATION
 * ---------------------------------------------------------------------------
 * Pre-fill is the promise; this is the proof.
 *
 * Filling a form automatically is a convenience. What makes it *evidence* is
 * being able to show, at decision time, that the value on the application is
 * still the value the department asserts - and, where it is not, exactly who
 * changed it and when.
 *
 * Three values are compared per field:
 *
 *   prefilled  what the registry said when the citizen opened the form
 *   submitted  what the citizen actually sent
 *   verified   what the registry said when the workflow checked
 *
 * Two identical-looking mismatches mean opposite things, and separating them
 * is the entire reason all three are kept. If the citizen's figure differs
 * from a registry that never moved, the citizen changed it. If the citizen's
 * figure matches what they were shown but the registry has since moved, the
 * registry changed and the applicant did nothing wrong. Only the first
 * deserves suspicion, and an officer should never have to guess which they are
 * looking at.
 */

export type ReconciliationVerdict =
  /** Submitted value agrees with the registry. */
  | 'MATCH'
  /** The citizen altered a value the registry still asserts. Worth a look. */
  | 'CITIZEN_EDITED'
  /** The citizen submitted what they were shown; the registry has since moved. */
  | 'REGISTRY_CHANGED'
  /** Prefilled, submitted and verified all disagree. */
  | 'DIVERGENT'
  /** Shown and submitted agree, but the department has not been re-checked yet. */
  | 'AWAITING_VERIFICATION'
  /** No registry holds this field - the citizen is the only source. */
  | 'CITIZEN_DECLARED'
  /** Nothing to compare against: no prefill and no verification. */
  | 'NO_EVIDENCE';

export interface ReconciliationRow {
  key: string;
  label: string;
  authority: FieldAuthority;
  prefilled: string | number | null;
  submitted: string | number | null;
  verified: string | number | null;
  verdict: ReconciliationVerdict;
  explanation: string;
  departmentCode: string | null;
}

export interface ReconciliationReport {
  rows: ReconciliationRow[];
  /** Rows an officer should actually look at. */
  attentionCount: number;
  matchedCount: number;
  /** True once there is anything to reconcile at all. */
  available: boolean;
}

/**
 * Values arrive from a form (strings), a registry (typed) and JSON (either).
 * Comparing them raw would report a mismatch between 180000 and "180000",
 * which is a bug wearing the costume of a finding.
 */
function comparable(value: unknown): string | null {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value === 'number') return String(value);
  const text = String(value).trim();
  if (text === '') return null;
  const asNumber = Number(text);
  if (!Number.isNaN(asNumber) && text !== '' && /^-?\d+(\.\d+)?$/.test(text)) {
    return String(asNumber);
  }
  return text.toLowerCase();
}

const same = (a: unknown, b: unknown): boolean => comparable(a) === comparable(b);

function present(value: unknown): value is string | number {
  return value !== null && value !== undefined && value !== '';
}

/**
 * Builds the officer-facing reconciliation for one application.
 *
 * Returns `available: false` rather than an empty report when the application
 * predates pre-fill: an empty table reads as "nothing diverged", which is a
 * very different claim from "nothing was checked".
 */
export async function reconcileApplication(applicationId: string): Promise<ReconciliationReport> {
  const application = await prisma.application.findUnique({
    where: { id: applicationId },
    select: { serviceType: true, submittedValues: true },
  });
  if (!application) return { rows: [], attentionCount: 0, matchedCount: 0, available: false };

  const submitted = (application.submittedValues ?? null) as Record<string, unknown> | null;
  if (!submitted) return { rows: [], attentionCount: 0, matchedCount: 0, available: false };

  const snapshot = await prisma.prefillSnapshot.findUnique({ where: { applicationId } });
  const prefilledByKey = new Map<string, PrefilledField>(
    ((snapshot?.fields as unknown as PrefilledField[]) ?? []).map((f) => [f.key, f]),
  );

  const facts = await assembleFacts(applicationId);
  const verified = facts.consolidated as unknown as Record<string, unknown>;

  const rows: ReconciliationRow[] = formFields(application.serviceType).map((field) => {
    const prefilledField = prefilledByKey.get(field.key);
    const prefilledValue = prefilledField?.status === 'FILLED' ? prefilledField.value : null;
    const submittedValue = (submitted[field.key] ?? null) as string | number | null;
    const verifiedValue = field.source
      ? ((verified[field.source.cdmField] ?? null) as string | number | null)
      : null;

    const base = {
      key: field.key,
      label: field.label,
      authority: field.authority,
      prefilled: prefilledValue,
      submitted: submittedValue,
      verified: verifiedValue,
      departmentCode: field.source?.departmentCode ?? null,
    };

    if (!field.source) {
      return {
        ...base,
        verdict: 'CITIZEN_DECLARED' as const,
        explanation: 'No department holds this. The citizen is the only source.',
      };
    }

    if (!present(verifiedValue) && !present(prefilledValue)) {
      return {
        ...base,
        verdict: 'NO_EVIDENCE' as const,
        explanation: 'No departmental value was available to compare against.',
      };
    }

    const matchesVerified = present(verifiedValue) && same(submittedValue, verifiedValue);
    const matchesPrefilled = present(prefilledValue) && same(submittedValue, prefilledValue);
    const registryMoved =
      present(prefilledValue) && present(verifiedValue) && !same(prefilledValue, verifiedValue);

    // Verification has not run, or the department could not be reached. Only
    // the shown-versus-submitted half of the comparison is knowable, and
    // reporting the unknown half as a disagreement would manufacture a finding
    // out of a step that simply has not happened yet.
    if (!present(verifiedValue)) {
      if (matchesPrefilled) {
        return {
          ...base,
          verdict: 'AWAITING_VERIFICATION' as const,
          explanation:
            'The citizen submitted what they were shown. The department has not been re-checked yet.',
        };
      }
      return {
        ...base,
        verdict: 'CITIZEN_EDITED' as const,
        explanation:
          'The citizen changed the value they were shown. The department has not been re-checked yet.',
      };
    }

    if (matchesVerified && !registryMoved) {
      return {
        ...base,
        verdict: 'MATCH' as const,
        explanation: 'Submitted value matches the department record. Not re-keyed.',
      };
    }

    if (registryMoved && matchesPrefilled) {
      return {
        ...base,
        verdict: 'REGISTRY_CHANGED' as const,
        explanation:
          'The citizen submitted exactly what they were shown; the department record has changed since. Not an applicant error.',
      };
    }

    if (!matchesPrefilled && present(prefilledValue) && !registryMoved) {
      return {
        ...base,
        verdict: 'CITIZEN_EDITED' as const,
        explanation:
          'The citizen changed a value the department still asserts. Worth confirming before deciding.',
      };
    }

    if (matchesVerified) {
      return {
        ...base,
        verdict: 'MATCH' as const,
        explanation: 'Submitted value matches the current department record.',
      };
    }

    return {
      ...base,
      verdict: 'DIVERGENT' as const,
      explanation:
        'What was shown, what was submitted and what the department now says all differ.',
    };
  });

  const ATTENTION: ReconciliationVerdict[] = ['CITIZEN_EDITED', 'DIVERGENT'];
  return {
    rows,
    attentionCount: rows.filter((r) => ATTENTION.includes(r.verdict)).length,
    matchedCount: rows.filter((r) => r.verdict === 'MATCH').length,
    available: true,
  };
}
