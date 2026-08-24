import { z } from 'zod';
import {
  DEPARTMENTS,
  getDepartmentDefinition,
  type DepartmentDefinition,
} from '@govflow/contracts';
import {
  DataType,
  type DepartmentConnector,
  type NormalizedRecord,
} from '@govflow/contracts';
import type { ConnectorContext } from './base-connector.js';
import { CsvConnector, type CsvConnectorContext } from './csv-connector.js';
import { RestConnector } from './rest-connector.js';

const numeric = z.union([z.number(), z.string()]);

/**
 * Connector quality checks report on the DATA, never on scheme eligibility.
 *
 * A connector serves every service, so it cannot know whether an age or an
 * income qualifies for anything - that is per-service policy, applied later by
 * the validation engine. Mixing the two here would mean the Income connector
 * had an opinion about scholarships.
 */
function isPlausibleDateOfBirth(isoDate: string): boolean {
  const dob = new Date(`${isoDate}T00:00:00Z`);
  if (Number.isNaN(dob.getTime())) return false;
  const years = (Date.now() - dob.getTime()) / (365.25 * 24 * 3_600_000);
  return years >= 0 && years <= 120;
}

// ---------------------------------------------------------------------------
// Identity Registry - camelCase schema, API-key auth
// ---------------------------------------------------------------------------
export class IdentityConnector extends RestConnector {
  protected rawSchema = z
    .object({
      citizenId: z.string().min(1),
      fullName: z.string().min(1),
      dob: z.string().min(4),
      district: z.string().min(1),
      gender: z.string().optional(),
      status: z.union([z.string(), z.boolean()]).optional(),
    })
    .passthrough();

  protected override qualityCheck(record: NormalizedRecord): string[] {
    const warnings: string[] = [];
    if (record.dataType !== DataType.IDENTITY) return warnings;
    if (!isPlausibleDateOfBirth(record.facts.dateOfBirth)) {
      warnings.push('Date of birth is missing, unparseable or implausible.');
    }
    if (!record.facts.identityVerified) {
      warnings.push('Identity Registry did not mark this record as verified.');
    }
    return warnings;
  }
}

// ---------------------------------------------------------------------------
// Income Department - snake_case schema, bearer auth
// ---------------------------------------------------------------------------
export class IncomeConnector extends RestConnector {
  protected rawSchema = z
    .object({
      applicant_id: z.string().min(1),
      name: z.string().min(1),
      annualIncome: numeric,
      incomeYear: numeric,
      currency: z.string().optional(),
      certificate_no: z.string().optional(),
    })
    .passthrough();

  protected override qualityCheck(record: NormalizedRecord): string[] {
    const warnings: string[] = [];
    if (record.dataType !== DataType.INCOME) return warnings;
    const currentYear = new Date().getFullYear();
    if (record.facts.annualIncome === 0) {
      warnings.push('Declared annual income is zero - verify against the income certificate.');
    }
    if (currentYear - record.facts.incomeYear >= 2) {
      warnings.push(
        `Income assessment is from ${record.facts.incomeYear} and may be out of date.`,
      );
    }
    if (!record.facts.certificateNumber) {
      warnings.push('Income Department record carries no certificate number.');
    }
    return warnings;
  }
}

// ---------------------------------------------------------------------------
// Education Department - third naming convention, HTTP Basic auth
// ---------------------------------------------------------------------------
export class EducationConnector extends RestConnector {
  protected rawSchema = z
    .object({
      student_no: z.string().min(1),
      studentName: z.string().min(1),
      institution_name: z.string().min(1),
      enrollment_status: z.string().min(1),
      course: z.string().optional(),
      academic_year: z.string().optional(),
      marks_percent: numeric.optional(),
    })
    .passthrough();

  protected override qualityCheck(record: NormalizedRecord): string[] {
    const warnings: string[] = [];
    if (record.dataType !== DataType.EDUCATION) return warnings;
    // Report the fact, not a verdict: whether INACTIVE disqualifies the
    // applicant depends on the service, and is decided by the policy engine.
    if (record.facts.educationStatus !== 'ACTIVE') {
      warnings.push(
        `Education Department reports enrolment status "${record.facts.educationStatus}".`,
      );
    }
    return warnings;
  }
}

// ---------------------------------------------------------------------------
// Legacy Beneficiary System - CSV export, no API
// ---------------------------------------------------------------------------
export class LegacyCsvConnector extends CsvConnector {
  private readonly schema = z
    .object({
      beneficiary_no: z.string().min(1),
      applicant_name: z.string().min(1),
      yearly_income: z.string().optional(),
      verification_status: z.string().min(1),
      citizen_ref: z.string().min(1),
      last_updated: z.string().optional(),
    })
    .passthrough();

  protected rawSchema = this.schema;

  override get rowSchema(): z.ZodTypeAny {
    return this.schema;
  }

  protected override qualityCheck(record: NormalizedRecord): string[] {
    const warnings: string[] = [];
    if (record.dataType !== DataType.LEGACY_BENEFICIARY) return warnings;
    if (record.facts.verificationStatus !== 'VERIFIED') {
      warnings.push(
        `Legacy system reports verification status "${record.facts.verificationStatus}".`,
      );
    }
    if (record.facts.annualIncome === undefined) {
      warnings.push('Legacy export has no income figure for this beneficiary.');
    }
    return warnings;
  }
}

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------
export type ConnectorFactoryContext = CsvConnectorContext;

/**
 * Builds the connector for a department code. Everything outside this module
 * depends on `DepartmentConnector`, never on the concrete classes - which is
 * what keeps department schemas out of the core domain.
 */
export function createConnector(
  code: string,
  ctx: ConnectorFactoryContext = {},
): DepartmentConnector {
  const def: DepartmentDefinition = getDepartmentDefinition(code);
  switch (def.code) {
    case 'IDENTITY':
      return new IdentityConnector(def, ctx as ConnectorContext);
    case 'INCOME':
      return new IncomeConnector(def, ctx as ConnectorContext);
    case 'EDUCATION':
      return new EducationConnector(def, ctx as ConnectorContext);
    case 'LEGACY':
      return new LegacyCsvConnector(def, ctx);
    default:
      throw new Error(`No connector implementation registered for ${def.code}`);
  }
}

export function listConnectorCodes(): string[] {
  return DEPARTMENTS.map((d) => d.code);
}
