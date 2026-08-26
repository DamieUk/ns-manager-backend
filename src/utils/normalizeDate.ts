import { HttpError } from './HttpError';

export function normalizeToUTCMidnight(input: unknown): Date {
  const date = new Date(input as string);
  if (Number.isNaN(date.getTime())) {
    throw new HttpError(400, 'Invalid date');
  }
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}
