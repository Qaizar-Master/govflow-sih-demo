import { z } from 'zod';
import { DataType } from './enums.js';

/**
 * GOVFLOW COMMON DATA MODEL (CDM)
 * ------------------------------------------------------------------
 * Every department speaks its own dialect. The connector layer is the
 * ONLY place allowed to know those dialects; everything downstream -
 * workflow engine, validators, dashboards - works exclusively against
 * the shapes declared in this file.
 *
 * Adding a new department therefore means adding a connector + a field
 * mapping, never touching core domain logic.
 */

/** An ISO-8601 calendar date, e.g. "2003-05-12". */
export const isoDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'expected an ISO date (YYYY-MM-DD)');

export const identityFactsSchema = z.object({
  citizenId: z.string().min(1),
  name: z.string().min(1),
  dateOfBirth: isoDateSchema,
  district: z.string().min(1),
  gender: z.string().optional(),
  identityVerified: z.boolean().default(true),
});
export type IdentityFacts = z.infer<typeof identityFactsSchema>;

export const incomeFactsSchema = z.object({
  citizenId: z.string().min(1),
  name: z.string().min(1),
  annualIncome: z.number().nonnegative(),
  incomeYear: z.number().int().min(1990).max(2100),
  currency: z.string().default('INR'),
  certificateNumber: z.string().optional(),
});
export type IncomeFacts = z.infer<typeof incomeFactsSchema>;

export const educationFactsSchema = z.object({
  citizenId: z.string().min(1),
  name: z.string().min(1),
  institution: z.string().min(1),
  educationStatus: z.string().min(1),
  course: z.string().optional(),
  academicYear: z.string().optional(),
  percentage: z.number().min(0).max(100).optional(),
});
export type EducationFacts = z.infer<typeof educationFactsSchema>;

export const legacyBeneficiaryFactsSchema = z.object({
  citizenId: z.string().min(1),
  name: z.string().min(1),
  annualIncome: z.number().nonnegative().optional(),
  verificationStatus: z.string().min(1),
  beneficiaryNumber: z.string().min(1),
  lastUpdated: z.string().optional(),
});
export type LegacyBeneficiaryFacts = z.infer<typeof legacyBeneficiaryFactsSchema>;

/**
 * The union produced by connectors. `dataType` discriminates which
 * department the facts came from.
 */
export const normalizedRecordSchema = z.discriminatedUnion('dataType', [
  z.object({ dataType: z.literal(DataType.IDENTITY), facts: identityFactsSchema }),
  z.object({ dataType: z.literal(DataType.INCOME), facts: incomeFactsSchema }),
  z.object({ dataType: z.literal(DataType.EDUCATION), facts: educationFactsSchema }),
  z.object({
    dataType: z.literal(DataType.LEGACY_BENEFICIARY),
    facts: legacyBeneficiaryFactsSchema,
  }),
]);
export type NormalizedRecord = z.infer<typeof normalizedRecordSchema>;

export type AnyFacts =
  | IdentityFacts
  | IncomeFacts
  | EducationFacts
  | LegacyBeneficiaryFacts;

/**
 * The consolidated citizen profile assembled from every department that
 * responded. This is what the officer UI and the validators consume.
 */
export interface NormalizedCitizenData {
  citizenId: string;
  name?: string;
  dateOfBirth?: string;
  district?: string;
  annualIncome?: number;
  incomeYear?: number;
  educationStatus?: string;
  institution?: string;
  course?: string;
  legacyVerificationStatus?: string;
  /** Which source each populated field came from - used for provenance in the UI. */
  provenance: Record<string, string>;
}

export const SOURCE_SYSTEM = {
  IDENTITY_REGISTRY: 'IDENTITY_REGISTRY',
  INCOME_DEPARTMENT: 'INCOME_DEPARTMENT',
  EDUCATION_DEPARTMENT: 'EDUCATION_DEPARTMENT',
  LEGACY_BENEFICIARY_SYSTEM: 'LEGACY_BENEFICIARY_SYSTEM',
} as const;
export type SourceSystem = (typeof SOURCE_SYSTEM)[keyof typeof SOURCE_SYSTEM];
