import { describe, expect, it } from 'vitest';
import {
  DEPARTMENTS,
  INCOME_CERTIFICATE_SERVICE,
  RATION_CARD_SERVICE,
  SCHOLARSHIP_SERVICE,
  SERVICES,
  ServiceType,
  getServiceDefinition,
} from '@govflow/contracts';
import { runRuleBasedValidation } from '@govflow/core';

const identity = {
  citizenId: 'CIT-1001',
  name: 'Rohan Prajapati',
  dateOfBirth: '2000-05-12',
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

describe('service catalogue', () => {
  it('offers three services', () => {
    expect(SERVICES).toHaveLength(3);
    expect(SERVICES.map((s) => s.serviceType).sort()).toEqual([
      ServiceType.INCOME_CERTIFICATE,
      ServiceType.RATION_CARD,
      ServiceType.SCHOLARSHIP,
    ]);
  });

  it('rejects an unknown service rather than silently defaulting', () => {
    expect(() => getServiceDefinition('PASSPORT')).toThrowError(/Unknown service type/);
  });

  /**
   * The headline claim of the whole platform: adding a service must not add an
   * integration. If this fails, a new service has smuggled in a new department.
   */
  it('serves every service from the same four connectors', () => {
    const known = new Set(DEPARTMENTS.map((d) => d.code));
    const used = new Set(
      SERVICES.flatMap((s) => s.steps.map((step) => step.departmentCode)).filter(
        (c): c is string => c !== null,
      ),
    );
    for (const code of used) expect(known).toContain(code);
    expect(known.size).toBe(4);
  });

  it('numbers each service’s steps contiguously from 1', () => {
    for (const service of SERVICES) {
      const orders = service.steps.map((s) => s.order);
      expect(orders).toEqual(orders.map((_, i) => i + 1));
    }
  });

  it('ends every service with officer review then a human decision', () => {
    for (const service of SERVICES) {
      const tail = service.steps.slice(-2);
      expect(tail.map((s) => s.stepType)).toEqual(['OFFICER_REVIEW', 'FINAL_DECISION']);
      // Neither may ever be automated - a decision always needs an officer.
      expect(tail.every((s) => s.automated)).toBe(false);
    }
  });
});

describe('services differ in shape, not in machinery', () => {
  it('scholarship consults all four departments', () => {
    const departments = SCHOLARSHIP_SERVICE.steps
      .map((s) => s.departmentCode)
      .filter(Boolean);
    expect(departments).toEqual(['IDENTITY', 'INCOME', 'EDUCATION', 'LEGACY']);
    expect(SCHOLARSHIP_SERVICE.steps).toHaveLength(9);
  });

  it('income certificate skips education entirely', () => {
    const stepTypes = INCOME_CERTIFICATE_SERVICE.steps.map((s) => s.stepType);
    expect(stepTypes).not.toContain('EDUCATION_VERIFICATION');
    expect(stepTypes).not.toContain('LEGACY_CROSS_CHECK');
    // ...and therefore never asks the citizen for education consent.
    expect(
      INCOME_CERTIFICATE_SERVICE.consentScopes.map((c) => c.departmentCode),
    ).toEqual(['IDENTITY', 'INCOME']);
  });

  it('income certificate is an issuance, so it has no means test', () => {
    expect(INCOME_CERTIFICATE_SERVICE.policy.maxAnnualIncome).toBeNull();
    expect(INCOME_CERTIFICATE_SERVICE.policy.requiredDocuments).toEqual([]);
  });

  it('ration card keeps the legacy cross-check and a tighter ceiling', () => {
    const stepTypes = RATION_CARD_SERVICE.steps.map((s) => s.stepType);
    expect(stepTypes).toContain('LEGACY_CROSS_CHECK');
    expect(RATION_CARD_SERVICE.policy.maxAnnualIncome).toBe(180000);
    expect(RATION_CARD_SERVICE.policy.flagExistingBeneficiary).toBe(true);
  });

  it('gives each service its own processing target', () => {
    expect(INCOME_CERTIFICATE_SERVICE.slaTargetDays).toBe(3);
    expect(RATION_CARD_SERVICE.slaTargetDays).toBe(7);
  });
});

describe('validation applies the service’s own policy', () => {
  it('does not report missing education data for a service that never asks', () => {
    const report = runRuleBasedValidation({
      identity,
      income,
      education: null,
      legacy: null,
      documents: [],
      policy: INCOME_CERTIFICATE_SERVICE.policy,
      expectedSources: ['IDENTITY', 'INCOME'],
    });
    expect(report.findings.some((f) => f.field === 'education')).toBe(false);
    // No required documents either, so a clean issuance passes outright.
    expect(report.status).toBe('PASSED');
  });

  it('still reports missing education for the scholarship', () => {
    const report = runRuleBasedValidation({
      identity,
      income,
      education: null,
      legacy: null,
      documents: [],
      policy: SCHOLARSHIP_SERVICE.policy,
      expectedSources: ['IDENTITY', 'INCOME', 'EDUCATION'],
    });
    expect(report.findings.some((f) => f.field === 'education')).toBe(true);
  });

  it('applies no income ceiling to a certificate issuance', () => {
    const report = runRuleBasedValidation({
      identity,
      income: { ...income, annualIncome: 900000 },
      education: null,
      legacy: null,
      documents: [],
      policy: INCOME_CERTIFICATE_SERVICE.policy,
      expectedSources: ['IDENTITY', 'INCOME'],
    });
    expect(report.findings.some((f) => f.kind === 'ELIGIBILITY_HINT')).toBe(false);
  });

  it('flags a possible duplicate claim for the ration card only', () => {
    const legacy = {
      citizenId: 'CIT-1001',
      name: 'Rohan Prajapati',
      annualIncome: 180000,
      verificationStatus: 'VERIFIED',
      beneficiaryNumber: 'BEN1001',
    };
    const subject = {
      identity,
      income,
      education: null,
      legacy,
      documents: [{ documentType: 'INCOME_CERTIFICATE', extracted: null }],
      expectedSources: ['IDENTITY', 'INCOME'],
    };

    const ration = runRuleBasedValidation({ ...subject, policy: RATION_CARD_SERVICE.policy });
    const duplicate = ration.findings.find((f) => f.field === 'beneficiaryNumber');
    expect(duplicate?.message).toMatch(/duplicate claim/i);

    // The scholarship does not disburse against the PDS register, so no flag.
    const scholarship = runRuleBasedValidation({
      ...subject,
      policy: SCHOLARSHIP_SERVICE.policy,
    });
    expect(scholarship.findings.some((f) => f.field === 'beneficiaryNumber')).toBe(false);
  });

  it('flags an applicant below the service minimum age', () => {
    const year = new Date().getFullYear();
    const report = runRuleBasedValidation({
      identity: { ...identity, dateOfBirth: `${year - 12}-01-01` },
      income,
      education: null,
      legacy: null,
      documents: [],
      policy: RATION_CARD_SERVICE.policy,
      expectedSources: ['IDENTITY', 'INCOME'],
    });
    const age = report.findings.find((f) => f.field === 'dateOfBirth');
    expect(age?.message).toMatch(/minimum age of 18/);
  });
});
