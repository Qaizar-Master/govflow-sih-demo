import { ConnectorType, DataType, DepartmentType } from './enums.js';
import {
  educationDecisionMapping,
  incomeDecisionMapping,
  type DecisionChannel,
} from './decision.js';
import { SOURCE_SYSTEM } from './common-data-model.js';
import { env } from './env.js';
import {
  educationMapping,
  identityMapping,
  incomeMapping,
  legacyMapping,
  type FieldMappingSpec,
} from './mapping.js';

/**
 * Every department speaks a different dialect AND authenticates differently.
 * That variety is deliberate: it is the interoperability problem GovFlow exists
 * to absorb behind a single connector contract.
 */
export type AuthScheme =
  | { kind: 'NONE' }
  | { kind: 'API_KEY'; header: string; value: string }
  | { kind: 'BEARER'; token: string }
  | { kind: 'BASIC'; username: string; password: string };

export interface RestConnectorConfig {
  connectorType: typeof ConnectorType.REST_JSON;
  baseUrl: string;
  /** `:id` is replaced with the department-local identifier. */
  resourcePath: string;
  healthPath: string;
  controlPath: string;
  auth: AuthScheme;
  timeoutMs: number;
}

export interface CsvConnectorConfig {
  connectorType: typeof ConnectorType.CSV_FILE;
  filePath: string;
  /** Column used to look a citizen up. */
  lookupColumn: string;
  delimiter: string;
}

export interface DepartmentDefinition {
  code: string;
  name: string;
  type: DepartmentType;
  sourceSystem: string;
  dataType: DataType;
  description: string;
  /** How the department's own primary key is derived from the canonical id. */
  identifierPrefix: string;
  mapping: FieldMappingSpec;
  connector: RestConnectorConfig | CsvConnectorConfig;
  /** Retryable failures of this department block the workflow when true. */
  blocking: boolean;
  /**
   * How this department receives decisions, or null when it cannot receive
   * them at all. The legacy CSV export is the honest null: a nightly file drop
   * has no inbox, and write-back there has to become a human queue.
   */
  decisionChannel: DecisionChannel | null;
}

export const DEPARTMENTS: DepartmentDefinition[] = [
  {
    code: 'IDENTITY',
    name: 'National Identity Registry (Simulated)',
    type: DepartmentType.IDENTITY,
    sourceSystem: SOURCE_SYSTEM.IDENTITY_REGISTRY,
    dataType: DataType.IDENTITY,
    description: 'REST/JSON identity registry. Authenticates with an API key header.',
    identifierPrefix: 'CIT-',
    mapping: identityMapping,
    // The identity registry is asked about people; it is never told outcomes.
    decisionChannel: null,
    blocking: true,
    connector: {
      connectorType: ConnectorType.REST_JSON,
      baseUrl: env.IDENTITY_API_URL,
      resourcePath: '/api/identity/:id',
      healthPath: '/health',
      controlPath: '/__control',
      auth: { kind: 'API_KEY', header: 'x-api-key', value: env.IDENTITY_API_KEY },
      timeoutMs: env.CONNECTOR_TIMEOUT_MS,
    },
  },
  {
    code: 'INCOME',
    name: 'State Income & Revenue Department (Simulated)',
    type: DepartmentType.INCOME,
    sourceSystem: SOURCE_SYSTEM.INCOME_DEPARTMENT,
    dataType: DataType.INCOME,
    description:
      'REST/JSON income registry using snake_case identifiers. Authenticates with a bearer token.',
    identifierPrefix: 'INC-',
    mapping: incomeMapping,
    decisionChannel: {
      path: '/api/income/decisions',
      mapping: incomeDecisionMapping,
      referencePath: 'reference',
    },
    blocking: true,
    connector: {
      connectorType: ConnectorType.REST_JSON,
      baseUrl: env.INCOME_API_URL,
      resourcePath: '/api/income/:id',
      healthPath: '/health',
      controlPath: '/__control',
      auth: { kind: 'BEARER', token: env.INCOME_API_TOKEN },
      timeoutMs: env.CONNECTOR_TIMEOUT_MS,
    },
  },
  {
    code: 'EDUCATION',
    name: 'Department of Higher Education (Simulated)',
    type: DepartmentType.EDUCATION,
    sourceSystem: SOURCE_SYSTEM.EDUCATION_DEPARTMENT,
    dataType: DataType.EDUCATION,
    description:
      'REST/JSON student registry with a third schema convention. Authenticates with HTTP Basic.',
    identifierPrefix: 'STU-',
    mapping: educationMapping,
    decisionChannel: {
      path: '/api/education/decisions',
      mapping: educationDecisionMapping,
      referencePath: 'ack_id',
    },
    blocking: true,
    connector: {
      connectorType: ConnectorType.REST_JSON,
      baseUrl: env.EDUCATION_API_URL,
      resourcePath: '/api/student/:id',
      healthPath: '/health',
      controlPath: '/__control',
      auth: {
        kind: 'BASIC',
        username: env.EDUCATION_BASIC_USER,
        password: env.EDUCATION_BASIC_PASS,
      },
      timeoutMs: env.CONNECTOR_TIMEOUT_MS,
    },
  },
  {
    code: 'LEGACY',
    name: 'Legacy Beneficiary System (CSV Export)',
    type: DepartmentType.LEGACY,
    sourceSystem: SOURCE_SYSTEM.LEGACY_BENEFICIARY_SYSTEM,
    dataType: DataType.LEGACY_BENEFICIARY,
    description:
      'No API at all - a nightly CSV export. Ingested by the same connector contract.',
    // The export carries an explicit crosswalk column (citizen_ref) holding the
    // canonical GovFlow id, so lookups use that keyspace. The system's own
    // beneficiary number (BEN####) is mapped through to beneficiaryNumber.
    identifierPrefix: 'CIT-',
    mapping: legacyMapping,
    blocking: false,
    // A nightly CSV export has no inbox. Decisions bound for this system have
    // to be queued for a human, and the workflow says so rather than pretending.
    decisionChannel: null,
    connector: {
      connectorType: ConnectorType.CSV_FILE,
      filePath: env.LEGACY_CSV_PATH,
      lookupColumn: 'citizen_ref',
      delimiter: ',',
    },
  },
];

export function getDepartmentDefinition(code: string): DepartmentDefinition {
  const found = DEPARTMENTS.find((d) => d.code === code.toUpperCase());
  if (!found) throw new Error(`Unknown department code: ${code}`);
  return found;
}

/**
 * SEEDING AND FIXTURES ONLY - never use this at runtime.
 *
 * Departments key citizens differently (CIT-1001 vs INC-1001 vs STU-1001),
 * which is one of the concrete interoperability pains. Real keyspaces do not
 * share a numeric suffix, so deriving one identifier from another by string
 * surgery is a demo convenience, not an interoperability strategy: the moment
 * a department issues its own sequence the derivation silently addresses the
 * wrong citizen.
 *
 * At runtime the mapping is looked up in the `IdentifierLink` table, populated
 * from an identity assertion. This helper exists only to generate that table's
 * rows for the synthetic dataset, where the suffixes really are aligned.
 *
 * @see resolveDepartmentIdentifier in @govflow/core
 */
export function deriveSeedIdentifier(canonicalCitizenId: string, code: string): string {
  const def = getDepartmentDefinition(code);
  const numeric = canonicalCitizenId.replace(/^[A-Z]+-?/i, '');
  return `${def.identifierPrefix}${numeric}`;
}
