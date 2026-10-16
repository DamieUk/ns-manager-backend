import { asc, eq, inArray } from 'drizzle-orm';
import { db } from '../db';
import { clients } from '../db/schema';
import { newId } from '../db/ids';
import { encryptField, decryptField } from '../utils/fieldEncryption';
import { castId, castString, Validator } from '../utils/validate';
import { HttpError } from '../utils/HttpError';

export const CLIENT_STATUSES = ['active', 'deleted'] as const;
export type ClientStatus = (typeof CLIENT_STATUSES)[number];

export interface Client {
  id: string;
  name: string;
  code: string;
  status: ClientStatus;
  contactName?: string;
  email?: string;
  phone?: string;
  address?: string;
  notes?: string;
  legalName?: string;
  edrpou?: string;
  legalAddress?: string;
  iban?: string;
  bankName?: string;
  vatNumber?: string;
  signatory?: string;
  createdAt: Date;
  updatedAt: Date;
}

// Optional fields an owner fills in for the client's card and generated documents.
export const CLIENT_DETAIL_FIELDS = [
  'contactName',
  'email',
  'phone',
  'address',
  'notes',
  'legalName',
  'edrpou',
  'legalAddress',
  'iban',
  'bankName',
  'vatNumber',
  'signatory',
] as const;

export type NewClient = Pick<Client, 'name' | 'code'> & Partial<Pick<Client, (typeof CLIENT_DETAIL_FIELDS)[number]>>;

type Row = typeof clients.$inferSelect;

function fromRow(row: Row): Client {
  return {
    id: row.id,
    name: row.name,
    code: row.code,
    status: row.status as ClientStatus,
    contactName: decryptField(row.contactName),
    email: decryptField(row.email),
    phone: decryptField(row.phone),
    address: decryptField(row.address),
    notes: decryptField(row.notes),
    legalName: decryptField(row.legalName),
    edrpou: decryptField(row.edrpou),
    legalAddress: decryptField(row.legalAddress),
    iban: decryptField(row.iban),
    bankName: decryptField(row.bankName),
    vatNumber: decryptField(row.vatNumber),
    signatory: decryptField(row.signatory),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function toColumns(c: Omit<Client, 'id' | 'createdAt' | 'updatedAt'>) {
  c.name = castString(c.name)?.trim() as string;
  c.code = castString(c.code)?.trim().toUpperCase() as string;
  c.contactName = castString(c.contactName)?.trim();
  c.email = castString(c.email)?.trim().toLowerCase();
  c.phone = castString(c.phone)?.trim();
  c.address = castString(c.address)?.trim();
  c.notes = castString(c.notes);
  c.legalName = castString(c.legalName)?.trim();
  c.edrpou = castString(c.edrpou)?.replace(/\s+/g, '');
  c.legalAddress = castString(c.legalAddress)?.trim();
  c.iban = castString(c.iban)?.replace(/\s+/g, '').toUpperCase();
  c.bankName = castString(c.bankName)?.trim();
  c.vatNumber = castString(c.vatNumber)?.replace(/\s+/g, '');
  c.signatory = castString(c.signatory)?.trim();
  new Validator()
    .required(c.name, 'name')
    .required(c.code, 'code')
    .required(c.status, 'status')
    .oneOf(c.status, CLIENT_STATUSES, 'status')
    .check();
  if (c.edrpou && !/^(\d{8}|\d{10})$/.test(c.edrpou)) throw new HttpError(400, 'ЄДРПОУ має містити 8 цифр (або ІПН ФОП — 10 цифр)');
  if (c.iban && !/^UA\d{27}$/.test(c.iban)) throw new HttpError(400, 'IBAN має бути у форматі UA + 27 цифр');
  if (c.vatNumber && !/^\d{10,12}$/.test(c.vatNumber)) throw new HttpError(400, 'ІПН платника ПДВ має містити 10–12 цифр');
  return {
    name: c.name,
    code: c.code,
    status: c.status,
    contactName: encryptField(c.contactName) ?? null,
    email: encryptField(c.email) ?? null,
    phone: encryptField(c.phone) ?? null,
    address: encryptField(c.address) ?? null,
    notes: encryptField(c.notes) ?? null,
    legalName: encryptField(c.legalName) ?? null,
    edrpou: encryptField(c.edrpou) ?? null,
    legalAddress: encryptField(c.legalAddress) ?? null,
    iban: encryptField(c.iban) ?? null,
    bankName: encryptField(c.bankName) ?? null,
    vatNumber: encryptField(c.vatNumber) ?? null,
    signatory: encryptField(c.signatory) ?? null,
  };
}

export async function listClients(): Promise<Client[]> {
  const rows = await db().select().from(clients).orderBy(asc(clients.name), asc(clients.id));
  return rows.map(fromRow);
}

export async function findClientById(id: unknown): Promise<Client | null> {
  const [row] = await db().select().from(clients).where(eq(clients.id, castId(id)));
  return row ? fromRow(row) : null;
}

export async function clientExists(id: unknown): Promise<boolean> {
  const [row] = await db().select({ id: clients.id }).from(clients).where(eq(clients.id, castId(id)));
  return Boolean(row);
}

export async function findClientsByIds(ids: string[]): Promise<Client[]> {
  if (ids.length === 0) return [];
  return (await db().select().from(clients).where(inArray(clients.id, ids))).map(fromRow);
}

export async function createClient(input: NewClient): Promise<Client> {
  const now = new Date();
  const client: Client = { id: newId(), status: 'active', ...input, createdAt: now, updatedAt: now };
  await db().insert(clients).values({ id: client.id, ...toColumns(client), createdAt: now, updatedAt: now });
  return client;
}

export async function saveClient(client: Client): Promise<void> {
  client.updatedAt = new Date();
  await db().update(clients).set({ ...toColumns(client), updatedAt: client.updatedAt }).where(eq(clients.id, client.id));
}

export async function deleteClient(id: string): Promise<void> {
  await db().delete(clients).where(eq(clients.id, id));
}

export function clientJson(c: Client) {
  return {
    _id: c.id,
    name: c.name,
    code: c.code,
    status: c.status,
    contactName: c.contactName,
    email: c.email,
    phone: c.phone,
    address: c.address,
    notes: c.notes,
    legalName: c.legalName,
    edrpou: c.edrpou,
    legalAddress: c.legalAddress,
    iban: c.iban,
    bankName: c.bankName,
    vatNumber: c.vatNumber,
    signatory: c.signatory,
    createdAt: c.createdAt,
    updatedAt: c.updatedAt,
    id: c.id,
  };
}

// A client as embedded in other records' responses (`populate('client', 'name')`).
export function clientRefJson(c: Client | undefined) {
  return c ? { _id: c.id, name: c.name, id: c.id } : null;
}
