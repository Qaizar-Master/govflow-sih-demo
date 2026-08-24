/**
 * Declarative field-mapping DSL.
 *
 * Normalisation rules live in configuration rather than being hard-coded
 * across the codebase: onboarding a new department is a data change.
 */

export type TransformName =
  | 'trim'
  | 'string'
  | 'number'
  | 'integer'
  | 'boolean'
  | 'upper'
  | 'lower'
  | 'titleCase'
  | 'isoDate'
  | 'stripCurrency';

export interface FieldMappingRule {
  /** Dot path into the source payload, e.g. "profile.dob" or "applicant_id". */
  from: string;
  /** Field name in the GovFlow common data model. */
  to: string;
  transforms?: TransformName[];
  required?: boolean;
  defaultValue?: unknown;
  /** Fallback source paths tried in order when `from` is absent. */
  fallbackFrom?: string[];
  /** Static value assigned regardless of source payload. */
  constant?: unknown;
}

export interface FieldMappingSpec {
  name: string;
  rules: FieldMappingRule[];
}

export const identityMapping: FieldMappingSpec = {
  name: 'identity-registry-v1',
  rules: [
    { from: 'citizenId', to: 'citizenId', transforms: ['trim', 'upper'], required: true },
    { from: 'fullName', to: 'name', transforms: ['trim'], required: true },
    { from: 'dob', to: 'dateOfBirth', transforms: ['isoDate'], required: true },
    { from: 'district', to: 'district', transforms: ['trim', 'titleCase'], required: true },
    { from: 'gender', to: 'gender', transforms: ['trim', 'upper'] },
    { from: 'status', to: 'identityVerified', transforms: ['boolean'], defaultValue: true },
  ],
};

export const incomeMapping: FieldMappingSpec = {
  name: 'income-department-v2',
  rules: [
    { from: 'applicant_id', to: 'citizenId', transforms: ['trim', 'upper'], required: true },
    { from: 'name', to: 'name', transforms: ['trim'], required: true },
    {
      from: 'annualIncome',
      to: 'annualIncome',
      transforms: ['stripCurrency', 'number'],
      required: true,
    },
    { from: 'incomeYear', to: 'incomeYear', transforms: ['integer'], required: true },
    { from: 'currency', to: 'currency', transforms: ['upper'], defaultValue: 'INR' },
    { from: 'certificate_no', to: 'certificateNumber', transforms: ['trim', 'upper'] },
  ],
};

export const educationMapping: FieldMappingSpec = {
  name: 'education-department-v1',
  rules: [
    { from: 'student_no', to: 'citizenId', transforms: ['trim', 'upper'], required: true },
    { from: 'studentName', to: 'name', transforms: ['trim'], required: true },
    {
      from: 'institution_name',
      to: 'institution',
      transforms: ['trim'],
      required: true,
    },
    {
      from: 'enrollment_status',
      to: 'educationStatus',
      transforms: ['trim', 'upper'],
      required: true,
    },
    { from: 'course', to: 'course', transforms: ['trim'] },
    { from: 'academic_year', to: 'academicYear', transforms: ['trim'] },
    { from: 'marks_percent', to: 'percentage', transforms: ['number'] },
  ],
};

export const legacyMapping: FieldMappingSpec = {
  name: 'legacy-beneficiary-csv-v1',
  rules: [
    {
      from: 'beneficiary_no',
      to: 'beneficiaryNumber',
      transforms: ['trim', 'upper'],
      required: true,
    },
    { from: 'applicant_name', to: 'name', transforms: ['trim'], required: true },
    { from: 'yearly_income', to: 'annualIncome', transforms: ['stripCurrency', 'number'] },
    {
      from: 'verification_status',
      to: 'verificationStatus',
      transforms: ['trim', 'upper'],
      required: true,
    },
    { from: 'last_updated', to: 'lastUpdated', transforms: ['trim'] },
    // The legacy system keys on its own beneficiary number; the crosswalk to the
    // canonical citizen id is carried in a dedicated column.
    { from: 'citizen_ref', to: 'citizenId', transforms: ['trim', 'upper'], required: true },
  ],
};
