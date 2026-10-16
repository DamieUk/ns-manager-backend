import { and, count, desc, eq, inArray } from 'drizzle-orm';
import { db } from '../db';
import { documents } from '../db/schema';
import { newId } from '../db/ids';
import { castId, castIds } from '../utils/validate';

// An uploaded file's metadata; the bytes live in UPLOAD_DIR under `filename` (config/storage).
export interface Doc {
  id: string;
  clientId: string;
  filename: string;
  originalName: string;
  mimeType: string;
  size: number;
  uploadedBy: string;
  createdAt: Date;
  updatedAt: Date;
}

export type NewDoc = Omit<Doc, 'id' | 'createdAt' | 'updatedAt'>;

export async function createDocument(input: NewDoc): Promise<Doc> {
  const now = new Date();
  const doc: Doc = { id: newId(), ...input, createdAt: now, updatedAt: now };
  await db().insert(documents).values(doc);
  return doc;
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
