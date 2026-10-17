import { like } from 'drizzle-orm';
import type { MySqlColumn, MySqlTable } from 'drizzle-orm/mysql-core';
import { db } from './index';
import { isDuplicateKeyError } from '../utils/dbErrors';

// Invoices and delivery notes are numbered by their date and the sequence within the day:
// «070926-1», «070926-2» for the 7th of September 2026 (as on the paper documents).
export function datePrefix(day: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(day.getUTCDate())}${pad(day.getUTCMonth() + 1)}${pad(day.getUTCFullYear() % 100)}`;
}

async function nextDailyNumber(table: MySqlTable, column: MySqlColumn, day: Date): Promise<string> {
  const prefix = datePrefix(day);
  const rows = await db().select({ number: column }).from(table).where(like(column, `${prefix}-%`));
  const max = Math.max(0, ...rows.map((r) => Number(String(r.number).slice(prefix.length + 1)) || 0));
  return `${prefix}-${max + 1}`;
}

// Runs `insert` with the next free number of `day`. Two documents saved at the same moment can
// draw the same number: the unique index rejects the second, which then takes the next one.
export async function withDailyNumber<T>(
  table: MySqlTable,
  column: MySqlColumn,
  day: Date,
  insert: (number: string) => Promise<T>
): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    const number = await nextDailyNumber(table, column, day);
    try {
      return await insert(number);
    } catch (err) {
      if (!isDuplicateKeyError(err) || attempt >= 4) throw err;
    }
  }
}
