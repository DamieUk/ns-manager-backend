import { asc, eq, inArray } from 'drizzle-orm';
import { db } from '../db';
import { orderStageEvents } from '../db/schema';
import { newId } from '../db/ids';
import { Executor } from '../db/lists';
import { encryptField, decryptField } from '../utils/fieldEncryption';

// A batch's way through the shop, in order. `cancelled` sits outside the pipeline: a batch can
// be cancelled from any stage and reopened into any stage again.
export const ORDER_STAGES = [
  'quote', // прорахунок за BOM
  'agreement', // погодження і підписання додатку
  'invoicing', // рахунок і передоплата
  'procurement', // закупівля плат, компонентів, трафарету
  'prep', // програма P&P, трафарет, термопрофіль
  'assembly', // монтаж
  'washing', // ультразвукова відмивка
  'qc', // контроль якості (AOI)
  'shipping', // відвантаження з видатковими накладними
  'done',
] as const;
export const STAGES = [...ORDER_STAGES, 'cancelled'] as const;

// Paid batches the shop is working on: what the owners' dashboard follows.
export const WORK_STAGES = ['procurement', 'prep', 'assembly', 'washing', 'qc', 'shipping'] as const;
export type Stage = (typeof STAGES)[number];

// Quotes are priced in the client's currency; the agreed batch price is in UAH.
export const CURRENCIES = ['USD', 'EUR', 'UAH'] as const;
export type Currency = (typeof CURRENCIES)[number];

export type OrderStatus = 'active' | 'completed' | 'cancelled';

export function statusOfStage(stage: Stage): OrderStatus {
  if (stage === 'done') return 'completed';
  if (stage === 'cancelled') return 'cancelled';
  return 'active';
}

// Position in the pipeline; -1 for `cancelled`.
export function stageIndex(stage: Stage): number {
  return (ORDER_STAGES as readonly string[]).indexOf(stage);
}

export function nextStage(stage: Stage): Stage | undefined {
  const index = stageIndex(stage);
  return index >= 0 ? ORDER_STAGES[index + 1] : undefined;
}

export function isStage(value: unknown): value is Stage {
  return typeof value === 'string' && (STAGES as readonly string[]).includes(value);
}

export interface StageEvent {
  id: string;
  orderId: string;
  fromStage?: Stage;
  toStage: Stage;
  userId?: string;
  note?: string;
  createdAt: Date;
}

export async function recordStageEvent(executor: Executor, event: Omit<StageEvent, 'id'>): Promise<void> {
  await executor.insert(orderStageEvents).values({
    id: newId(),
    orderId: event.orderId,
    fromStage: event.fromStage ?? null,
    toStage: event.toStage,
    userId: event.userId ?? null,
    note: encryptField(event.note?.trim() || undefined) ?? null,
    createdAt: event.createdAt,
  });
}

function fromRow(row: typeof orderStageEvents.$inferSelect): StageEvent {
  return {
    id: row.id,
    orderId: row.orderId,
    fromStage: (row.fromStage as Stage | null) ?? undefined,
    toStage: row.toStage as Stage,
    userId: row.userId ?? undefined,
    note: decryptField(row.note),
    createdAt: row.createdAt,
  };
}

// A batch's history, oldest first.
export async function listStageEvents(orderId: string): Promise<StageEvent[]> {
  const rows = await db()
    .select()
    .from(orderStageEvents)
    .where(eq(orderStageEvents.orderId, orderId))
    .orderBy(asc(orderStageEvents.createdAt), asc(orderStageEvents.id));
  return rows.map(fromRow);
}

export async function deleteStageEvents(executor: Executor, orderIds: string[]): Promise<void> {
  if (orderIds.length === 0) return;
  await executor.delete(orderStageEvents).where(inArray(orderStageEvents.orderId, orderIds));
}
