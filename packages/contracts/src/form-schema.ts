import { ServiceType } from './enums.js';
import type { NormalizedCitizenData } from './common-data-model.js';

/**
 * DECLARATIVE APPLICATION FORMS
 * ---------------------------------------------------------------------------
 * A form is data, not a React component. Each field says where its value comes
 * from, and that binding is the whole pre-fill mechanism: GovFlow fetches the
 * common data model once, then walks the schema to populate the form.
 *
 * Why this matters more than it looks: pre-fill is the product's actual claim.
 * "You already told the government this" is only credible if the value on the
 * screen can be traced to the department that asserted it, which is what
 * `source` records and what the officer later sees reconciled.
 *
 * Fields with `source: null` are citizen-declared - GovFlow holds no authority
 * for them and never pretends to.
 */

/** A field the citizen may not overwrite, and why. */
export type FieldAuthority =
  /** The department is the authority. Shown read-only; editing it would be a fiction. */
  | 'REGISTRY'
  /** Pre-filled from a registry, but the citizen may correct it. Divergence is reconciled. */
  | 'REGISTRY_CORRECTABLE'
  /** No registry holds this. The citizen is the only source. */
  | 'CITIZEN';

export interface FormFieldDefinition {
  key: string;
  label: string;
  type: 'text' | 'number' | 'date' | 'select';
  authority: FieldAuthority;
  required: boolean;
  /**
   * Which department asserts this field, and which common-data-model property
   * carries it. Null for citizen-declared fields.
   */
  source: { departmentCode: string; cdmField: keyof NormalizedCitizenData } | null;
  helpText?: string;
  options?: string[];
  unit?: string;
  placeholder?: string;
}

export interface FormSectionDefinition {
  title: string;
  description: string;
  fields: FormFieldDefinition[];
}

export interface FormSchemaDefinition {
  serviceType: ServiceType;
  sections: FormSectionDefinition[];
}

// ---------------------------------------------------------------------------
// Shared field vocabulary
//
// The same fields recur across services, exactly as the same workflow steps do.
// Defining them once means a new service is a selection, not a new form.
// ---------------------------------------------------------------------------

const FULL_NAME: FormFieldDefinition = {
  key: 'fullName',
  label: 'Full name',
  type: 'text',
  authority: 'REGISTRY',
  required: true,
  source: { departmentCode: 'IDENTITY', cdmField: 'name' },
  helpText: 'As recorded in the National Identity Registry.',
};

const DATE_OF_BIRTH: FormFieldDefinition = {
  key: 'dateOfBirth',
  label: 'Date of birth',
  type: 'date',
  authority: 'REGISTRY',
  required: true,
  source: { departmentCode: 'IDENTITY', cdmField: 'dateOfBirth' },
};

const DISTRICT: FormFieldDefinition = {
  key: 'district',
  label: 'District',
  type: 'text',
  authority: 'REGISTRY',
  required: true,
  source: { departmentCode: 'IDENTITY', cdmField: 'district' },
};

/**
 * Correctable on purpose. A citizen whose assessment is out of date has a
 * legitimate reason to change this, and the officer needs to see that they did
 * - which is the entire point of reconciling the submitted value against the
 * registry one at decision time.
 */
const ANNUAL_INCOME: FormFieldDefinition = {
  key: 'annualIncome',
  label: 'Annual family income',
  type: 'number',
  authority: 'REGISTRY_CORRECTABLE',
  required: true,
  source: { departmentCode: 'INCOME', cdmField: 'annualIncome' },
  unit: 'INR',
  helpText: 'Pre-filled from your latest assessment. Correct it only if it is out of date.',
};

const INCOME_YEAR: FormFieldDefinition = {
  key: 'incomeYear',
  label: 'Assessment year',
  type: 'number',
  authority: 'REGISTRY',
  required: true,
  source: { departmentCode: 'INCOME', cdmField: 'incomeYear' },
};

const INSTITUTION: FormFieldDefinition = {
  key: 'institution',
  label: 'Institution',
  type: 'text',
  authority: 'REGISTRY_CORRECTABLE',
  required: true,
  source: { departmentCode: 'EDUCATION', cdmField: 'institution' },
};

const COURSE: FormFieldDefinition = {
  key: 'course',
  label: 'Course',
  type: 'text',
  authority: 'REGISTRY_CORRECTABLE',
  required: false,
  source: { departmentCode: 'EDUCATION', cdmField: 'course' },
};

const ENROLMENT_STATUS: FormFieldDefinition = {
  key: 'educationStatus',
  label: 'Enrolment status',
  type: 'text',
  authority: 'REGISTRY',
  required: true,
  source: { departmentCode: 'EDUCATION', cdmField: 'educationStatus' },
  helpText: 'Reported by your institution. Only the institution can change this.',
};

const REQUESTED_AMOUNT: FormFieldDefinition = {
  key: 'requestedAmount',
  label: 'Amount applied for',
  type: 'number',
  authority: 'CITIZEN',
  required: true,
  source: null,
  unit: 'INR',
  placeholder: '50000',
};

const CERTIFICATE_PURPOSE: FormFieldDefinition = {
  key: 'purpose',
  label: 'Purpose of the certificate',
  type: 'select',
  authority: 'CITIZEN',
  required: true,
  source: null,
  options: [
    'Educational scholarship',
    'Fee concession',
    'Government scheme application',
    'Employment',
    'Other',
  ],
};

const HOUSEHOLD_SIZE: FormFieldDefinition = {
  key: 'householdSize',
  label: 'Number of people in the household',
  type: 'number',
  authority: 'CITIZEN',
  required: true,
  source: null,
  helpText: 'No registry holds this, so you are the only source.',
};

// ---------------------------------------------------------------------------
// Per-service forms
// ---------------------------------------------------------------------------

const IDENTITY_SECTION: FormSectionDefinition = {
  title: 'Your identity',
  description: 'Read from the National Identity Registry. Only that registry can change it.',
  fields: [FULL_NAME, DATE_OF_BIRTH, DISTRICT],
};

export const FORM_SCHEMAS: FormSchemaDefinition[] = [
  {
    serviceType: ServiceType.SCHOLARSHIP,
    sections: [
      IDENTITY_SECTION,
      {
        title: 'Income',
        description: 'From your latest assessment with the State Income & Revenue Department.',
        fields: [ANNUAL_INCOME, INCOME_YEAR],
      },
      {
        title: 'Education',
        description: 'Reported by your institution to the Department of Higher Education.',
        fields: [INSTITUTION, COURSE, ENROLMENT_STATUS],
      },
      {
        title: 'Your request',
        description: 'The only part of this form no department can fill for you.',
        fields: [REQUESTED_AMOUNT],
      },
    ],
  },
  {
    serviceType: ServiceType.INCOME_CERTIFICATE,
    sections: [
      IDENTITY_SECTION,
      {
        title: 'Income to be certified',
        description: 'The figure the department will attest to.',
        fields: [ANNUAL_INCOME, INCOME_YEAR],
      },
      {
        title: 'Your request',
        description: 'Why you need the certificate.',
        fields: [CERTIFICATE_PURPOSE],
      },
    ],
  },
  {
    serviceType: ServiceType.RATION_CARD,
    sections: [
      IDENTITY_SECTION,
      {
        title: 'Household income',
        description: 'From your latest assessment with the State Income & Revenue Department.',
        fields: [ANNUAL_INCOME, INCOME_YEAR],
      },
      {
        title: 'Your household',
        description: 'The only part of this form no department can fill for you.',
        fields: [HOUSEHOLD_SIZE],
      },
    ],
  },
];

export function getFormSchema(serviceType: string): FormSchemaDefinition {
  const found = FORM_SCHEMAS.find((s) => s.serviceType === serviceType);
  if (!found) throw new Error(`No form schema for service type: ${serviceType}`);
  return found;
}

/** Every field of a service's form, flattened out of its sections. */
export function formFields(serviceType: string): FormFieldDefinition[] {
  return getFormSchema(serviceType).sections.flatMap((section) => section.fields);
}

/** The fields a department can fill, so pre-fill knows what to ask each one for. */
export function prefillableFields(serviceType: string): FormFieldDefinition[] {
  return formFields(serviceType).filter((field) => field.source !== null);
}
