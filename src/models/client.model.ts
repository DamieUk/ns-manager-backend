import { asc, eq, inArray } from 'drizzle-orm';
import { db } from '../db';
import { clients } from '../db/schema';
import { newId } from '../db/ids';
import { encryptField, decryptField } from '../utils/fieldEncryption';
import { castId, castString, Validator } from '../utils/validate';

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
  createdAt: Date;
  updatedAt: Date;
}

export type NewClient = Pick<Client, 'name' | 'code'> & Partial<Pick<Client, 'contactName' | 'email' | 'phone' | 'address' | 'notes'>>;

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
  new Validator()
    .required(c.name, 'name')
    .required(c.code, 'code')
    .required(c.status, 'status')
    .oneOf(c.status, CLIENT_STATUSES, 'status')
    .check();
  return {
    name: c.name,
    code: c.code,
    status: c.status,
    contactName: encryptField(c.contactName) ?? null,
    email: encryptField(c.email) ?? null,
    phone: encryptField(c.phone) ?? null,
    address: encryptField(c.address) ?? null,
    notes: encryptField(c.notes) ?? null,
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
    createdAt: c.createdAt,
    updatedAt: c.updatedAt,
    id: c.id,
  };
}

// A client as embedded in other records' responses (`populate('client', 'name')`).
export function clientRefJson(c: Client | undefined) {
  return c ? { _id: c.id, name: c.name, id: c.id } : null;
}
