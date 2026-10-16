import { asc, eq, inArray } from 'drizzle-orm';
import { db } from '../db';
import { products, productFiles } from '../db/schema';
import { newId } from '../db/ids';
import { deleteLists, ListTable, loadLists, saveList } from '../db/lists';
import { encryptField, decryptField } from '../utils/fieldEncryption';
import { castId, castString, Validator } from '../utils/validate';

export const PRODUCT_TYPES = ['PCB', 'Component', 'Other'] as const;
export type ProductType = (typeof PRODUCT_TYPES)[number];

export interface Product {
  id: string;
  clientId: string;
  name: string;
  sku: string;
  type: ProductType;
  description?: string;
  bomFile?: string;
  additionalFiles: string[];
  createdAt: Date;
  updatedAt: Date;
}

export type NewProduct = Omit<Product, 'id' | 'createdAt' | 'updatedAt'>;

const FILES: ListTable = {
  table: productFiles,
  owner: productFiles.productId,
  value: productFiles.documentId,
  position: productFiles.position,
  ownerKey: 'productId',
  valueKey: 'documentId',
};

type Row = typeof products.$inferSelect;

async function withFiles(rows: Row[]): Promise<Product[]> {
  const lists = await loadLists(FILES, rows.map((r) => r.id));
  return rows.map((row) => ({
    id: row.id,
    clientId: row.clientId,
    name: row.name,
    sku: row.sku,
    type: row.type as ProductType,
    description: decryptField(row.description),
    bomFile: row.bomFileId ?? undefined,
    additionalFiles: lists.get(row.id) ?? [],
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }));
}

function toColumns(p: Omit<Product, 'id' | 'createdAt' | 'updatedAt'>) {
  p.name = castString(p.name)?.trim() as string;
  p.sku = castString(p.sku)?.trim().toUpperCase() as string;
  p.description = castString(p.description);
  p.bomFile = p.bomFile === undefined || p.bomFile === null ? undefined : castId(p.bomFile, 'bomFile');
  p.additionalFiles = (p.additionalFiles ?? []).map((id) => castId(id, 'additionalFiles'));
  new Validator()
    .required(p.clientId, 'client')
    .required(p.name, 'name')
    .required(p.sku, 'sku')
    .required(p.type, 'type')
    .oneOf(p.type, PRODUCT_TYPES, 'type')
    .check();
  return {
    clientId: p.clientId,
    name: p.name,
    sku: p.sku,
    type: p.type,
    description: encryptField(p.description) ?? null,
    bomFileId: p.bomFile ?? null,
  };
}

export async function listClientProducts(clientId: unknown): Promise<Product[]> {
  return withFiles(
    await db().select().from(products).where(eq(products.clientId, castId(clientId, 'client'))).orderBy(asc(products.name), asc(products.id))
  );
}

export async function findProductById(id: unknown): Promise<Product | null> {
  const [row] = await db().select().from(products).where(eq(products.id, castId(id)));
  return row ? (await withFiles([row]))[0] : null;
}

export async function productExists(id: unknown): Promise<boolean> {
  const [row] = await db().select({ id: products.id }).from(products).where(eq(products.id, castId(id)));
  return Boolean(row);
}

export async function findProductsByIds(ids: string[]): Promise<Array<Pick<Product, 'id' | 'name'>>> {
  if (ids.length === 0) return [];
  return db().select({ id: products.id, name: products.name }).from(products).where(inArray(products.id, ids));
}

export async function createProduct(input: NewProduct): Promise<Product> {
  const now = new Date();
  const product: Product = { id: newId(), ...input, createdAt: now, updatedAt: now };
  const columns = toColumns(product);
  await db().transaction(async (tx) => {
    await tx.insert(products).values({ id: product.id, ...columns, createdAt: now, updatedAt: now });
    await saveList(tx, FILES, product.id, product.additionalFiles);
  });
  return product;
}

export async function saveProduct(product: Product): Promise<void> {
  product.updatedAt = new Date();
  const columns = toColumns(product);
  await db().transaction(async (tx) => {
    await tx.update(products).set({ ...columns, updatedAt: product.updatedAt }).where(eq(products.id, product.id));
    await saveList(tx, FILES, product.id, product.additionalFiles);
  });
}

export async function deleteProduct(id: string): Promise<void> {
  await db().transaction(async (tx) => {
    await deleteLists(tx, FILES, [id]);
    await tx.delete(products).where(eq(products.id, id));
  });
}

export async function deleteClientProducts(clientId: string): Promise<void> {
  const ids = (await db().select({ id: products.id }).from(products).where(eq(products.clientId, clientId))).map((r) => r.id);
  if (ids.length === 0) return;
  await db().transaction(async (tx) => {
    await deleteLists(tx, FILES, ids);
    await tx.delete(products).where(inArray(products.id, ids));
  });
}

// `bomFile` / `additionalFiles` replace the raw ids when the caller has loaded the file records.
export function productJson(p: Product, populated: { bomFile?: object | null; additionalFiles?: object[] } = {}) {
  return {
    _id: p.id,
    client: p.clientId,
    name: p.name,
    sku: p.sku,
    type: p.type,
    description: p.description,
    bomFile: p.bomFile === undefined ? undefined : populated.bomFile !== undefined ? populated.bomFile : p.bomFile,
    additionalFiles: populated.additionalFiles ?? p.additionalFiles,
    createdAt: p.createdAt,
    updatedAt: p.updatedAt,
    id: p.id,
  };
}
