import { describe, expect, it } from 'vitest';
import {
  DEPARTMENTS,
  DataType,
  educationMapping,
  identityMapping,
  incomeMapping,
  legacyMapping,
  normalizedRecordSchema,
  deriveSeedIdentifier,
} from '@govflow/contracts';
import { applyMapping, applyTransform, createConnector, getPath, toIsoDate } from '@govflow/connector-sdk';

describe('field mapping engine', () => {
  it('reads nested and missing paths without throwing', () => {
    expect(getPath({ a: { b: { c: 7 } } }, 'a.b.c')).toBe(7);
    expect(getPath({ a: [{ b: 1 }] }, 'a.0.b')).toBe(1);
    expect(getPath({ a: 1 }, 'a.b.c')).toBeUndefined();
    expect(getPath(null, 'a')).toBeUndefined();
  });

  it('coerces the Indian digit grouping the income department emits', () => {
    expect(applyTransform(applyTransform('1,95,000', 'stripCurrency'), 'number')).toBe(195000);
    expect(applyTransform(applyTransform('₹ 2,05,000', 'stripCurrency'), 'number')).toBe(205000);
  });

  it('normalises the several date dialects the departments use', () => {
    expect(toIsoDate('2003-05-12')).toBe('2003-05-12');
    expect(toIsoDate('12/04/2026')).toBe('2026-04-12');
    expect(toIsoDate('5-7-2024')).toBe('2024-07-05');
    expect(toIsoDate('not a date')).toBeUndefined();
  });

  it('cleans the padded upper-case district the identity registry stores', () => {
    const { mapped } = applyMapping(
      { citizenId: 'cit-1009', fullName: '  Vikram   Shinde ', dob: '2001-08-30', district: '  KOLHAPUR ' },
      identityMapping,
    );
    expect(mapped.citizenId).toBe('CIT-1009');
    expect(mapped.name).toBe('Vikram Shinde');
    expect(mapped.district).toBe('Kolhapur');
  });

  it('reports required fields the source did not supply', () => {
    const { missingRequired } = applyMapping({ applicant_id: 'INC-1' }, incomeMapping);
    expect(missingRequired).toContain('name');
    expect(missingRequired).toContain('annualIncome');
    expect(missingRequired).toContain('incomeYear');
  });

  it('maps every department dialect onto the same field names', () => {
    const income = applyMapping(
      { applicant_id: 'INC-1001', name: 'Rohan Prajapati', annualIncome: 180000, incomeYear: 2026 },
      incomeMapping,
    ).mapped;
    const education = applyMapping(
      {
        student_no: 'STU-1001',
        studentName: 'Rohan P.',
        institution_name: 'Sinhgad Institute',
        enrollment_status: 'active',
      },
      educationMapping,
    ).mapped;
    const legacy = applyMapping(
      {
        beneficiary_no: 'BEN1001',
        applicant_name: 'Rohan Prajapati',
        yearly_income: '180000',
        verification_status: 'verified',
        citizen_ref: 'CIT-1001',
      },
      legacyMapping,
    ).mapped;

    // Three different source schemas, one target vocabulary.
    expect(income.citizenId).toBe('INC-1001');
    expect(education.citizenId).toBe('STU-1001');
    expect(legacy.citizenId).toBe('CIT-1001');
    expect(income.name).toBe('Rohan Prajapati');
    expect(education.name).toBe('Rohan P.');
    expect(education.educationStatus).toBe('ACTIVE');
    expect(legacy.verificationStatus).toBe('VERIFIED');
  });
});

describe('connector transform to the common data model', () => {
  it('produces a schema-valid identity record', () => {
    const record = createConnector('IDENTITY').transform({
      citizenId: 'CIT-1001',
      fullName: 'Rohan Prajapati',
      dob: '2003-05-12',
      district: 'Pune',
      gender: 'M',
      status: 'VERIFIED',
    });
    expect(record.dataType).toBe(DataType.IDENTITY);
    expect(normalizedRecordSchema.safeParse(record).success).toBe(true);
  });

  it('produces a schema-valid income record from a string amount', () => {
    const record = createConnector('INCOME').transform({
      applicant_id: 'INC-1009',
      name: 'Vikram Shinde',
      annualIncome: '1,95,000',
      incomeYear: 2026,
    });
    expect(record.dataType).toBe(DataType.INCOME);
    if (record.dataType === DataType.INCOME) {
      expect(record.facts.annualIncome).toBe(195000);
      expect(record.facts.currency).toBe('INR');
    }
  });

  it('rejects a payload missing a required field rather than emitting a partial record', () => {
    expect(() =>
      createConnector('EDUCATION').transform({ student_no: 'STU-1', studentName: 'A' }),
    ).toThrowError(/could not populate required field/i);
  });

  it('flags a schema-breaking payload through validate(), not transform()', () => {
    const result = createConnector('IDENTITY').validate({ wrong: 'shape' });
    expect(result.valid).toBe(false);
    expect(result.issues.length).toBeGreaterThan(0);
  });
});

describe('seed identifier derivation', () => {
  // This helper generates the IdentifierLink rows for the synthetic dataset.
  // It is NOT the runtime crosswalk - resolveDepartmentIdentifier reads the
  // stored link, because real departmental keyspaces are independent and
  // cannot be derived from one another.
  it('produces each department keyspace for the synthetic dataset', () => {
    expect(deriveSeedIdentifier('CIT-1001', 'IDENTITY')).toBe('CIT-1001');
    expect(deriveSeedIdentifier('CIT-1001', 'INCOME')).toBe('INC-1001');
    expect(deriveSeedIdentifier('CIT-1001', 'EDUCATION')).toBe('STU-1001');
    // The legacy export carries an explicit crosswalk column.
    expect(deriveSeedIdentifier('CIT-1001', 'LEGACY')).toBe('CIT-1001');
  });
});

describe('department registry', () => {
  it('configures four departments with genuinely different contracts', () => {
    expect(DEPARTMENTS).toHaveLength(4);
    const auths = DEPARTMENTS.map((d) =>
      d.connector.connectorType === 'REST_JSON' ? d.connector.auth.kind : 'FILE',
    );
    // API key, bearer, basic and file access - four mechanisms, one contract.
    expect(new Set(auths).size).toBe(4);
    expect(new Set(DEPARTMENTS.map((d) => d.mapping.name)).size).toBe(4);
  });
});
