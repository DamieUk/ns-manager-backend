import { and, count, desc, eq, inArray } from 'drizzle-orm';
import { db } from '../db';
import { documents } from '../db/schema';
import { newId } from '../db/ids';
import { castId, castIds, Validator } from '../utils/validate';

// What a file is — drives labels and where it shows up (client papers, batch, production).
export const DOCUMENT_TYPES = [
  'nda',
  'framework_contract',
  'annex',
  'bom',
  'quote',
  'invoice',
  'delivery_note',
  'pnp_program',
  'thermal_profile',
  'photo',
  'other',
] as const;
export type DocumentType = (typeof DOCUMENT_TYPES)[number];

// An uploaded file's metadata; the bytes live in UPLOAD_DIR under `filename` (config/storage).
export interface Doc {
  id: string;
  clientId: string;
  filename: string;
  originalName: string;
  mimeType: string;
  size: number;
  type: string;
  uploadedBy: string;
  createdAt: Date;
  updatedAt: Date;
}

export type NewDoc = Omit<Doc, 'id' | 'createdAt' | 'updatedAt'>;

export function assertDocumentType(type: unknown): asserts type is DocumentType {
  new Validator().oneOf(type, DOCUMENT_TYPES, 'type').check();
}

export async function createDocument(input: NewDoc): Promise<Doc> {
  assertDocumentType(input.type);
  const now = new Date();
  const doc: Doc = { id: newId(), ...input, createdAt: now, updatedAt: now };
  await db().insert(documents).values(doc);
  return doc;
}

export async function setDocumentType(doc: Doc, type: unknown): Promise<void> {
  assertDocumentType(type);
  doc.type = type;
  doc.updatedAt = new Date();
  await db().update(documents).set({ type, updatedAt: doc.updatedAt }).where(eq(documents.id, doc.id));
}

export async function findDocumentById(id: unknown): Promise<Doc | null> {
  const [row] = await db().select().from(documents).where(eq(documents.id, castId(id)));
  return row ?? null;
}

export async function listDocuments(filter: { clientId?: unknown } = {}): Promise<Doc[]> {
  const where = filter.clientId !== undefined ? eq(documents.clientId, castId(filter.clientId, 'client')) : undefined;
  return db().select().from(documents).where(where).orderBy(desc(documents.createdAt), desc(documents.id));
}

export async function findDocumentsByIds(ids: string[]): Promise<Doc[]> {
  if (ids.length === 0) return [];
  return db().select().from(documents).where(inArray(documents.id, ids));
}

// How many of `ids` exist and belong to `clientId` (duplicates count once).
export async function countClientDocuments(ids: unknown[], clientId: string): Promise<number> {
  const [row] = await db()
    .select({ n: count() })
    .from(documents)
    .where(and(inArray(documents.id, castIds(ids, '_id')), eq(documents.clientId, clientId)));
  return row.n;
}

export async function deleteDocument(id: string): Promise<void> {
  await db().delete(documents).where(eq(documents.id, id));
}

export async function deleteDocuments(ids: string[]): Promise<void> {
  if (ids.length) await db().delete(documents).where(inArray(documents.id, ids));
}

export async function deleteClientDocuments(clientId: string): Promise<void> {
  await db().delete(documents).where(eq(documents.clientId, clientId));
}

// `withId` adds the duplicate `id` field that file records carry when embedded in a contract
// or product response (the API has always returned it there, and only there).
export function documentJson(d: Doc, opts: { withId?: boolean } = {}) {
  return {
    _id: d.id,
    client: d.clientId,
    filename: d.filename,
    originalName: d.originalName,
    mimeType: d.mimeType,
    size: d.size,
    type: d.type,
    uploadedBy: d.uploadedBy,
    createdAt: d.createdAt,
    updatedAt: d.updatedAt,
    ...(opts.withId ? { id: d.id } : {}),
  };
}

// Resolves ids to records in the given order, skipping ids whose record no longer exists.
export function resolveDocs(ids: string[], byId: Map<string, Doc>): Doc[] {
  return ids.map((id) => byId.get(id)).filter((d): d is Doc => Boolean(d));
}
