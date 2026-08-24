import {
  FINDING_KIND,
  SCHOLARSHIP_SERVICE,
  Severity,
  ValidationStatus,
  type EducationFacts,
  type ExtractedDocumentFields,
  type IdentityFacts,
  type IncomeFacts,
  type LegacyBeneficiaryFacts,
  type ServicePolicy,
  type ValidationFinding,
  type ValidationReport,
} from '@govflow/contracts';
import { compareNames } from './names.js';

export interface ValidationSubject {
  identity?: IdentityFacts | null;
  income?: IncomeFacts | null;
  education?: EducationFacts | null;
  legacy?: LegacyBeneficiaryFacts | null;
  documents: {
    documentType: string;
    extracted?: ExtractedDocumentFields | null;
  }[];
  /** Departments whose lookup failed, so gaps are explained rather than blamed. */
  unavailableSources?: string[];
  /**
   * Eligibility policy for the service being applied for. Defaults to the
   * scholarship scheme so existing callers and tests keep their behaviour.
   */
  policy?: ServicePolicy;
  /** Which departments this service actually consults - a service that never
   *  asks Education must not be told Education data is "missing". */
  expectedSources?: string[];
}

/** Age in whole years, from an ISO date. */
function ageYears(isoDate: string | undefined): number | null {
  if (!isoDate) return null;
  const dob = new Date(`${isoDate}T00:00:00Z`);
  if (Number.isNaN(dob.getTime())) return null;
  return Math.floor((Date.now() - dob.getTime()) / (365.25 * 24 * 3_600_000));
}

/** Numeric suffix of an identifier, used for the cross-department crosswalk. */
function idSuffix(value: string | undefined): string | null {
  if (!value) return null;
  const m = /(\d{3,})\s*$/.exec(value);
  return m ? m[1]! : null;
}

function pct(a: number, b: number): number {
  const base = Math.max(Math.abs(a), Math.abs(b), 1);
  return Math.abs(a - b) / base;
}

/**
 * DETERMINISTIC MISMATCH DETECTION
 * ---------------------------------------------------------------------------
 * This is the baseline that always runs, with or without an AI key. Gemini can
 * add commentary and extra findings on top, but never replaces these rules and
 * never decides eligibility.
 */
export function runRuleBasedValidation(subject: ValidationSubject): ValidationReport {
  const findings: ValidationFinding[] = [];
  const { identity, income, education, legacy, documents } = subject;
  const policy = subject.policy ?? SCHOLARSHIP_SERVICE.policy;
  const expected = new Set(
    subject.expectedSources ?? ['IDENTITY', 'INCOME', 'EDUCATION'],
  );

  // ---- 1. Cross-source name agreement ------------------------------------
  const namedSources: { source: string; name: string }[] = [];
  if (identity?.name) namedSources.push({ source: 'IDENTITY', name: identity.name });
  if (income?.name) namedSources.push({ source: 'INCOME', name: income.name });
  if (education?.name) namedSources.push({ source: 'EDUCATION', name: education.name });
  if (legacy?.name) namedSources.push({ source: 'LEGACY', name: legacy.name });

  const reference = namedSources.find((s) => s.source === 'IDENTITY') ?? namedSources[0];
  if (reference) {
    for (const candidate of namedSources) {
      if (candidate.source === reference.source) continue;
      const comparison = compareNames(reference.name, candidate.name);
      if (comparison.identical) continue;

      findings.push({
        kind: FINDING_KIND.NAME_MISMATCH,
        severity: comparison.abbreviationOnly ? Severity.LOW : Severity.MEDIUM,
        field: 'name',
        message: comparison.abbreviationOnly
          ? `Possible name mismatch: ${candidate.source} records an abbreviated form of the name held by ${reference.source}.`
          : `Possible name mismatch between ${reference.source} and ${candidate.source} (${comparison.explanation}).`,
        observed: {
          [reference.source]: reference.name,
          [candidate.source]: candidate.name,
        },
        confidence: comparison.abbreviationOnly
          ? 0.9
          : Number(Math.min(0.95, 0.5 + (1 - comparison.score) / 2).toFixed(2)),
      });
    }
  }

  // ---- 2. Identifier crosswalk -------------------------------------------
  const suffixes: Record<string, string | null> = {
    IDENTITY: idSuffix(identity?.citizenId),
    INCOME: idSuffix(income?.citizenId),
    EDUCATION: idSuffix(education?.citizenId),
    LEGACY: idSuffix(legacy?.citizenId),
  };
  const presentSuffixes = Object.entries(suffixes).filter(([, v]) => v !== null);
  const distinct = new Set(presentSuffixes.map(([, v]) => v));
  if (presentSuffixes.length > 1 && distinct.size > 1) {
    findings.push({
      kind: FINDING_KIND.IDENTIFIER_MISMATCH,
      severity: Severity.HIGH,
      field: 'citizenId',
      message:
        'Department identifiers do not resolve to the same citizen. The records may belong to different people.',
      observed: Object.fromEntries(
        presentSuffixes.map(([k, v]) => [k, v as string]),
      ),
      confidence: 0.85,
    });
  }

  // ---- 3. Income agreement across sources and documents -------------------
  const incomeDoc = documents.find(
    (d) => d.documentType === 'INCOME_CERTIFICATE' && d.extracted?.annualIncome != null,
  );
  const incomeClaims: { source: string; value: number }[] = [];
  if (income?.annualIncome != null) incomeClaims.push({ source: 'INCOME', value: income.annualIncome });
  if (legacy?.annualIncome != null) incomeClaims.push({ source: 'LEGACY', value: legacy.annualIncome });
  if (incomeDoc?.extracted?.annualIncome != null) {
    incomeClaims.push({ source: 'DOCUMENT', value: incomeDoc.extracted.annualIncome });
  }

  for (let i = 0; i < incomeClaims.length; i += 1) {
    for (let j = i + 1; j < incomeClaims.length; j += 1) {
      const a = incomeClaims[i]!;
      const b = incomeClaims[j]!;
      const delta = pct(a.value, b.value);
      // Registries agreeing to within 1% is rounding, not a discrepancy.
      if (delta <= 0.01) continue;
      findings.push({
        kind:
          a.source === 'DOCUMENT' || b.source === 'DOCUMENT'
            ? FINDING_KIND.DOCUMENT_FIELD_MISMATCH
            : FINDING_KIND.INCOME_MISMATCH,
        // A means-tested scheme turns on the income figure, so a gap beyond
        // 10% between two government sources is an officer-level concern.
        severity: delta > 0.1 ? Severity.HIGH : Severity.MEDIUM,
        field: 'annualIncome',
        message: `Declared annual income differs by ${Math.round(delta * 100)}% between ${a.source} and ${b.source}.`,
        observed: { [a.source]: a.value, [b.source]: b.value },
        confidence: 0.95,
      });
    }
  }

  // ---- 4. Missing sources and fields -------------------------------------
  const unavailable = new Set(subject.unavailableSources ?? []);
  const requiredSources: { key: string; present: boolean; label: string }[] = [
    { key: 'IDENTITY', present: Boolean(identity), label: 'Identity Registry' },
    { key: 'INCOME', present: Boolean(income), label: 'Income Department' },
    { key: 'EDUCATION', present: Boolean(education), label: 'Education Department' },
  ];
  for (const source of requiredSources) {
    // Only complain about a source this service actually consults.
    if (!expected.has(source.key)) continue;
    if (source.present) continue;
    findings.push({
      kind: FINDING_KIND.MISSING_FIELD,
      severity: Severity.HIGH,
      field: source.key.toLowerCase(),
      message: unavailable.has(source.key)
        ? `${source.label} data is missing because the department could not be reached.`
        : `${source.label} returned no record for this applicant.`,
      observed: { [source.key]: null },
      confidence: 1,
    });
  }
  if (identity && !identity.district) {
    findings.push({
      kind: FINDING_KIND.MISSING_FIELD,
      severity: Severity.LOW,
      field: 'district',
      message: 'District is absent from the identity record.',
      observed: { IDENTITY: null },
      confidence: 1,
    });
  }

  // ---- 5. Required documents ---------------------------------------------
  for (const required of policy.requiredDocuments) {
    const present = documents.some((d) => d.documentType === required);
    if (present) continue;
    findings.push({
      kind: FINDING_KIND.MISSING_DOCUMENT,
      severity: Severity.HIGH,
      field: required.toLowerCase(),
      message: `Required document not uploaded: ${required.replace(/_/g, ' ').toLowerCase()}.`,
      observed: { DOCUMENTS: null },
      confidence: 1,
    });
  }

  // ---- 6. Stale data ------------------------------------------------------
  if (income?.incomeYear != null) {
    const age = new Date().getFullYear() - income.incomeYear;
    if (age >= 2) {
      findings.push({
        kind: FINDING_KIND.STALE_DATA,
        severity: Severity.MEDIUM,
        field: 'incomeYear',
        message: `Income assessment year is ${income.incomeYear}, ${age} years old.`,
        observed: { INCOME: income.incomeYear },
        confidence: 1,
      });
    }
  }
  if (legacy && legacy.verificationStatus !== 'VERIFIED') {
    findings.push({
      kind: FINDING_KIND.STALE_DATA,
      severity: Severity.LOW,
      field: 'legacyVerificationStatus',
      message: `Legacy beneficiary system reports status "${legacy.verificationStatus}".`,
      observed: { LEGACY: legacy.verificationStatus },
      confidence: 1,
    });
  }

  // ---- 7. Document field agreement with the registries -------------------
  for (const doc of documents) {
    const extracted = doc.extracted as
      | (typeof doc.extracted & {
          typeCheck?: { matches: boolean; looksLike: string | null; reason: string; confidence: number };
        })
      | null
      | undefined;
    if (!extracted) continue;

    // Advisory type check: the file may simply be the wrong attachment.
    const typeCheck = extracted.typeCheck;
    if (typeCheck && !typeCheck.matches) {
      findings.push({
        kind: FINDING_KIND.DOCUMENT_TYPE_MISMATCH,
        severity: Severity.HIGH,
        field: doc.documentType.toLowerCase(),
        message: `The file uploaded as a ${doc.documentType.replace(/_/g, ' ').toLowerCase()} does not appear to be one. ${typeCheck.reason} Confirm before deciding.`,
        observed: {
          DECLARED: doc.documentType,
          LOOKS_LIKE: typeCheck.looksLike ?? 'unrecognised',
        },
        confidence: typeCheck.confidence,
      });
    }

    if (extracted.name && identity?.name) {
      const cmp = compareNames(identity.name, extracted.name);
      if (!cmp.identical && !cmp.abbreviationOnly && cmp.score < 0.75) {
        findings.push({
          kind: FINDING_KIND.DOCUMENT_FIELD_MISMATCH,
          severity: Severity.MEDIUM,
          field: 'name',
          message: `Name on the uploaded ${doc.documentType.replace(/_/g, ' ').toLowerCase()} does not match the Identity Registry.`,
          observed: { IDENTITY: identity.name, DOCUMENT: extracted.name },
          confidence: 0.8,
        });
      }
    }
    if (extracted.institution && education?.institution) {
      const same =
        extracted.institution.toLowerCase().includes(education.institution.toLowerCase()) ||
        education.institution.toLowerCase().includes(extracted.institution.toLowerCase());
      if (!same) {
        findings.push({
          kind: FINDING_KIND.DOCUMENT_FIELD_MISMATCH,
          severity: Severity.MEDIUM,
          field: 'institution',
          message: 'Institution named on the certificate differs from the education registry.',
          observed: { EDUCATION: education.institution, DOCUMENT: extracted.institution },
          confidence: 0.75,
        });
      }
    }
  }

  // ---- 8. Advisory eligibility hints (NOT a decision) --------------------
  // Every hint below is driven by the service's own policy, so the same engine
  // serves a means-tested benefit and a plain certificate issuance.
  if (
    policy.maxAnnualIncome !== null &&
    income?.annualIncome != null &&
    income.annualIncome > policy.maxAnnualIncome
  ) {
    findings.push({
      kind: FINDING_KIND.ELIGIBILITY_HINT,
      severity: Severity.HIGH,
      field: 'annualIncome',
      message: `Declared income of ${income.annualIncome.toLocaleString('en-IN')} exceeds the scheme ceiling of ${policy.maxAnnualIncome.toLocaleString('en-IN')}. Officer confirmation required.`,
      observed: { INCOME: income.annualIncome, CEILING: policy.maxAnnualIncome },
      confidence: 1,
    });
  }
  if (
    policy.requiredEducationStatus.length > 0 &&
    education?.educationStatus &&
    !policy.requiredEducationStatus.includes(education.educationStatus)
  ) {
    findings.push({
      kind: FINDING_KIND.ELIGIBILITY_HINT,
      severity: Severity.HIGH,
      field: 'educationStatus',
      message: `Enrolment status is "${education.educationStatus}"; the scheme requires ${policy.requiredEducationStatus.join(' or ')}. Officer confirmation required.`,
      observed: { EDUCATION: education.educationStatus },
      confidence: 1,
    });
  }

  const age = ageYears(identity?.dateOfBirth);
  if (age !== null && policy.minAgeYears !== null && age < policy.minAgeYears) {
    findings.push({
      kind: FINDING_KIND.ELIGIBILITY_HINT,
      severity: Severity.MEDIUM,
      field: 'dateOfBirth',
      message: `Applicant is ${age}; this service requires a minimum age of ${policy.minAgeYears}. Officer confirmation required.`,
      observed: { IDENTITY: age, MINIMUM: policy.minAgeYears },
      confidence: 1,
    });
  }
  if (age !== null && policy.maxAgeYears !== null && age > policy.maxAgeYears) {
    findings.push({
      kind: FINDING_KIND.ELIGIBILITY_HINT,
      severity: Severity.MEDIUM,
      field: 'dateOfBirth',
      message: `Applicant is ${age}; this service has an upper age limit of ${policy.maxAgeYears}. Officer confirmation required.`,
      observed: { IDENTITY: age, MAXIMUM: policy.maxAgeYears },
      confidence: 1,
    });
  }

  // Duplicate-benefit check. Only meaningful for services that disburse
  // something, which is why it is a policy flag rather than a global rule.
  if (policy.flagExistingBeneficiary && legacy?.beneficiaryNumber) {
    findings.push({
      kind: FINDING_KIND.ELIGIBILITY_HINT,
      severity: Severity.HIGH,
      field: 'beneficiaryNumber',
      message: `Applicant already appears in the legacy beneficiary register as ${legacy.beneficiaryNumber} (status ${legacy.verificationStatus}). Confirm this is not a duplicate claim.`,
      observed: {
        LEGACY: legacy.beneficiaryNumber,
        STATUS: legacy.verificationStatus,
      },
      confidence: 1,
    });
  }

  return {
    status: deriveStatus(findings),
    engine: 'RULE_BASED',
    engineNote: 'Deterministic rule engine.',
    findings,
    summary: summarise(findings),
    generatedAt: new Date().toISOString(),
    advisoryOnly: true,
  };
}

export function deriveStatus(findings: ValidationFinding[]): ValidationStatus {
  if (findings.length === 0) return ValidationStatus.PASSED;
  const worst = findings.some(
    (f) => f.severity === Severity.CRITICAL || f.severity === Severity.HIGH,
  );
  return worst ? ValidationStatus.FAILED : ValidationStatus.WARNING;
}

export function summarise(findings: ValidationFinding[]): string {
  if (findings.length === 0) {
    return 'All cross-department data agrees and every required document is present. No issues detected.';
  }
  const bySeverity = findings.reduce<Record<string, number>>((acc, f) => {
    acc[f.severity] = (acc[f.severity] ?? 0) + 1;
    return acc;
  }, {});
  const parts = Object.entries(bySeverity)
    .map(([sev, count]) => `${count} ${sev.toLowerCase()}`)
    .join(', ');
  return `${findings.length} item(s) need officer attention (${parts}). GovFlow does not decide eligibility - this is advisory only.`;
}
