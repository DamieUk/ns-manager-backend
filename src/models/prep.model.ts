import { and, eq, inArray } from 'drizzle-orm';
import { db } from '../db';
import { orderPrep } from '../db/schema';
import { Executor } from '../db/lists';
import { encryptField, decryptField } from '../utils/fieldEncryption';

// What has to be ready before a batch goes to assembly.
export const PREP_ITEMS = ['pnp_program', 'stencil', 'thermal_profile'] as const;
export type PrepItemKey = (typeof PREP_ITEMS)[number];

export const PREP_LABELS: Record<PrepItemKey, string> = {
  pnp_program: 'програма P&P',
  stencil: 'трафарет',
  thermal_profile: 'термопрофіль',
};

// The document type a file attached to the item gets.
export const PREP_DOCUMENT_TYPE = { pnp_program: 'pnp_program', stencil: 'other', thermal_profile: 'thermal_profile' } as const;

// not_needed: e.g. the stencil of an earlier batch is reused.
export const PREP_STATUSES = ['pending', 'done', 'not_needed'] as const;
export type PrepStatus = (typeof PREP_STATUSES)[number];

export interface PrepItem {
  item: PrepItemKey;
  status: PrepStatus;
  documentId?: string;
  note?: string;
  updatedBy?: string;
  updatedAt?: Date;
}

// Every batch's checklist in PREP_ITEMS order; untouched items are pending.
export async function loadPrep(orderIds: string[]): Promise<Map<string, PrepItem[]>> {
  const rows = orderIds.length ? await db().select().from(orderPrep).where(inArray(orderPrep.orderId, orderIds)) : [];
  return new Map(
    orderIds.map((orderId) => [
      orderId,
      PREP_ITEMS.map((item): PrepItem => {
        const row = rows.find((r) => r.orderId === orderId && r.item === item);
        return row
          ? {
              item,
              status: row.status as PrepStatus,
              documentId: row.documentId ?? undefined,
              note: decryptField(row.note),
              updatedBy: row.updatedBy,
              updatedAt: row.updatedAt,
            }
          : { item, status: 'pending' };
      }),
    ])
  );
}

export async function savePrepItem(orderId: string, p: Required<Pick<PrepItem, 'item' | 'status' | 'updatedBy'>> & PrepItem): Promise<void> {
  const values = {
    status: p.status,
    documentId: p.documentId ?? null,
    note: encryptField(p.note?.trim() || undefined) ?? null,
    updatedBy: p.updatedBy,
    updatedAt: new Date(),
  };
  await db()
    .insert(orderPrep)
    .values({ orderId, item: p.item, ...values })
    .onDuplicateKeyUpdate({ set: values });
}

export async function deleteOrderPrep(executor: Executor, orderIds: string[]): Promise<void> {
  if (orderIds.length === 0) return;
  await executor.delete(orderPrep).where(inArray(orderPrep.orderId, orderIds));
}

export async function clearPrepDocument(orderId: string, documentId: string): Promise<void> {
  await db()
    .update(orderPrep)
    .set({ documentId: null })
    .where(and(eq(orderPrep.orderId, orderId), eq(orderPrep.documentId, documentId)));
}

// The labels of the items still pending («програма P&P, трафарет»).
export const pendingPrep = (items: PrepItem[]) => items.filter((p) => p.status === 'pending').map((p) => PREP_LABELS[p.item]);
