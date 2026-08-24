/** Name comparison tuned for Indian government records. */

const HONORIFICS = new Set(['mr', 'mrs', 'ms', 'miss', 'dr', 'shri', 'smt', 'kum', 'md']);

export function normaliseName(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z\s.]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function nameTokens(value: string): string[] {
  return normaliseName(value)
    .split(' ')
    .map((t) => t.replace(/\.$/, ''))
    .filter((t) => t.length > 0 && !HONORIFICS.has(t));
}

export interface NameComparison {
  identical: boolean;
  /** 0-1 similarity. */
  score: number;
  /** True when the difference is only an initial, e.g. "Rohan P." vs "Rohan Prajapati". */
  abbreviationOnly: boolean;
  explanation: string;
}

function tokenMatch(a: string, b: string): 'exact' | 'initial' | 'none' {
  if (a === b) return 'exact';
  if ((a.length === 1 && b.startsWith(a)) || (b.length === 1 && a.startsWith(b))) {
    return 'initial';
  }
  return 'none';
}

/**
 * Compares two names, distinguishing a genuine mismatch from the very common
 * "one registry abbreviates the surname" case.
 */
export function compareNames(left: string, right: string): NameComparison {
  const a = nameTokens(left);
  const b = nameTokens(right);

  if (a.length === 0 || b.length === 0) {
    return { identical: false, score: 0, abbreviationOnly: false, explanation: 'a name was empty' };
  }
  if (normaliseName(left) === normaliseName(right)) {
    return { identical: true, score: 1, abbreviationOnly: false, explanation: 'names are identical' };
  }

  const remaining = [...b];
  let exact = 0;
  let initial = 0;

  for (const token of a) {
    const exactIdx = remaining.findIndex((r) => tokenMatch(token, r) === 'exact');
    if (exactIdx >= 0) {
      exact += 1;
      remaining.splice(exactIdx, 1);
      continue;
    }
    const initialIdx = remaining.findIndex((r) => tokenMatch(token, r) === 'initial');
    if (initialIdx >= 0) {
      initial += 1;
      remaining.splice(initialIdx, 1);
    }
  }

  const compared = Math.max(a.length, b.length);
  const score = (exact + initial * 0.6) / compared;
  const unmatched = compared - exact - initial;
  const abbreviationOnly = unmatched === 0 && initial > 0;

  return {
    identical: false,
    score: Number(score.toFixed(3)),
    abbreviationOnly,
    explanation: abbreviationOnly
      ? 'names differ only by an abbreviated component'
      : `${unmatched} name component(s) do not correspond`,
  };
}
