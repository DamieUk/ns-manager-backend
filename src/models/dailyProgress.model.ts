import { and, desc, eq, gte, inArray, lte, SQL } from 'drizzle-orm';
import { db } from '../db';
import { dailyProgress } from '../db/schema';
import { newId } from '../db/ids';
import { encryptField, decryptField } from '../utils/fieldEncryption';
import { castId, castNumber, castString, Validator } from '../utils/validate';

export interface ProgressEntry {
  id: string;
  employeeId: string;
  orderId: string;
  date: Date;
  completed: number;
  needsRework: number;
  partiallyAssembled: number;
  notes?: string;
  photoId?: string;
  createdAt: Date;
  updatedAt: Date;
}

export type NewProgressEntry = Pick<ProgressEntry, 'employeeId' | 'orderId' | 'date'> &
  Partial<Pick<ProgressEntry, 'completed' | 'needsRework' | 'notes' | 'photoId'>>;

type Row = typeof dailyProgress.$inferSelect;

function fromRow(row: Row): ProgressEntry {
  return {
    id: row.id,
    employeeId: row.employeeId,
    orderId: row.orderId,
    date: row.date,
    completed: row.completed,
    needsRework: row.needsRework,
    partiallyAssembled: row.partiallyAssembled,
    notes: decryptField(row.notes),
    photoId: row.photoId ?? undefined,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function toColumns(e: Omit<ProgressEntry, 'id' | 'createdAt' | 'updatedAt'>) {
  e.completed = castNumber(e.completed, 'completed') ?? 0;
  e.needsRework = castNumber(e.needsRework, 'needsRework') ?? 0;
  e.partiallyAssembled = castNumber(e.partiallyAssembled, 'partiallyAssembled') ?? 0;
  e.notes = castString(e.notes);
  new Validator()
    .required(e.employeeId, 'employee')
    .required(e.orderId, 'order')
    .required(e.date, 'date')
    .min(e.completed, 0, 'completed')
    .min(e.needsRework, 0, 'needsRework')
    .min(e.partiallyAssembled, 0, 'partiallyAssembled')
    .check();
  return {
    employeeId: e.employeeId,
    orderId: e.orderId,
    date: e.date,
    completed: e.completed,
    needsRework: e.needsRework,
    partiallyAssembled: e.partiallyAssembled,
    notes: encryptField(e.notes) ?? null,
    photoId: e.photoId ?? null,
  };
}

export async function listEntries(filter: { employeeId?: unknown; orderId?: unknown; orderIds?: string[]; from?: Date; to?: Date }): Promise<ProgressEntry[]> {
  const conditions: SQL[] = [];
  if (filter.employeeId !== undefined) conditions.push(eq(dailyProgress.employeeId, castId(filter.employeeId, 'employee')));
  if (filter.orderId !== undefined) conditions.push(eq(dailyProgress.orderId, castId(filter.orderId, 'order')));
  if (filter.orderIds) {
    if (filter.orderIds.length === 0) return [];
    conditions.push(inArray(dailyProgress.orderId, filter.orderIds));
  }
  if (filter.from) conditions.push(gte(dailyProgress.date, filter.from));
  if (filter.to) conditions.push(lte(dailyProgress.date, filter.to));
  const rows = await db().select().from(dailyProgress).where(and(...conditions)).orderBy(desc(dailyProgress.date), desc(dailyProgress.id));
  return rows.map(fromRow);
}

export async function findEntryById(id: unknown): Promise<ProgressEntry | null> {
  const [row] = await db().select().from(dailyProgress).where(eq(dailyProgress.id, castId(id)));
  return row ? fromRow(row) : null;
}

export async function createEntry(input: NewProgressEntry): Promise<ProgressEntry> {
  const now = new Date();
  const entry: ProgressEntry = { id: newId(), completed: 0, needsRework: 0, partiallyAssembled: 0, ...input, createdAt: now, updatedAt: now };
  await db().insert(dailyProgress).values({ id: entry.id, ...toColumns(entry), createdAt: now, updatedAt: now });
  return entry;
}

export async function saveEntry(entry: ProgressEntry): Promise<void> {
  entry.updatedAt = new Date();
  await db().update(dailyProgress).set({ ...toColumns(entry), updatedAt: entry.updatedAt }).where(eq(dailyProgress.id, entry.id));
}

export async function deleteEntry(id: string): Promise<void> {
  await db().delete(dailyProgress).where(eq(dailyProgress.id, id));
}

export async function deleteEmployeeEntries(employeeId: string): Promise<void> {
  await db().delete(dailyProgress).where(eq(dailyProgress.employeeId, employeeId));
}
