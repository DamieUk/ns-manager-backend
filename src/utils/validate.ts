import { HttpError } from './HttpError';

// Input casting and validation with the same rules and messages Mongoose used to produce, so
// API errors stay identical after the move to MySQL.

const ID_PATTERN = /^[0-9a-fA-F]{24}$/;

export function castId(value: unknown, path = '_id'): string {
  if (typeof value === 'string' && ID_PATTERN.test(value)) return value.toLowerCase();
  throw new HttpError(400, `Invalid ${path}: ${value}`);
}

export function castIds(values: unknown, path: string): string[] {
  if (!Array.isArray(values)) return [castId(values, path)];
  return values.map((v) => castId(v, path));
}

function describe(value: unknown): string {
  return `${JSON.stringify(String(value))} (type ${typeof value})`;
}

export function castNumber(value: unknown, path: string): number | null | undefined {
  if (value === undefined || value === null) return value;
  if (value === '') return null;
  const n = typeof value === 'string' || typeof value === 'boolean' ? Number(value) : value;
  if (typeof n !== 'number' || Number.isNaN(n)) {
    throw new HttpError(400, `Cast to Number failed for value ${describe(value)} at path "${path}"`);
  }
  return n;
}

export function castDate(value: unknown, path: string): Date | null | undefined {
  if (value === undefined) return undefined;
  if (value === null || value === '') return null;
  const date = value instanceof Date ? value : new Date(value as string | number);
  if (Number.isNaN(date.getTime())) throw new HttpError(400, `Cast to date failed for value ${describe(value)} at path "${path}"`);
  return date;
}

export function castString(value: unknown): string | undefined {
  if (value === undefined || value === null) return undefined;
  return typeof value === 'string' ? value : String(value);
}

// Collects field errors and throws them together, joined like a Mongoose ValidationError.
export class Validator {
  private errors: string[] = [];

  required(value: unknown, path: string): this {
    if (value === undefined || value === null || value === '') this.errors.push(`Path \`${path}\` is required.`);
    return this;
  }

  oneOf(value: unknown, allowed: readonly string[], path: string): this {
    if (value !== undefined && value !== null && !allowed.includes(value as string)) {
      this.errors.push(`\`${value}\` is not a valid enum value for path \`${path}\`.`);
    }
    return this;
  }

  min(value: number | null | undefined, min: number, path: string): this {
    if (typeof value === 'number' && value < min) {
      this.errors.push(`Path \`${path}\` (${value}) is less than minimum allowed value (${min}).`);
    }
    return this;
  }

  check(): void {
    if (this.errors.length) throw new HttpError(400, this.errors.join(', '));
  }
}

export function byId<T extends { id: string }>(rows: T[]): Map<string, T> {
  return new Map(rows.map((r) => [r.id, r]));
}
