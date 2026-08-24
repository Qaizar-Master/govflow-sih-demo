import { describe, expect, it } from 'vitest';
import { FINDING_KIND, Severity, ValidationStatus } from '@govflow/contracts';
import { compareNames, runRuleBasedValidation } from '@govflow/core';

const identity = {
  citizenId: 'CIT-1001',
  name: 'Rohan Prajapati',
  dateOfBirth: '2003-05-12',
  district: 'Pune',
  identityVerified: true,
};
const income = {
  citizenId: 'INC-1001',
  name: 'Rohan Prajapati',
  annualIncome: 180000,
  incomeYear: new Date().getFullYear(),
  currency: 'INR',
  certificateNumber: 'INC/2026/44821',
};
const education = {
  citizenId: 'STU-1001',
  name: 'Rohan Prajapati',
  institution: 'Sinhgad Institute of Technology',
  educationStatus: 'ACTIVE',
};
const bothDocuments = [
  { documentType: 'INCOME_CERTIFICATE', extracted: { name: 'Rohan Prajapati', annualIncome: 180000 } },
  { documentType: 'EDUCATION_CERTIFICATE', extracted: { name: 'Rohan Prajapati' } },
];

describe('name comparison', () => {
  it('treats an abbreviated surname as an abbreviation, not a different person', () => {
    const result = compareNames('Rohan Prajapati', 'Rohan P.');
    expect(result.identical).toBe(false);
    expect(result.abbreviationOnly).toBe(true);
  });

  it('recognises identical names regardless of spacing and case', () => {
    expect(compareNames('Rohan  Prajapati', 'rohan prajapati').identical).toBe(true);
  });

  it('flags genuinely different names', () => {
    const result = compareNames('Rohan Prajapati', 'Aditya Sharma');
    expect(result.abbreviationOnly).toBe(false);
    expect(result.score).toBeLessThan(0.5);
  });

  it('ignores honorifics', () => {
    expect(compareNames('Shri Rohan Prajapati', 'Rohan Prajapati').identical).toBe(false);
    expect(compareNames('Shri Rohan Prajapati', 'Rohan Prajapati').score).toBe(1);
  });
});

describe('rule-based mismatch detection', () => {
  it('passes cleanly when every source agrees', () => {
    const report = runRuleBasedValidation({
      identity,
      income,
      education,
      legacy: null,
      documents: bothDocuments,
    });
    expect(report.findings).toHaveLength(0);
    expect(report.status).toBe(ValidationStatus.PASSED);
    expect(report.advisoryOnly).toBe(true);
    expect(report.engine).toBe('RULE_BASED');
  });

  it('detects the education-department name abbreviation as a LOW finding', () => {
    const report = runRuleBasedValidation({
      identity,
      income,
      education: { ...education, name: 'Rohan P.' },
      legacy: null,
      documents: bothDocuments,
    });
    const finding = report.findings.find((f) => f.kind === FINDING_KIND.NAME_MISMATCH);
    expect(finding).toBeDefined();
    expect(finding?.severity).toBe(Severity.LOW);
    expect(finding?.observed.EDUCATION).toBe('Rohan P.');
    // An abbreviation alone must not fail the application.
    expect(report.status).toBe(ValidationStatus.WARNING);
  });

  it('detects an income disagreement between the registry and the legacy export', () => {
    const report = runRuleBasedValidation({
      identity,
      income,
      education,
      legacy: {
        citizenId: 'CIT-1001',
        name: 'Rohan Prajapati',
        annualIncome: 205000,
        verificationStatus: 'VERIFIED',
        beneficiaryNumber: 'BEN1001',
      },
      documents: bothDocuments,
    });
    const finding = report.findings.find((f) => f.kind === FINDING_KIND.INCOME_MISMATCH);
    expect(finding).toBeDefined();
    // 180,000 vs 205,000 is a 12% gap - material for a means-tested scheme.
    expect(finding?.severity).toBe(Severity.HIGH);
    expect(finding?.message).toMatch(/12%/);
  });

  it('grades a small income difference as MEDIUM rather than HIGH', () => {
    const report = runRuleBasedValidation({
      identity,
      income,
      education,
      legacy: {
        citizenId: 'CIT-1001',
        name: 'Rohan Prajapati',
        annualIncome: 186000,
        verificationStatus: 'VERIFIED',
        beneficiaryNumber: 'BEN1001',
      },
      documents: bothDocuments,
    });
    const finding = report.findings.find((f) => f.kind === FINDING_KIND.INCOME_MISMATCH);
    expect(finding?.severity).toBe(Severity.MEDIUM);
  });

  it('reports a missing required document', () => {
    const report = runRuleBasedValidation({
      identity,
      income,
      education,
      legacy: null,
      documents: [{ documentType: 'EDUCATION_CERTIFICATE', extracted: null }],
    });
    const finding = report.findings.find((f) => f.kind === FINDING_KIND.MISSING_DOCUMENT);
    expect(finding?.field).toBe('income_certificate');
    expect(report.status).toBe(ValidationStatus.FAILED);
  });

  it('explains a gap caused by an unreachable department', () => {
    const report = runRuleBasedValidation({
      identity,
      income: null,
      education,
      legacy: null,
      documents: bothDocuments,
      unavailableSources: ['INCOME'],
    });
    const finding = report.findings.find((f) => f.field === 'income');
    expect(finding?.message).toMatch(/could not be reached/i);
  });

  it('raises an advisory eligibility hint above the income ceiling without deciding', () => {
    const report = runRuleBasedValidation({
      identity,
      income: { ...income, annualIncome: 480000 },
      education,
      legacy: null,
      documents: bothDocuments,
    });
    const hint = report.findings.find((f) => f.kind === FINDING_KIND.ELIGIBILITY_HINT);
    expect(hint?.message).toMatch(/Officer confirmation required/i);
    expect(report.advisoryOnly).toBe(true);
  });

  it('flags a stale income assessment year', () => {
    const report = runRuleBasedValidation({
      identity,
      income: { ...income, incomeYear: new Date().getFullYear() - 3 },
      education,
      legacy: null,
      documents: bothDocuments,
    });
    expect(report.findings.some((f) => f.kind === FINDING_KIND.STALE_DATA)).toBe(true);
  });

  it('flags identifiers that do not resolve to the same citizen', () => {
    const report = runRuleBasedValidation({
      identity,
      income: { ...income, citizenId: 'INC-9999' },
      education,
      legacy: null,
      documents: bothDocuments,
    });
    const finding = report.findings.find((f) => f.kind === FINDING_KIND.IDENTIFIER_MISMATCH);
    expect(finding?.severity).toBe(Severity.HIGH);
  });
});
