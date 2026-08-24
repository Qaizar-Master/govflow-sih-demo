/** Shared, forgiving date coercion for document text. */
export function toIsoDateSafe(value: string | null | undefined): string | null {
  if (!value) return null;
  const raw = String(value).trim();

  let m = /^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/.exec(raw);
  if (m) return `${m[1]}-${m[2]!.padStart(2, '0')}-${m[3]!.padStart(2, '0')}`;

  m = /^(\d{1,2})[-/](\d{1,2})[-/](\d{4})$/.exec(raw);
  if (m) return `${m[3]}-${m[2]!.padStart(2, '0')}-${m[1]!.padStart(2, '0')}`;

  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString().slice(0, 10);
}
