import { and, desc, eq, gte, inArray, lte, SQL } from 'drizzle-orm';
import { db } from '../db';
import { leaveRequests } from '../db/schema';
import { newId } from '../db/ids';
import { encryptField, decryptField } from '../utils/fieldEncryption';
import { castString, Validator } from '../utils/validate';

export const LEAVE_KINDS = ['vacation', 'sick', 'unpaid', 'other'] as const;
export type LeaveKind = (typeof LEAVE_KINDS)[number];

export const LEAVE_STATUSES = ['pending', 'approved', 'rejected', 'cancelled'] as const;
export type LeaveStatus = (typeof LEAVE_STATUSES)[number];

export interface LeaveRequest {
  id: string;
  userId: string;
  kind: LeaveKind;
  startDate: Date;
  endDate: Date;
  reason?: string;
  status: LeaveStatus;
  decidedBy?: string;
  decidedAt?: Date;
  decisionNote?: string;
  createdAt: Date;
  updatedAt: Date;
}

const DAY_MS = 86_400_000;

// Calendar days, both ends included (vacations in Ukraine are counted in calendar days).
export const leaveDays = (l: Pick<LeaveRequest, 'startDate' | 'endDate'>) => Math.round((l.endDate.getTime() - l.startDate.getTime()) / DAY_MS) + 1;

function fromRow(row: typeof leaveRequests.$inferSelect): LeaveRequest {
  return {
    id: row.id,
    userId: row.userId,
    kind: row.kind as LeaveKind,
    startDate: row.startDate,
    endDate: row.endDate,
    reason: decryptField(row.reason),
    status: row.status as LeaveStatus,
    decidedBy: row.decidedBy ?? undefined,
    decidedAt: row.decidedAt ?? undefined,
    decisionNote: decryptField(row.decisionNote),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function toColumns(l: Omit<LeaveRequest, 'id' | 'createdAt' | 'updatedAt'>) {
  l.reason = castString(l.reason)?.trim() || undefined;
  l.decisionNote = castString(l.decisionNote)?.trim() || undefined;
  new Validator().oneOf(l.kind, LEAVE_KINDS, 'kind').oneOf(l.status, LEAVE_STATUSES, 'status').check();
  return {
    userId: l.userId,
    kind: l.kind,
    startDate: l.startDate,
    endDate: l.endDate,
    reason: encryptField(l.reason) ?? null,
    status: l.status,
    decidedBy: l.decidedBy ?? null,
    decidedAt: l.decidedAt ?? null,
    decisionNote: encryptField(l.decisionNote) ?? null,
  };
}

// Newest start first. `from`/`to` keep the requests that overlap that period.
export async function listLeaves(filter: { userId?: string; statuses?: LeaveStatus[]; from?: Date; to?: Date } = {}): Promise<LeaveRequest[]> {
  const conditions: SQL[] = [];
  if (filter.userId) conditions.push(eq(leaveRequests.userId, filter.userId));
  if (filter.statuses) conditions.push(inArray(leaveRequests.status, filter.statuses));
  if (filter.from) conditions.push(gte(leaveRequests.endDate, filter.from));
  if (filter.to) conditions.push(lte(leaveRequests.startDate, filter.to));
  const rows = await db().select().from(leaveRequests).where(and(...conditions)).orderBy(desc(leaveRequests.startDate), desc(leaveRequests.createdAt));
  return rows.map(fromRow);
}

export async function findLeaveById(id: string): Promise<LeaveRequest | null> {
  const [row] = await db().select().from(leaveRequests).where(eq(leaveRequests.id, id));
  return row ? fromRow(row) : null;
}

export async function createLeave(input: Pick<LeaveRequest, 'userId' | 'kind' | 'startDate' | 'endDate' | 'reason'>): Promise<LeaveRequest> {
  const now = new Date();
  const leave: LeaveRequest = { id: newId(), ...input, status: 'pending', createdAt: now, updatedAt: now };
  await db().insert(leaveRequests).values({ id: leave.id, ...toColumns(leave), createdAt: now, updatedAt: now });
  return leave;
}

export async function saveLeave(leave: LeaveRequest): Promise<void> {
  leave.updatedAt = new Date();
  await db().update(leaveRequests).set({ ...toColumns(leave), updatedAt: leave.updatedAt }).where(eq(leaveRequests.id, leave.id));
}

export async function deleteUserLeaves(userId: string): Promise<void> {
  await db().delete(leaveRequests).where(eq(leaveRequests.userId, userId));
}

export function leaveJson(l: LeaveRequest, people: { user?: object | null; decidedBy?: object | null } = {}) {
  return {
    id: l.id,
    user: people.user ?? l.userId,
    kind: l.kind,
    startDate: l.startDate,
    endDate: l.endDate,
    days: leaveDays(l),
    reason: l.reason ?? null,
    status: l.status,
    decidedBy: people.decidedBy ?? null,
    decidedAt: l.decidedAt ?? null,
    decisionNote: l.decisionNote ?? null,
    createdAt: l.createdAt,
  };
}
