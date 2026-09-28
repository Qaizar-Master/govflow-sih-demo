import type { FieldMappingSpec } from './mapping.js';

/**
 * WRITE-BACK
 * ---------------------------------------------------------------------------
 * Until now every connector was read-only, which made GovFlow a very
 * well-instrumented viewer: an officer could approve, and the decision never
 * left the building. This is the direction that makes it infrastructure.
 *
 * The invariant still holds, and write-back is what proves it rather than what
 * breaks it. GovFlow does not become the record of the decision - it hands the
 * decision to the department that owns the outcome, and then displays *their*
 * reference number. If GovFlow were deleted afterwards, the sanction would
 * still exist, in the system that is authorised to hold it.
 */

/** What GovFlow hands back to the department that owns the outcome. */
export interface DecisionSubmission {
  /** GovFlow's own application number. Useful for correlation, authoritative for nothing. */
  govflowReference: string;
  /** The department's own identifier for the citizen, from the crosswalk. */
  citizenIdentifier: string;
  serviceType: string;
  decision: 'APPROVED' | 'REJECTED';
  decidedAt: string;
  /**
   * Opaque officer reference rather than a name. The department needs to know
   * a competent officer decided and be able to trace it back through GovFlow's
   * audit log; it does not need an individual's identity in its own records.
   */
  officerReference: string;
  reason: string;
  /** Sanctioned amount, for services that disburse. */
  amount?: number | null;
}

/**
 * The department's answer. `departmentReference` is the point of the whole
 * exercise: it is the authoritative handle, issued by the authoritative system.
 */
export interface DecisionAcknowledgement {
  departmentReference: string;
  acceptedAt: string;
  /** DUPLICATE means the department already had this decision - not an error. */
  status: 'ACCEPTED' | 'DUPLICATE';
  raw: unknown;
}

/**
 * Outbound mappings, in the same declarative DSL as the inbound ones and read
 * by the same engine - only the direction differs. `from` is a field of
 * DecisionSubmission; `to` is whatever the department calls it.
 */
export const educationDecisionMapping: FieldMappingSpec = {
  name: 'education-decision-v1',
  rules: [
    { from: 'citizenIdentifier', to: 'student_no', required: true },
    { from: 'decision', to: 'decision_status', required: true },
    { from: 'amount', to: 'sanctioned_amount', transforms: ['number'] },
    { from: 'reason', to: 'remarks', transforms: ['trim'] },
    { from: 'govflowReference', to: 'partner_ref', required: true },
    { from: 'officerReference', to: 'decided_by_ref', required: true },
    { from: 'decidedAt', to: 'decision_date', required: true },
    { constant: 'GOVFLOW', to: 'channel', from: '' },
  ],
};

export const incomeDecisionMapping: FieldMappingSpec = {
  name: 'income-decision-v1',
  rules: [
    { from: 'citizenIdentifier', to: 'applicantId', required: true },
    { from: 'decision', to: 'outcome', required: true },
    { from: 'serviceType', to: 'certificateType', required: true },
    { from: 'reason', to: 'note', transforms: ['trim'] },
    { from: 'govflowReference', to: 'externalRef', required: true },
    { from: 'officerReference', to: 'officerRef', required: true },
    { from: 'decidedAt', to: 'decidedOn', required: true },
  ],
};

/** How a department receives decisions, when it can receive them at all. */
export interface DecisionChannel {
  /** Path appended to the department's base URL. */
  path: string;
  mapping: FieldMappingSpec;
  /** Dot path to the department's own reference in its response. */
  referencePath: string;
}
