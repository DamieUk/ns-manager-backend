import { and, asc, eq, inArray, notInArray, SQL } from 'drizzle-orm';
import { db } from '../db';
import { purchases } from '../db/schema';
import { newId } from '../db/ids';
import { Executor } from '../db/lists';
import { encryptField, decryptField } from '../utils/fieldEncryption';
import { castString, Validator } from '../utils/validate';
import { CURRENCIES, Currency } from './orderStage.model';

export const PURCHASE_CATEGORIES = ['pcb', 'components', 'stencil', 'service', 'other'] as const;
export type PurchaseCategory = (typeof PURCHASE_CATEGORIES)[number];

// planned → ordered → shipped → received; cancelled drops out.
export const PURCHASE_STATUSES = ['planned', 'ordered', 'shipped', 'received', 'cancelled'] as const;
export type PurchaseStatus = (typeof PURCHASE_STATUSES)[number];

// Statuses that mean money has gone to the supplier: allowed only for a prepaid batch.
export const COMMITTED_STATUSES: readonly PurchaseStatus[] = ['ordered', 'shipped', 'received'];

export interface Purchase {
  id: string;
  orderId: string;
  category: PurchaseCategory;
  supplier: string;
  description?: string;
  supplierOrderNo?: string;
  trackingNumber?: string;
  cost?: number;
  currency?: Currency;
  status: PurchaseStatus;
  orderedAt?: Date;
  expectedAt?: Date;
  receivedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

export type NewPurchase = Omit<Purchase, 'id' | 'createdAt' | 'updatedAt'>;

type Row = typeof purchases.$inferSelect;

function fromRow(row: Row): Purchase {
  return {
    id: row.id,
    orderId: row.orderId,
    category: row.category as PurchaseCategory,
    supplier: row.supplier,
    description: decryptField(row.description),
    supplierOrderNo: row.supplierOrderNo ?? undefined,
    trackingNumber: row.trackingNumber ?? undefined,
    cost: row.cost ?? undefined,
    currency: (row.currency as Currency | null) ?? undefined,
    status: row.status as PurchaseStatus,
    orderedAt: row.orderedAt ?? undefined,
    expectedAt: row.expectedAt ?? undefined,
    receivedAt: row.receivedAt ?? undefined,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function toColumns(p: Omit<Purchase, 'id' | 'createdAt' | 'updatedAt'>) {
  p.supplier = castString(p.supplier)?.trim() as string;
  p.description = castString(p.description)?.trim() || undefined;
  p.supplierOrderNo = castString(p.supplierOrderNo)?.trim() || undefined;
  p.trackingNumber = castString(p.trackingNumber)?.trim() || undefined;
  new Validator()
    .required(p.supplier, 'supplier')
    .oneOf(p.category, PURCHASE_CATEGORIES, 'category')
    .oneOf(p.status, PURCHASE_STATUSES, 'status')
    .oneOf(p.currency, CURRENCIES, 'currency')
    .min(p.cost, 0, 'cost')
    .check();
  return {
    orderId: p.orderId,
    category: p.category,
    supplier: p.supplier,
    description: encryptField(p.description) ?? null,
    supplierOrderNo: p.supplierOrderNo ?? null,
    trackingNumber: p.trackingNumber ?? null,
    cost: p.cost ?? null,
    currency: p.cost !== undefined ? (p.currency ?? null) : null,
    status: p.status,
    orderedAt: p.orderedAt ?? null,
    expectedAt: p.expectedAt ?? null,
    receivedAt: p.receivedAt ?? null,
  };
}

// The dates follow the status: ordering stamps orderedAt, receiving stamps receivedAt.
export function stampPurchaseDates(p: Purchase): void {
  const now = new Date();
  if (COMMITTED_STATUSES.includes(p.status) && !p.orderedAt) p.orderedAt = now;
  if (p.status === 'received' && !p.receivedAt) p.receivedAt = now;
  if (p.status !== 'received') p.receivedAt = undefined;
}

export async function listPurchases(filter: { orderIds?: string[]; open?: boolean } = {}): Promise<Purchase[]> {
  if (filter.orderIds && filter.orderIds.length === 0) return [];
  const conditions: SQL[] = [];
  if (filter.orderIds) conditions.push(inArray(purchases.orderId, filter.orderIds));
  if (filter.open) conditions.push(notInArray(purchases.status, ['received', 'cancelled']));
  const rows = await db().select().from(purchases).where(and(...conditions)).orderBy(asc(purchases.createdAt), asc(purchases.id));
  return rows.map(fromRow);
}

export async function findPurchaseById(id: string): Promise<Purchase | null> {
  const [row] = await db().select().from(purchases).where(eq(purchases.id, id));
  return row ? fromRow(row) : null;
}

export async function createPurchase(input: NewPurchase): Promise<Purchase> {
  const now = new Date();
  const purchase: Purchase = { id: newId(), ...input, createdAt: now, updatedAt: now };
  stampPurchaseDates(purchase);
  await db().insert(purchases).values({ id: purchase.id, ...toColumns(purchase), createdAt: now, updatedAt: now });
  return purchase;
}

export async function savePurchase(purchase: Purchase): Promise<void> {
  purchase.updatedAt = new Date();
  stampPurchaseDates(purchase);
  await db().update(purchases).set({ ...toColumns(purchase), updatedAt: purchase.updatedAt }).where(eq(purchases.id, purchase.id));
}

export async function deletePurchase(id: string): Promise<void> {
  await db().delete(purchases).where(eq(purchases.id, id));
}

export async function deleteOrderPurchases(executor: Executor, orderIds: string[]): Promise<void> {
  if (orderIds.length === 0) return;
  await executor.delete(purchases).where(inArray(purchases.orderId, orderIds));
}

export const isPurchaseOpen = (p: Purchase) => p.status !== 'received' && p.status !== 'cancelled';

export function purchaseJson(p: Purchase) {
  return {
    id: p.id,
    order: p.orderId,
    category: p.category,
    supplier: p.supplier,
    description: p.description ?? null,
    supplierOrderNo: p.supplierOrderNo ?? null,
    trackingNumber: p.trackingNumber ?? null,
    cost: p.cost ?? null,
    currency: p.currency ?? null,
    status: p.status,
    orderedAt: p.orderedAt ?? null,
    expectedAt: p.expectedAt ?? null,
    receivedAt: p.receivedAt ?? null,
    isLate: isPurchaseOpen(p) && Boolean(p.expectedAt) && p.expectedAt! < new Date(),
    createdAt: p.createdAt,
  };
}
