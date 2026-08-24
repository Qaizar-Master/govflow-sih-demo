import { describe, expect, it } from 'vitest';
import { classifyDocument } from '@govflow/core';

const INCOME = `GOVERNMENT OF MAHARASHTRA
OFFICE OF THE TAHSILDAR, PUNE
                       INCOME CERTIFICATE
Certificate No: INC/2026/44821
Applicant Name: Rohan Prajapati
Annual Income: INR 180000
Assessment Year: 2026`;

const BONAFIDE = `SINHGAD INSTITUTE OF TECHNOLOGY
OFFICE OF THE REGISTRAR
                  BONAFIDE / EDUCATION CERTIFICATE
Student Name: Rohan P.
Institution: Sinhgad Institute of Technology
Course: B.E. Computer Engineering
Academic Year: 2025-26`;

describe('document type classification (advisory)', () => {
  it('accepts a correctly declared income certificate', () => {
    const r = classifyDocument(INCOME, 'INCOME_CERTIFICATE');
    expect(r.matches).toBe(true);
    expect(r.confidence).toBeGreaterThan(0);
  });

  it('accepts a correctly declared bonafide certificate', () => {
    expect(classifyDocument(BONAFIDE, 'EDUCATION_CERTIFICATE').matches).toBe(true);
  });

  it('catches the ordinary mistake: bonafide uploaded as an income certificate', () => {
    const r = classifyDocument(BONAFIDE, 'INCOME_CERTIFICATE');
    expect(r.matches).toBe(false);
    expect(r.looksLike).toBe('EDUCATION_CERTIFICATE');
    expect(r.reason).toMatch(/reads like/i);
  });

  /**
   * The asymmetry that governs this whole feature: wrongly blocking a citizen
   * is far worse than costing an officer a moment. Every ambiguous case must
   * resolve to "matches".
   */
  it('does not flag a scanned image with no text layer', () => {
    const r = classifyDocument('', 'INCOME_CERTIFICATE');
    expect(r.matches).toBe(true);
    expect(r.confidence).toBe(0);
    expect(r.reason).toMatch(/too little readable text/i);
  });

  it('does not flag unrecognisable text rather than guessing', () => {
    const r = classifyDocument(
      'this document has no recognisable government markers whatsoever in it',
      'INCOME_CERTIFICATE',
    );
    expect(r.matches).toBe(true);
    expect(r.confidence).toBe(0);
  });

  it('never flags anything declared as OTHER', () => {
    expect(classifyDocument(BONAFIDE, 'OTHER').matches).toBe(true);
  });

  it('treats a narrow scoring margin as a match, not a mismatch', () => {
    // Contains markers for both types; must not accuse the citizen.
    const ambiguous = `CERTIFICATE
Applicant Name: A. Sharma
Annual income noted. Institution noted.`;
    expect(classifyDocument(ambiguous, 'INCOME_CERTIFICATE').matches).toBe(true);
  });
});
