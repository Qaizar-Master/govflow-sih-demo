import {
  DataType,
  SOURCE_SYSTEM,
  type EducationFacts,
  type IdentityFacts,
  type IncomeFacts,
  type LegacyBeneficiaryFacts,
  type NormalizedCitizenData,
} from '@govflow/contracts';
import { prisma } from '../db.js';

export interface AssembledFacts {
  identity: IdentityFacts | null;
  income: IncomeFacts | null;
  education: EducationFacts | null;
  legacy: LegacyBeneficiaryFacts | null;
  /** Consolidated profile with per-field provenance, for the officer UI. */
  consolidated: NormalizedCitizenData;
  receivedAt: Record<string, string>;
}

const SOURCE_LABEL: Record<string, string> = {
  [DataType.IDENTITY]: SOURCE_SYSTEM.IDENTITY_REGISTRY,
  [DataType.INCOME]: SOURCE_SYSTEM.INCOME_DEPARTMENT,
  [DataType.EDUCATION]: SOURCE_SYSTEM.EDUCATION_DEPARTMENT,
  [DataType.LEGACY_BENEFICIARY]: SOURCE_SYSTEM.LEGACY_BENEFICIARY_SYSTEM,
};

/**
 * Rebuilds the consolidated citizen view from the normalised records already
 * stored for an application. Nothing here knows any department's schema - by
 * this point every payload is in the common data model.
 */
export async function assembleFacts(applicationId: string): Promise<AssembledFacts> {
  const records = await prisma.normalizedRecord.findMany({
    where: { applicationId },
    orderBy: { receivedAt: 'asc' },
  });

  const latest = new Map<string, (typeof records)[number]>();
  for (const record of records) latest.set(record.dataType, record);

  const identity =
    (latest.get(DataType.IDENTITY)?.normalizedPayload as IdentityFacts | undefined) ?? null;
  const income =
    (latest.get(DataType.INCOME)?.normalizedPayload as IncomeFacts | undefined) ?? null;
  const education =
    (latest.get(DataType.EDUCATION)?.normalizedPayload as EducationFacts | undefined) ?? null;
  const legacy =
    (latest.get(DataType.LEGACY_BENEFICIARY)?.normalizedPayload as
      | LegacyBeneficiaryFacts
      | undefined) ?? null;

  const provenance: Record<string, string> = {};
  const set = <K extends keyof NormalizedCitizenData>(
    target: NormalizedCitizenData,
    key: K,
    value: NormalizedCitizenData[K] | undefined,
    source: string,
  ) => {
    if (value === undefined || value === null) return;
    target[key] = value;
    provenance[key as string] = source;
  };

  const consolidated: NormalizedCitizenData = {
    citizenId: identity?.citizenId ?? income?.citizenId ?? education?.citizenId ?? '',
    provenance,
  };

  set(consolidated, 'name', identity?.name ?? income?.name ?? education?.name, identity ? SOURCE_LABEL[DataType.IDENTITY]! : income ? SOURCE_LABEL[DataType.INCOME]! : SOURCE_LABEL[DataType.EDUCATION]!);
  set(consolidated, 'dateOfBirth', identity?.dateOfBirth, SOURCE_LABEL[DataType.IDENTITY]!);
  set(consolidated, 'district', identity?.district, SOURCE_LABEL[DataType.IDENTITY]!);
  set(consolidated, 'annualIncome', income?.annualIncome, SOURCE_LABEL[DataType.INCOME]!);
  set(consolidated, 'incomeYear', income?.incomeYear, SOURCE_LABEL[DataType.INCOME]!);
  set(consolidated, 'educationStatus', education?.educationStatus, SOURCE_LABEL[DataType.EDUCATION]!);
  set(consolidated, 'institution', education?.institution, SOURCE_LABEL[DataType.EDUCATION]!);
  set(consolidated, 'course', education?.course, SOURCE_LABEL[DataType.EDUCATION]!);
  set(
    consolidated,
    'legacyVerificationStatus',
    legacy?.verificationStatus,
    SOURCE_LABEL[DataType.LEGACY_BENEFICIARY]!,
  );

  const receivedAt: Record<string, string> = {};
  for (const [type, record] of latest) receivedAt[type] = record.receivedAt.toISOString();

  return { identity, income, education, legacy, consolidated, receivedAt };
}

/** Department codes whose lookup did not produce a record for this application. */
export async function unavailableSources(applicationId: string): Promise<string[]> {
  const workflow = await prisma.workflowInstance.findUnique({
    where: { applicationId },
    select: { steps: { select: { department: true, status: true } } },
  });
  if (!workflow) return [];
  return workflow.steps
    .filter(
      (s) =>
        s.department !== null &&
        (s.status === 'FAILED' || s.status === 'REQUIRES_REVIEW' || s.status === 'RETRYING'),
    )
    .map((s) => s.department as string);
}
