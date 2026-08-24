/**
 * Document type classification.
 *
 * Answers one narrow question: does the uploaded file look like the type the
 * citizen declared it to be? It exists to catch the ordinary mistake - the
 * wrong file attached - not fraud.
 *
 * ADVISORY BY DESIGN. This never blocks an upload and never rejects an
 * application. Keyword scoring is brittle across regional languages, per-state
 * formats and scanned images with no text layer, and the harm is asymmetric:
 * wrongly blocking a citizen from a benefit is far worse than costing an
 * officer thirty seconds. It is also trivially defeated by anyone actually
 * trying. So it flags, and a human decides.
 *
 * The platform's governing rule:
 *   block on objectively determinable absence, advise on subjective mismatch.
 */

export interface ClassificationResult {
  /** True when the text plausibly matches the declared type. */
  matches: boolean;
  /** 0-1. Low confidence means "we could not tell", not "it is wrong". */
  confidence: number;
  declaredType: string;
  /** The type the text looks most like, when that differs from the declared one. */
  looksLike: string | null;
  reason: string;
}

interface TypeSignature {
  type: string;
  label: string;
  /** Phrases that strongly indicate this document type. */
  strong: RegExp[];
  /** Supporting field labels typical of the type. */
  supporting: RegExp[];
}

const SIGNATURES: TypeSignature[] = [
  {
    type: 'INCOME_CERTIFICATE',
    label: 'income certificate',
    strong: [/\bincome\s+certificate\b/i, /\bआय\s*प्रमाणपत्र\b/],
    supporting: [
      /\bannual\s+(?:family\s+)?income\b/i,
      /\btahsildar\b/i,
      /\brevenue\s+department\b/i,
      /\bassessment\s+year\b/i,
    ],
  },
  {
    type: 'EDUCATION_CERTIFICATE',
    label: 'education / bonafide certificate',
    strong: [/\bbonafide\b/i, /\beducation\s+certificate\b/i, /\bstudent\s+certificate\b/i],
    supporting: [
      /\binstitution\b/i,
      /\bcollege\b/i,
      /\buniversity\b/i,
      /\bacademic\s+year\b/i,
      /\benrol(?:l)?ment\s+status\b/i,
      /\bregistrar\b/i,
      /\bcourse\b/i,
    ],
  },
  {
    type: 'IDENTITY_PROOF',
    label: 'identity proof',
    strong: [/\bidentity\s+(?:card|proof|certificate)\b/i, /\baadhaar\b/i, /\bpassport\b/i],
    supporting: [/\bdate\s+of\s+birth\b/i, /\bgender\b/i, /\bunique\s+identification\b/i],
  },
];

/** Weighted score: a strong phrase is worth far more than a supporting field. */
function score(text: string, signature: TypeSignature): number {
  const strong = signature.strong.filter((r) => r.test(text)).length;
  const supporting = signature.supporting.filter((r) => r.test(text)).length;
  return strong * 3 + supporting;
}

export function classifyDocument(
  text: string,
  declaredType: string,
): ClassificationResult {
  // OTHER is a deliberate catch-all; there is nothing to contradict.
  if (declaredType === 'OTHER') {
    return {
      matches: true,
      confidence: 0,
      declaredType,
      looksLike: null,
      reason: 'Declared as "other", so no type expectation applies.',
    };
  }

  const trimmed = text.trim();
  if (trimmed.length < 40) {
    // Scanned image with no text layer, or an unreadable file. Absence of
    // evidence is not evidence of a mismatch.
    return {
      matches: true,
      confidence: 0,
      declaredType,
      looksLike: null,
      reason:
        'Too little readable text to classify. This is expected for scanned images without OCR.',
    };
  }

  const scored = SIGNATURES.map((sig) => ({ sig, value: score(trimmed, sig) }))
    .sort((a, b) => b.value - a.value);

  const declared = scored.find((s) => s.sig.type === declaredType);
  const best = scored[0]!;

  if (!declared || best.value === 0) {
    return {
      matches: true,
      confidence: 0,
      declaredType,
      looksLike: null,
      reason: 'No recognisable document markers found; type could not be determined.',
    };
  }

  // The declared type scores at least as well as anything else: accept it.
  if (declared.value >= best.value) {
    return {
      matches: true,
      confidence: Math.min(1, declared.value / 5),
      declaredType,
      looksLike: null,
      reason: `Text matches the expected markers for a ${declared.sig.label}.`,
    };
  }

  // Something else scores clearly higher. Require a real margin before saying
  // so, because a narrow lead is noise.
  const margin = best.value - declared.value;
  if (margin < 3) {
    return {
      matches: true,
      confidence: 0.3,
      declaredType,
      looksLike: null,
      reason: 'Markers are ambiguous between document types; treated as a match.',
    };
  }

  return {
    matches: false,
    confidence: Math.min(0.9, margin / 6),
    declaredType,
    looksLike: best.sig.type,
    reason: `The text reads like a ${best.sig.label}, not the declared ${declared.sig.label}.`,
  };
}
