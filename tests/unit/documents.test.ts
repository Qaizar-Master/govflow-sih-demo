import { describe, expect, it } from 'vitest';
import { extractFieldsWithRules, toIsoDateSafe } from '@govflow/core';

const INCOME_CERTIFICATE = `GOVERNMENT OF MAHARASHTRA  (SYNTHETIC SPECIMEN)
OFFICE OF THE TAHSILDAR, PUNE

                       INCOME CERTIFICATE

Certificate No: INC/2026/44821
Applicant Name: Rohan Prajapati
District: Pune
Annual Income: INR 180000
Assessment Year: 2026
Date of Issue: 14/04/2026
`;

const EDUCATION_CERTIFICATE = `SINHGAD INSTITUTE OF TECHNOLOGY (SYNTHETIC SPECIMEN)

                     BONAFIDE / EDUCATION CERTIFICATE

Certificate No: EDU/2026/9101
Student Name: Rohan P.
Institution: Sinhgad Institute of Technology
Course: B.E. Computer Engineering
Enrolment Status: ACTIVE
Date of Issue: 02/04/2026
`;

describe('rule-based document extraction', () => {
  it('extracts the fields an officer needs from an income certificate', () => {
    const fields = extractFieldsWithRules(INCOME_CERTIFICATE);
    expect(fields.name).toBe('Rohan Prajapati');
    expect(fields.certificateNumber).toBe('INC/2026/44821');
    expect(fields.annualIncome).toBe(180000);
    expect(fields.issuedDate).toBe('2026-04-14');
    expect(fields.district).toBe('Pune');
  });

  it('extracts institution and course from an education certificate', () => {
    const fields = extractFieldsWithRules(EDUCATION_CERTIFICATE);
    expect(fields.name).toBe('Rohan P.');
    expect(fields.certificateNumber).toBe('EDU/2026/9101');
    expect(fields.institution).toBe('Sinhgad Institute of Technology');
    expect(fields.course).toBe('B.E. Computer Engineering');
    expect(fields.annualIncome).toBeNull();
  });

  it('returns nulls rather than guesses for unreadable text', () => {
    const fields = extractFieldsWithRules('this document has no recognisable structure');
    expect(fields.name).toBeNull();
    expect(fields.annualIncome).toBeNull();
    expect(fields.certificateNumber).toBeNull();
  });

  it('coerces the date formats certificates actually use', () => {
    expect(toIsoDateSafe('14/04/2026')).toBe('2026-04-14');
    expect(toIsoDateSafe('2026-04-14')).toBe('2026-04-14');
    expect(toIsoDateSafe(null)).toBeNull();
    expect(toIsoDateSafe('rubbish')).toBeNull();
  });
});
