/**
 * SYNTHETIC department datasets.
 *
 * Nothing here corresponds to a real person or a real government registry.
 * The inconsistencies between the three registries are DELIBERATE - they are
 * what the GovFlow normalisation and mismatch-detection layers exist to catch.
 */

export interface IdentityRow {
  citizenId: string;
  fullName: string;
  dob: string;
  district: string;
  gender: string;
  status: string;
}

export interface IncomeRow {
  applicant_id: string;
  name: string;
  annualIncome: number | string;
  incomeYear: number;
  currency?: string;
  certificate_no?: string;
}

export interface EducationRow {
  student_no: string;
  studentName: string;
  institution_name: string;
  enrollment_status: string;
  course?: string;
  academic_year?: string;
  marks_percent?: number;
}

// --- Identity Registry: camelCase, "CIT-" keyspace ------------------------
export const IDENTITY: IdentityRow[] = [
  { citizenId: 'CIT-1001', fullName: 'Rohan Prajapati', dob: '2003-05-12', district: 'Pune', gender: 'M', status: 'VERIFIED' },
  { citizenId: 'CIT-1002', fullName: 'Aditya Sharma', dob: '2004-01-22', district: 'Nagpur', gender: 'M', status: 'VERIFIED' },
  { citizenId: 'CIT-1003', fullName: 'Priya Patil', dob: '2002-11-03', district: 'Nashik', gender: 'F', status: 'VERIFIED' },
  { citizenId: 'CIT-1004', fullName: 'Sneha Kulkarni', dob: '2005-07-19', district: 'Pune', gender: 'F', status: 'VERIFIED' },
  { citizenId: 'CIT-1005', fullName: 'Arjun Deshmukh', dob: '2003-02-28', district: 'Aurangabad', gender: 'M', status: 'VERIFIED' },
  { citizenId: 'CIT-1006', fullName: 'Meera Iyer', dob: '2004-09-09', district: 'Mumbai Suburban', gender: 'F', status: 'VERIFIED' },
  { citizenId: 'CIT-1007', fullName: 'Kabir Joshi', dob: '2002-04-15', district: 'Thane', gender: 'M', status: 'VERIFIED' },
  { citizenId: 'CIT-1008', fullName: 'Ananya Rao', dob: '2005-12-01', district: 'Pune', gender: 'F', status: 'VERIFIED' },
  // Legacy data-entry artefact: the registry stores this district in upper case
  // with padding. Normalisation is expected to clean it up.
  { citizenId: 'CIT-1009', fullName: 'Vikram Shinde', dob: '2001-08-30', district: '  KOLHAPUR ', gender: 'M', status: 'VERIFIED' },
  { citizenId: 'CIT-1010', fullName: 'Fatima Shaikh', dob: '2004-06-25', district: 'Solapur', gender: 'F', status: 'VERIFIED' },
];

// --- Income Department: snake_case ids, "INC-" keyspace -------------------
export const INCOME: IncomeRow[] = [
  { applicant_id: 'INC-1001', name: 'Rohan Prajapati', annualIncome: 180000, incomeYear: 2026, currency: 'INR', certificate_no: 'INC/2026/44821' },
  { applicant_id: 'INC-1002', name: 'Aditya Sharma', annualIncome: 145000, incomeYear: 2026, currency: 'INR', certificate_no: 'INC/2026/44822' },
  // Deliberately stale assessment year and no certificate number.
  { applicant_id: 'INC-1003', name: 'Priya Patil', annualIncome: 96000, incomeYear: 2023, currency: 'INR' },
  { applicant_id: 'INC-1004', name: 'Sneha Kulkarni', annualIncome: 210000, incomeYear: 2026, currency: 'INR', certificate_no: 'INC/2026/44824' },
  // Above the scheme ceiling - drives an advisory eligibility hint.
  { applicant_id: 'INC-1005', name: 'Arjun Deshmukh', annualIncome: 480000, incomeYear: 2026, currency: 'INR', certificate_no: 'INC/2026/44825' },
  { applicant_id: 'INC-1006', name: 'Meera Iyer', annualIncome: 132000, incomeYear: 2026, currency: 'INR', certificate_no: 'INC/2026/44826' },
  { applicant_id: 'INC-1007', name: 'Kabir Joshi', annualIncome: 175000, incomeYear: 2026, currency: 'INR', certificate_no: 'INC/2026/44827' },
  { applicant_id: 'INC-1008', name: 'Ananya Rao', annualIncome: 158000, incomeYear: 2026, currency: 'INR', certificate_no: 'INC/2026/44828' },
  // Indian digit grouping delivered as a string - the connector must coerce it.
  { applicant_id: 'INC-1009', name: 'Vikram Shinde', annualIncome: '1,95,000', incomeYear: 2026, currency: 'INR', certificate_no: 'INC/2026/44829' },
  { applicant_id: 'INC-1010', name: 'Fatima Shaikh', annualIncome: 120000, incomeYear: 2026, currency: 'INR', certificate_no: 'INC/2026/44830' },
];

// --- Education Department: third convention, "STU-" keyspace --------------
export const EDUCATION: EducationRow[] = [
  // Abbreviated name: the canonical GovFlow mismatch demo.
  { student_no: 'STU-1001', studentName: 'Rohan P.', institution_name: 'Sinhgad Institute of Technology', enrollment_status: 'ACTIVE', course: 'B.E. Computer Engineering', academic_year: '2025-26', marks_percent: 78.4 },
  { student_no: 'STU-1002', studentName: 'Aditya Sharma', institution_name: 'VNIT Nagpur', enrollment_status: 'ACTIVE', course: 'B.Tech Mechanical', academic_year: '2025-26', marks_percent: 71.2 },
  { student_no: 'STU-1003', studentName: 'Priya Patil', institution_name: 'K. K. Wagh College', enrollment_status: 'ACTIVE', course: 'B.Sc Statistics', academic_year: '2025-26', marks_percent: 82.6 },
  { student_no: 'STU-1004', studentName: 'Sneha Kulkarni', institution_name: 'Fergusson College', enrollment_status: 'ACTIVE', course: 'B.A. Economics', academic_year: '2025-26', marks_percent: 69.8 },
  { student_no: 'STU-1005', studentName: 'Arjun Deshmukh', institution_name: 'Government College of Engineering', enrollment_status: 'ACTIVE', course: 'B.E. Civil', academic_year: '2025-26', marks_percent: 64.1 },
  { student_no: 'STU-1006', studentName: 'Meera Iyer', institution_name: 'Ruia College', enrollment_status: 'ACTIVE', course: 'B.Sc Chemistry', academic_year: '2025-26', marks_percent: 88.3 },
  // Dropped out - the scheme requires an active enrolment.
  { student_no: 'STU-1007', studentName: 'Kabir Joshi', institution_name: 'B. K. Birla College', enrollment_status: 'INACTIVE', course: 'B.Com', academic_year: '2025-26', marks_percent: 58.0 },
  { student_no: 'STU-1008', studentName: 'Ananya Rao', institution_name: 'COEP Technological University', enrollment_status: 'ACTIVE', course: 'B.Tech Electrical', academic_year: '2025-26', marks_percent: 91.5 },
  { student_no: 'STU-1009', studentName: 'V. Shinde', institution_name: 'Shivaji University', enrollment_status: 'ACTIVE', course: 'M.Sc Physics', academic_year: '2025-26', marks_percent: 74.0 },
  // STU-1010 is intentionally ABSENT: Fatima Shaikh has no education record,
  // so the connector must surface a clean NOT_FOUND rather than crashing.
];
