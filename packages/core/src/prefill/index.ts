import {
  AuditAction,
  ConsentStatus,
  DataType,
  SOURCE_SYSTEM,
  getDepartmentDefinition,
  prefillableFields,
  type FieldAuthority,
  type NormalizedCitizenData,
} from '@govflow/contracts';
import { isConnectorError } from '@govflow/connector-sdk';
import { prisma } from '../db.js';
import { recordAudit } from '../audit.js';
import { getConnector } from '../connector-registry.js';
import { createLogger } from '../logger.js';
import { resolveDepartmentIdentifier } from '../identity/crosswalk.js';

const log = createLogger('prefill');

/**
 * PRE-FILL
 * ---------------------------------------------------------------------------
 * The product's actual claim: a citizen should not re-type what the government
 * already holds. GovFlow fetches each department's record, walks the service's
 * form schema, and returns the form already answered - with every value
 * attributed to the department that asserted it.
 *
 * Three constraints shape this:
 *
 *   1. It reads. Nothing here writes a departmental record, and nothing here
 *      copies one into a GovFlow master table. What persists is a snapshot of
 *      *what the citizen was shown*, which exists only so the decision can be
 *      reconciled later.
 *   2. It obeys the consent gate. A department with no granted consent is not
 *      contacted; its fields come back CONSENT_REQUIRED rather than blank, so
 *      the citizen can see why the form is empty.
 *   3. It fails visibly. A department that is down yields UNAVAILABLE fields
 *      the citizen can fill in by hand - never a silently empty box that looks
 *      like the registry said nothing.
 */

export type PrefillFieldStatus =
  /** A department answered and the value is on the form. */
  | 'FILLED'
  /** Consent for this department has not been granted, so it was not contacted. */
  | 'CONSENT_REQUIRED'
  /** The department was contacted and could not answer. */
  | 'UNAVAILABLE'
  /** The department answered, but holds nothing for this field. */
  | 'NOT_HELD'
  /** No department holds this field. The citizen is the only source. */
  | 'CITIZEN_SUPPLIED';

export interface PrefilledField {
  key: string;
  label: string;
  authority: FieldAuthority;
  value: string | number | null;
  status: PrefillFieldStatus;
  source: { departmentCode: string; sourceSystem: string; fetchedAt: string } | null;
  /** Present when the department could not answer, so the citizen knows why. */
  note?: string;
}

export interface PrefillResult {
  applicationId: string;
  fields: PrefilledField[];
  /** Departments that were asked and could not answer, or were never asked. */
  unavailable: { departmentCode: string; reason: string }[];
  filledCount: number;
  totalPrefillable: number;
  fetchedAt: string;
}

const DATA_TYPE_BY_DEPARTMENT: Record<string, string> = {
  IDENTITY: DataType.IDENTITY,
  INCOME: DataType.INCOME,
  EDUCATION: DataType.EDUCATION,
  LEGACY: DataType.LEGACY_BENEFICIARY,
};

const SOURCE_SYSTEM_BY_DEPARTMENT: Record<string, string> = {
  IDENTITY: SOURCE_SYSTEM.IDENTITY_REGISTRY,
  INCOME: SOURCE_SYSTEM.INCOME_DEPARTMENT,
  EDUCATION: SOURCE_SYSTEM.EDUCATION_DEPARTMENT,
  LEGACY: SOURCE_SYSTEM.LEGACY_BENEFICIARY_SYSTEM,
};

/**
 * Projects one department's facts onto the common data model.
 *
 * Only the connector layer knows departmental dialects; by the time facts
 * arrive here they are already in the CDM, so this is a projection rather than
 * a translation.
 */
function toCommonModel(dataType: string, facts: Record<string, unknown>): Partial<NormalizedCitizenData> {
  switch (dataType) {
    case DataType.IDENTITY:
      return {
        name: facts.name as string,
        dateOfBirth: facts.dateOfBirth as string,
        district: facts.district as string,
      };
    case DataType.INCOME:
      return {
        annualIncome: facts.annualIncome as number,
        incomeYear: facts.incomeYear as number,
      };
    case DataType.EDUCATION:
      return {
        institution: facts.institution as string,
        course: facts.course as string | undefined,
        educationStatus: facts.educationStatus as string,
      };
    case DataType.LEGACY_BENEFICIARY:
      return { legacyVerificationStatus: facts.verificationStatus as string };
    default:
      return {};
  }
}

/**
 * Fetches every department the form needs and returns the answered form.
 *
 * Persists a snapshot as a side effect: that snapshot is the only record of
 * what the citizen was shown, and without it a later divergence cannot be
 * told apart from a registry that simply changed its mind.
 */
export async function prefillApplication(applicationId: string): Promise<PrefillResult> {
  const application = await prisma.application.findUnique({
    where: { id: applicationId },
    select: { id: true, citizenId: true, serviceType: true },
  });
  if (!application) throw new Error(`Application ${applicationId} not found`);

  const fields = prefillableFields(application.serviceType);
  const departments = [...new Set(fields.map((f) => f.source!.departmentCode))];

  const consents = await prisma.consent.findMany({
    where: { applicationId },
    select: { departmentCode: true, status: true },
  });
  const grantedDepartments = new Set(
    consents.filter((c) => c.status === ConsentStatus.GRANTED).map((c) => c.departmentCode),
  );

  const model: Partial<NormalizedCitizenData> = {};
  const fetchedFrom = new Map<string, string>();
  const departmentState = new Map<string, { status: PrefillFieldStatus; note?: string }>();
  const unavailable: { departmentCode: string; reason: string }[] = [];

  for (const code of departments) {
    if (!grantedDepartments.has(code)) {
      const reason = 'Consent has not been granted for this department.';
      departmentState.set(code, { status: 'CONSENT_REQUIRED', note: reason });
      unavailable.push({ departmentCode: code, reason });
      continue;
    }

    try {
      const { identifier } = await resolveDepartmentIdentifier(application.citizenId, code);
      const connector = await getConnector(code, { applicationId });
      const outcome = await connector.ingest(identifier);

      Object.assign(
        model,
        toCommonModel(outcome.dataType, outcome.normalized.facts as Record<string, unknown>),
      );
      fetchedFrom.set(code, new Date().toISOString());
      departmentState.set(code, { status: 'FILLED' });
    } catch (error) {
      // A department that cannot answer must not silently produce a blank box:
      // an empty field the citizen believes is authoritative is worse than an
      // empty field they know they have to fill in.
      const note = isConnectorError(error)
        ? `${getDepartmentDefinition(code).name} could not be reached (${error.kind}). Please enter this yourself.`
        : 'This department could not be reached. Please enter this yourself.';
      departmentState.set(code, { status: 'UNAVAILABLE', note });
      unavailable.push({ departmentCode: code, reason: note });
      log.warn('prefill could not reach a department', { applicationId, department: code });
    }
  }

  const allFields = prefillableFields(application.serviceType);
  const prefilled: PrefilledField[] = allFields.map((field) => {
    const code = field.source!.departmentCode;
    const state = departmentState.get(code) ?? { status: 'UNAVAILABLE' as PrefillFieldStatus };
    const raw = model[field.source!.cdmField];

    if (state.status !== 'FILLED') {
      return {
        key: field.key,
        label: field.label,
        authority: field.authority,
        value: null,
        status: state.status,
        source: null,
        ...(state.note ? { note: state.note } : {}),
      };
    }

    // The department answered, but may hold nothing for this particular field.
    if (raw === undefined || raw === null || raw === '') {
      return {
        key: field.key,
        label: field.label,
        authority: field.authority,
        value: null,
        status: 'NOT_HELD',
        source: null,
        note: `${getDepartmentDefinition(code).name} holds no value for this.`,
      };
    }

    return {
      key: field.key,
      label: field.label,
      authority: field.authority,
      value: raw as string | number,
      status: 'FILLED',
      source: {
        departmentCode: code,
        sourceSystem: SOURCE_SYSTEM_BY_DEPARTMENT[code] ?? code,
        fetchedAt: fetchedFrom.get(code)!,
      },
    };
  });

  const fetchedAt = new Date().toISOString();
  const filledCount = prefilled.filter((f) => f.status === 'FILLED').length;

  await prisma.prefillSnapshot.upsert({
    where: { applicationId },
    create: {
      applicationId,
      fields: prefilled as never,
      unavailable: unavailable.map((u) => u.departmentCode),
    },
    update: {
      fields: prefilled as never,
      unavailable: unavailable.map((u) => u.departmentCode),
    },
  });

  await recordAudit({
    action: AuditAction.DATA_ACCESSED,
    resourceType: 'Application',
    resourceId: applicationId,
    // Department codes and counts only - never the values themselves.
    metadata: {
      purpose: 'PREFILL',
      departments: [...fetchedFrom.keys()],
      fieldsFilled: filledCount,
    },
  });

  return {
    applicationId,
    fields: prefilled,
    unavailable,
    filledCount,
    totalPrefillable: allFields.length,
    fetchedAt,
  };
}

export { DATA_TYPE_BY_DEPARTMENT, SOURCE_SYSTEM_BY_DEPARTMENT };
