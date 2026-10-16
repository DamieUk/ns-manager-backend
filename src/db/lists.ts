import { asc, eq, inArray } from 'drizzle-orm';
import type { MySqlColumn, MySqlTable } from 'drizzle-orm/mysql-core';
import type { MySql2Database } from 'drizzle-orm/mysql2';
import { db } from './index';

// A connection or an open transaction.
export type Executor = MySql2Database | Parameters<Parameters<MySql2Database['transaction']>[0]>[0];

// Ordered id lists (a contract's documents, an order's employees, ...) live in link tables with
// a `position` column, so they keep the order they were saved in.
export interface ListTable {
  table: MySqlTable;
  owner: MySqlColumn;
  value: MySqlColumn;
  position: MySqlColumn;
  ownerKey: string;
  valueKey: string;
}

export async function loadLists(list: ListTable, ownerIds: string[]): Promise<Map<string, string[]>> {
  const result = new Map<string, string[]>(ownerIds.map((id) => [id, []]));
  if (ownerIds.length === 0) return result;
  const rows = await db()
    .select({ owner: list.owner, value: list.value })
    .from(list.table)
    .where(inArray(list.owner, ownerIds))
    .orderBy(asc(list.owner), asc(list.position));
  for (const row of rows) result.get(row.owner as string)?.push(row.value as string);
  return result;
}

export async function saveList(exec: Executor, list: ListTable, ownerId: string, values: string[]): Promise<void> {
  await exec.delete(list.table).where(eq(list.owner, ownerId));
  if (values.length === 0) return;
  await exec.insert(list.table).values(
    values.map((value, position) => ({ [list.ownerKey]: ownerId, position, [list.valueKey]: value })) as never
  );
}

export async function deleteLists(exec: Executor, list: ListTable, ownerIds: string[]): Promise<void> {
  if (ownerIds.length) await exec.delete(list.table).where(inArray(list.owner, ownerIds));
}
