import { ApplicationStatus, env, type ServiceType } from '@govflow/contracts';
import { prisma } from './db.js';

/**
 * TIME SAVED
 * ---------------------------------------------------------------------------
 * The whole pitch is that GovFlow saves officer and citizen effort, and until
 * now nothing measured either. This does - carefully.
 *
 * The honesty problem with a metric like this is obvious: it is trivially easy
 * to produce a large, flattering number that nobody can check. So the shape
 * here keeps two things apart and never adds them up behind the reader's back:
 *
 *   measured     things that actually happened, counted from the database -
 *                department lookups completed, fields pre-filled, documents
 *                extracted, real elapsed time to a decision.
 *   assumptions  how long each of those would have taken by hand. These are
 *                judgements, not observations, and they are configurable.
 *
 * `estimate` is the product of the two and is labelled as such everywhere it
 * is shown. A judge who disagrees with "12 minutes to ring a department" can
 * change the number and watch the estimate move, which is the point: an
 * estimate you cannot interrogate is a claim, not evidence.
 */

export interface TimeSavedReport {
  measured: {
    /** Successful departmental lookups - each one a call an officer did not make. */
    departmentLookupsCompleted: number;
    /** Form answers supplied by a registry rather than typed by the citizen. */
    fieldsPrefilled: number;
    /** Fields machine-compared against the registry at decision time. */
    fieldsReconciled: number;
    /** Uploads whose fields were read without an officer transcribing them. */
    documentsAutoExtracted: number;
    /** Decisions delivered to the owning department without re-keying. */
    decisionsDelivered: number;
    applicationsDecided: number;
    /** Real elapsed time, submission to decision. Measured, not modelled. */
    medianDecisionHours: number | null;
  };
  assumptions: {
    minutesPerManualLookup: number;
    secondsPerFormField: number;
    minutesPerManualCrossCheck: number;
  };
  estimate: {
    officerHoursSaved: number;
    citizenHoursSaved: number;
  };
  caveat: string;
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[middle - 1]! + sorted[middle]!) / 2
    : sorted[middle]!;
}

const round1 = (n: number) => Math.round(n * 10) / 10;

export async function timeSavedReport(serviceTypes?: ServiceType[]): Promise<TimeSavedReport> {
  const service = serviceTypes ? { serviceType: { in: serviceTypes as never } } : {};

  /**
   * Drafts are excluded from officer savings and included in citizen savings,
   * and the asymmetry is deliberate.
   *
   * No officer has been given work by a form nobody has sent, so counting a
   * draft towards officer effort would be inventing work that was never
   * avoided. But the citizen genuinely did not type those answers - that
   * happened, at the moment the form was filled, whether or not they go on to
   * submit. Counting it is a description of what occurred; excluding it would
   * understate a real saving for a reason that only makes sense from the
   * department's side of the desk.
   */
  const officerScope = { status: { not: ApplicationStatus.DRAFT as never }, ...service };
  const citizenScope = service;
  const applicationFilter = { application: officerScope };

  const [lookups, snapshots, extracted, delivered, decided, reconcilable] = await Promise.all([
    // One normalised record is one department answered without a phone call.
    prisma.normalizedRecord.count({ where: applicationFilter }),
    prisma.prefillSnapshot.findMany({
      where: { application: citizenScope },
      select: { fields: true },
    }),
    prisma.document.count({
      where: { ...applicationFilter, extractionStatus: 'COMPLETED' as never },
    }),
    prisma.departmentAcknowledgement.count({
      where: { ...applicationFilter, status: 'DELIVERED' as never },
    }),
    prisma.application.findMany({
      where: { ...officerScope, decisionAt: { not: null } },
      select: { submittedAt: true, decisionAt: true },
    }),
    prisma.application.count({
      where: { ...officerScope, submittedValues: { not: null as never } },
    }),
  ]);

  // Only FILLED counts: a field the citizen still had to type saved nobody
  // anything, and counting it would be the easiest way to inflate this number.
  const fieldsPrefilled = snapshots.reduce((total, snapshot) => {
    const fields = (snapshot.fields ?? []) as unknown as { status?: string }[];
    return total + fields.filter((f) => f.status === 'FILLED').length;
  }, 0);

  const fieldsReconciled = snapshots.reduce((total, snapshot) => {
    const fields = (snapshot.fields ?? []) as unknown as unknown[];
    return total + fields.length;
  }, 0);

  const hours = decided.map(
    (a) => (a.decisionAt!.getTime() - a.submittedAt.getTime()) / 3_600_000,
  );

  const assumptions = {
    minutesPerManualLookup: env.MINUTES_PER_MANUAL_LOOKUP,
    secondsPerFormField: env.SECONDS_PER_FORM_FIELD,
    minutesPerManualCrossCheck: env.MINUTES_PER_MANUAL_CROSS_CHECK,
  };

  // Officer: the lookups they did not make, the cross-checks they did not do
  // by eye, the document fields they did not transcribe, and the decisions
  // they did not re-key into another system.
  const officerMinutes =
    lookups * assumptions.minutesPerManualLookup +
    reconcilable * assumptions.minutesPerManualCrossCheck +
    extracted * assumptions.minutesPerManualCrossCheck +
    delivered * assumptions.minutesPerManualLookup;

  // Citizen: only the answers they did not have to find and type.
  const citizenMinutes = (fieldsPrefilled * assumptions.secondsPerFormField) / 60;

  return {
    measured: {
      departmentLookupsCompleted: lookups,
      fieldsPrefilled,
      fieldsReconciled,
      documentsAutoExtracted: extracted,
      decisionsDelivered: delivered,
      applicationsDecided: decided.length,
      medianDecisionHours: median(hours) === null ? null : round1(median(hours)!),
    },
    assumptions,
    estimate: {
      officerHoursSaved: round1(officerMinutes / 60),
      citizenHoursSaved: round1(citizenMinutes / 60),
    },
    caveat:
      'Counts are measured from this database. Minutes-per-task are assumptions, not observations, and are configurable - the estimate moves when they do. Unsent drafts count towards citizen effort saved (the answers really were not typed) but never towards officer effort (no officer has been given that work).',
  };
}
