import { desc, eq, inArray } from 'drizzle-orm';
import { db } from '../db';
import { contracts, contractDocuments } from '../db/schema';
import { newId } from '../db/ids';
import { deleteLists, ListTable, loadLists, saveList } from '../db/lists';
import { encryptField, decryptField } from '../utils/fieldEncryption';
import { castDate, castId, castString, Validator } from '../utils/validate';

export const CONTRACT_STATUSES = ['draft', 'active', 'completed', 'cancelled'] as const;
export type ContractStatus = (typeof CONTRACT_STATUSES)[number];

export interface Contract {
  id: string;
  title: string;
  clientId: string;
  startDate?: Date;
  endDate?: Date;
  status: ContractStatus;
  notes?: string;
  documents: string[];
  createdAt: Date;
  updatedAt: Date;
}

export interface NewContract {
  title: string;
  clientId: string;
  startDate?: unknown;
  endDate?: unknown;
  status?: ContractStatus;
  notes?: string;
  documents?: string[];
}

const DOCUMENTS: ListTable = {
  table: contractDocuments,
  owner: contractDocuments.contractId,
  value: contractDocuments.documentId,
  position: contractDocuments.position,
  ownerKey: 'contractId',
  valueKey: 'documentId',
};

type Row = typeof contracts.$inferSelect;

function fromRow(row: Row, documentIds: string[]): Contract {
  return {
    id: row.id,
    title: row.title,
    clientId: row.clientId,
    startDate: row.startDate ?? undefined,
    endDate: row.endDate ?? undefined,
    status: row.status as ContractStatus,
    notes: decryptField(row.notes),
    documents: documentIds,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

async function withDocuments(rows: Row[]): Promise<Contract[]> {
  const lists = await loadLists(DOCUMENTS, rows.map((r) => r.id));
  return rows.map((r) => fromRow(r, lists.get(r.id) ?? []));
}

function toColumns(c: Omit<Contract, 'id' | 'createdAt' | 'updatedAt'>) {
  c.title = castString(c.title)?.trim() as string;
  c.startDate = castDate(c.startDate, 'startDate') ?? undefined;
  c.endDate = castDate(c.endDate, 'endDate') ?? undefined;
  c.notes = castString(c.notes);
  new Validator().required(c.title, 'title').required(c.clientId, 'client').oneOf(c.status, CONTRACT_STATUSES, 'status').check();
  return {
    title: c.title,
    clientId: c.clientId,
    startDate: c.startDate ?? null,
    endDate: c.endDate ?? null,
    status: c.status,
    notes: encryptField(c.notes) ?? null,
  };
}

export async function listContracts(filter: { clientId?: unknown } = {}): Promise<Contract[]> {
  const where = filter.clientId !== undefined ? eq(contracts.clientId, castId(filter.clientId, 'client')) : undefined;
  return withDocuments(await db().select().from(contracts).where(where).orderBy(desc(contracts.createdAt), desc(contracts.id)));
}

export async function findContractById(id: unknown): Promise<Contract | null> {
  const [row] = await db().select().from(contracts).where(eq(contracts.id, castId(id)));
  return row ? (await withDocuments([row]))[0] : null;
}

export async function createContract(input: NewContract): Promise<Contract> {
  const now = new Date();
  const contract = {
    id: newId(),
    ...input,
    status: input.status ?? 'draft',
    documents: input.documents ?? [],
    createdAt: now,
    updatedAt: now,
  } as Contract;
  const columns = toColumns(contract);
  await db().transaction(async (tx) => {
    await tx.insert(contracts).values({ id: contract.id, ...columns, createdAt: now, updatedAt: now });
    await saveList(tx, DOCUMENTS, contract.id, contract.documents);
  });
  return contract;
}

export async function saveContract(contract: Contract): Promise<void> {
  contract.updatedAt = new Date();
  const columns = toColumns(contract);
  await db().transaction(async (tx) => {
    await tx.update(contracts).set({ ...columns, updatedAt: contract.updatedAt }).where(eq(contracts.id, contract.id));
    await saveList(tx, DOCUMENTS, contract.id, contract.documents);
  });
}

export async function deleteContract(id: string): Promise<void> {
  await db().transaction(async (tx) => {
    await deleteLists(tx, DOCUMENTS, [id]);
    await tx.delete(contracts).where(eq(contracts.id, id));
  });
}

export async function deleteClientContracts(clientId: string): Promise<void> {
  const ids = (await db().select({ id: contracts.id }).from(contracts).where(eq(contracts.clientId, clientId))).map((r) => r.id);
  if (ids.length === 0) return;
  await db().transaction(async (tx) => {
    await deleteLists(tx, DOCUMENTS, ids);
    await tx.delete(contracts).where(inArray(contracts.id, ids));
  });
}

// `client` and `documents` replace the raw ids when the caller has loaded them (populate).
export function contractJson(c: Contract, populated: { client?: object | null; documents?: object[] } = {}) {
  return {
    _id: c.id,
    title: c.title,
    client: populated.client !== undefined ? populated.client : c.clientId,
    startDate: c.startDate,
    endDate: c.endDate,
    status: c.status,
    notes: c.notes,
    documents: populated.documents ?? c.documents,
    createdAt: c.createdAt,
    updatedAt: c.updatedAt,
    id: c.id,
  };
}
