import type { FieldMappingRule, FieldMappingSpec, TransformName } from '@govflow/contracts';

/** Reads "a.b.c" / "a.0.b" out of an unknown payload without throwing. */
export function getPath(source: unknown, path: string): unknown {
  return path.split('.').reduce<unknown>((acc, key) => {
    if (acc === null || acc === undefined) return undefined;
    if (Array.isArray(acc)) {
      const idx = Number(key);
      return Number.isInteger(idx) ? acc[idx] : undefined;
    }
    if (typeof acc === 'object') return (acc as Record<string, unknown>)[key];
    return undefined;
  }, source);
}

function titleCase(value: string): string {
  return value
    .toLowerCase()
    .split(/\s+/)
    .map((w) => (w ? w[0]!.toUpperCase() + w.slice(1) : w))
    .join(' ');
}

/** Accepts the several date dialects the simulated departments emit. */
export function toIsoDate(value: unknown): string | undefined {
  if (typeof value !== 'string' && typeof value !== 'number') return undefined;
  const raw = String(value).trim();
  if (!raw) return undefined;

  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(raw);
  if (m) return `${m[1]}-${m[2]!.padStart(2, '0')}-${m[3]!.padStart(2, '0')}`;

  // DD/MM/YYYY or DD-MM-YYYY (common in legacy Indian government exports)
  m = /^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/.exec(raw);
  if (m) return `${m[3]}-${m[2]!.padStart(2, '0')}-${m[1]!.padStart(2, '0')}`;

  const parsed = new Date(raw);
  if (!Number.isNaN(parsed.getTime())) return parsed.toISOString().slice(0, 10);
  return undefined;
}

export function applyTransform(value: unknown, transform: TransformName): unknown {
  if (value === null || value === undefined) return value;
  switch (transform) {
    case 'trim':
      return typeof value === 'string' ? value.trim().replace(/\s+/g, ' ') : value;
    case 'string':
      return String(value);
    case 'stripCurrency':
      return typeof value === 'string'
        ? value.replace(/[^0-9.-]/g, '')
        : value;
    case 'number': {
      const n = typeof value === 'number' ? value : Number(String(value).trim());
      return Number.isFinite(n) ? n : undefined;
    }
    case 'integer': {
      const n = typeof value === 'number' ? value : Number(String(value).trim());
      return Number.isFinite(n) ? Math.trunc(n) : undefined;
    }
    case 'boolean': {
      if (typeof value === 'boolean') return value;
      const s = String(value).trim().toLowerCase();
      if (['true', '1', 'yes', 'y', 'active', 'verified', 'valid'].includes(s)) return true;
      if (['false', '0', 'no', 'n', 'inactive', 'invalid'].includes(s)) return false;
      return undefined;
    }
    case 'upper':
      return typeof value === 'string' ? value.toUpperCase() : value;
    case 'lower':
      return typeof value === 'string' ? value.toLowerCase() : value;
    case 'titleCase':
      return typeof value === 'string' ? titleCase(value) : value;
    case 'isoDate':
      return toIsoDate(value);
    default:
      return value;
  }
}

export interface MappingOutcome {
  mapped: Record<string, unknown>;
  missingRequired: string[];
  appliedRules: number;
}

/**
 * Executes a FieldMappingSpec. This is the only place normalisation happens -
 * connectors declare mappings, they do not write per-field code.
 */
export function applyMapping(
  source: unknown,
  spec: FieldMappingSpec,
): MappingOutcome {
  const mapped: Record<string, unknown> = {};
  const missingRequired: string[] = [];

  const resolve = (rule: FieldMappingRule): unknown => {
    if (rule.constant !== undefined) return rule.constant;
    let value = getPath(source, rule.from);
    if (value === undefined || value === null || value === '') {
      for (const alt of rule.fallbackFrom ?? []) {
        const candidate = getPath(source, alt);
        if (candidate !== undefined && candidate !== null && candidate !== '') {
          value = candidate;
          break;
        }
      }
    }
    for (const t of rule.transforms ?? []) value = applyTransform(value, t);
    if (value === undefined || value === null || value === '') {
      return rule.defaultValue;
    }
    return value;
  };

  for (const rule of spec.rules) {
    const value = resolve(rule);
    if (value === undefined || value === null || value === '') {
      if (rule.required) missingRequired.push(rule.to);
      continue;
    }
    mapped[rule.to] = value;
  }

  return { mapped, missingRequired, appliedRules: spec.rules.length };
}
