import {
  CONNECTOR_ERROR_KIND,
  getDepartmentDefinition,
  type IdentifierLinkSource,
} from '@govflow/contracts';
import { ConnectorError } from '@govflow/connector-sdk';
import { prisma } from '../db.js';

/**
 * Identifier crosswalk - the lookup that stands between a GovFlow citizen and
 * a departmental record.
 *
 * Departments maintain independent keyspaces. CIT-1001, INC-1001 and STU-1001
 * are three unrelated sequences, and the only reason they line up in the demo
 * dataset is that the seed made them line up. Guessing one from another would
 * mean that, against a real registry, GovFlow would confidently fetch and show
 * an officer *somebody else's* income record.
 *
 * So the mapping is stored rather than derived, and it is attributed: every
 * row records how the link was established. A link with no provenance is worth
 * very little, which is exactly why `source` is not optional.
 */
export interface DepartmentIdentifier {
  identifier: string;
  source: IdentifierLinkSource;
  verifiedAt: Date | null;
}

/**
 * Resolves the identifier a department uses for this citizen.
 *
 * Throws a non-retryable ConnectorError when no link exists: retrying cannot
 * help, because the missing thing is a fact about the citizen, not a transient
 * condition of the department.
 */
export async function resolveDepartmentIdentifier(
  citizenId: string,
  departmentCode: string,
): Promise<DepartmentIdentifier> {
  const def = getDepartmentDefinition(departmentCode);
  const link = await prisma.identifierLink.findUnique({
    where: { citizenId_departmentCode: { citizenId, departmentCode: def.code } },
    select: { externalIdentifier: true, source: true, verifiedAt: true },
  });

  if (!link) {
    throw new ConnectorError({
      connector: def.code,
      kind: CONNECTOR_ERROR_KIND.IDENTIFIER_NOT_LINKED,
      message:
        `No ${def.name} identifier is on record for this applicant, so the ` +
        'department cannot be queried. The identifier must be established ' +
        'from an identity assertion or asserted by an officer.',
    });
  }

  return {
    identifier: link.externalIdentifier,
    source: link.source as IdentifierLinkSource,
    verifiedAt: link.verifiedAt,
  };
}

/** Every department identifier known for a citizen, keyed by department code. */
export async function listIdentifierLinks(
  citizenId: string,
): Promise<Record<string, DepartmentIdentifier>> {
  const links = await prisma.identifierLink.findMany({ where: { citizenId } });
  return Object.fromEntries(
    links.map((l) => [
      l.departmentCode,
      {
        identifier: l.externalIdentifier,
        source: l.source as IdentifierLinkSource,
        verifiedAt: l.verifiedAt,
      },
    ]),
  );
}

/**
 * Records or updates the identifier a department uses for a citizen.
 *
 * The caller must say where the link came from; there is no default, because
 * an unattributed link is indistinguishable from a guess.
 */
export async function linkDepartmentIdentifier(input: {
  citizenId: string;
  departmentCode: string;
  externalIdentifier: string;
  source: IdentifierLinkSource;
  verifiedAt?: Date | null;
}): Promise<void> {
  const def = getDepartmentDefinition(input.departmentCode);
  const data = {
    externalIdentifier: input.externalIdentifier,
    source: input.source as never,
    verifiedAt: input.verifiedAt ?? null,
  };
  await prisma.identifierLink.upsert({
    where: { citizenId_departmentCode: { citizenId: input.citizenId, departmentCode: def.code } },
    create: { citizenId: input.citizenId, departmentCode: def.code, ...data },
    update: data,
  });
}
