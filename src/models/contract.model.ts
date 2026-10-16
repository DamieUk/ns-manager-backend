import { desc, eq, inArray } from 'drizzle-orm';
import { db } from '../db';
import { contracts, contractDocuments } from '../db/schema';
import { newId } from '../db/ids';
import { deleteLists, ListTable, loadLists, saveList } from '../db/lists';
import { encryptField, decryptField } from '../utils/fieldEncryption';
import { castDate, castId, castString, Validator } from '../utils/validate';

export const CONTRACT_STATUSES = ['draft', 'active', 'completed', 'cancelled'] as const;
export type ContractStatus = (typeof CONTRACT_STATUSES)[number];

// nda and framework are signed once per client; an annex covers one batch (order).
export const CONTRACT_TYPES = ['nda', 'framework', 'annex'] as const;
export type ContractType = (typeof CONTRACT_TYPES)[number];

// The document type a contract's files get.
export const CONTRACT_DOCUMENT_TYPE = { nda: 'nda', framework: 'framework_contract', annex: 'annex' } as const;

export function defaultContractTitle(type: ContractType, number?: string): string {
  if (type === 'nda') return number ? `NDA № ${number}` : 'NDA';
  if (type === 'annex') return number ? `Додаток № ${number}` : 'Додаток до договору';
  return number ? `Договір № ${number}` : 'Рамковий договір';
}

export interface Contract {
  id: string;
  title: string;
  clientId: string;
  type: ContractType;
  number?: string;
  signedAt?: Date;
  orderId?: string;
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
  type?: ContractType;
  number?: string;
  signedAt?: unknown;
  orderId?: string;
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
    type: row.type as ContractType,
    number: row.number ?? undefined,
    signedAt: row.signedAt ?? undefined,
    orderId: row.orderId ?? undefined,
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
  c.number = castString(c.number)?.trim() || undefined;
  c.signedAt = castDate(c.signedAt, 'signedAt') ?? undefined;
  c.orderId = c.orderId === undefined || c.orderId === null || (c.orderId as unknown) === '' ? undefined : castId(c.orderId, 'order');
  c.startDate = castDate(c.startDate, 'startDate') ?? undefined;
  c.endDate = castDate(c.endDate, 'endDate') ?? undefined;
  c.notes = castString(c.notes);
  new Validator()
    .required(c.title, 'title')
    .required(c.clientId, 'client')
    .oneOf(c.type, CONTRACT_TYPES, 'type')
    .oneOf(c.status, CONTRACT_STATUSES, 'status')
    .check();
  return {
    title: c.title,
    clientId: c.clientId,
    type: c.type,
    number: c.number ?? null,
    signedAt: c.signedAt ?? null,
    orderId: c.orderId ?? null,
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
    type: input.type ?? 'framework',
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

// The client's NDA and framework contract at a glance: the signed one with the latest signing
// date, otherwise the newest unsigned one; null when there is none (cancelled ones don't count).
export interface PaperState {
  contractId: string;
  number: string | null;
  signedAt: Date | null;
}

export function paperStatus(contracts: Contract[]): { nda: PaperState | null; framework: PaperState | null } {
  const pick = (type: ContractType): PaperState | null => {
    const candidates = contracts.filter((c) => c.type === type && c.status !== 'cancelled');
    const signed = candidates.filter((c) => c.signedAt).sort((a, b) => b.signedAt!.getTime() - a.signedAt!.getTime());
    const chosen = signed[0] ?? [...candidates].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())[0];
    return chosen ? { contractId: chosen.id, number: chosen.number ?? null, signedAt: chosen.signedAt ?? null } : null;
  };
  return { nda: pick('nda'), framework: pick('framework') };
}

// `client` and `documents` replace the raw ids when the caller has loaded them (populate).
export function contractJson(c: Contract, populated: { client?: object | null; documents?: object[] } = {}) {
  return {
    _id: c.id,
    title: c.title,
    type: c.type,
    number: c.number,
    signedAt: c.signedAt,
    order: c.orderId,
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
