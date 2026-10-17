import { and, desc, eq, inArray, SQL } from 'drizzle-orm';
import { db } from '../db';
import { shipmentLines, shipments } from '../db/schema';
import { newId } from '../db/ids';
import { withDailyNumber } from '../db/numbers';
import { encryptField, decryptField } from '../utils/fieldEncryption';
import { castString } from '../utils/validate';

export interface ShipmentLine {
  orderId: string;
  description: string;
  quantity: number;
  unitPrice: number; // UAH without VAT
}

export interface Shipment {
  id: string;
  number: string;
  clientId: string;
  shippedAt: Date;
  vatRate: number;
  carrier?: string;
  trackingNumber?: string;
  note?: string;
  lines: ShipmentLine[];
  createdBy: string;
  createdAt: Date;
  updatedAt: Date;
}

export type NewShipment = Omit<Shipment, 'id' | 'number' | 'createdAt' | 'updatedAt'>;

const round = (n: number) => Math.round(n * 100) / 100;

// Сума without VAT, the VAT on it and Всього — as on the delivery note.
export function shipmentTotals(s: Pick<Shipment, 'lines' | 'vatRate'>) {
  const net = round(s.lines.reduce((sum, l) => sum + round(l.quantity * l.unitPrice), 0));
  const vat = round((net * s.vatRate) / 100);
  return { net, vatRate: s.vatRate, vat, total: round(net + vat) };
}

async function withLines(rows: (typeof shipments.$inferSelect)[]): Promise<Shipment[]> {
  const ids = rows.map((r) => r.id);
  const lines = ids.length ? await db().select().from(shipmentLines).where(inArray(shipmentLines.shipmentId, ids)) : [];
  return rows.map((row) => ({
    id: row.id,
    number: row.number,
    clientId: row.clientId,
    shippedAt: row.shippedAt,
    vatRate: row.vatRate,
    carrier: row.carrier ?? undefined,
    trackingNumber: row.trackingNumber ?? undefined,
    note: decryptField(row.note),
    lines: lines
      .filter((l) => l.shipmentId === row.id)
      .sort((a, b) => a.position - b.position)
      .map((l) => ({ orderId: l.orderId, description: l.description, quantity: l.quantity, unitPrice: l.unitPrice })),
    createdBy: row.createdBy,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }));
}

// Newest first. `orderIds`: only the notes with a line from one of these batches.
export async function listShipments(filter: { clientId?: string; orderIds?: string[] } = {}): Promise<Shipment[]> {
  const conditions: SQL[] = [];
  if (filter.clientId) conditions.push(eq(shipments.clientId, filter.clientId));
  if (filter.orderIds) {
    if (filter.orderIds.length === 0) return [];
    conditions.push(
      inArray(shipments.id, db().select({ id: shipmentLines.shipmentId }).from(shipmentLines).where(inArray(shipmentLines.orderId, filter.orderIds)))
    );
  }
  return withLines(await db().select().from(shipments).where(and(...conditions)).orderBy(desc(shipments.shippedAt), desc(shipments.number)));
}

export async function findShipmentById(id: string): Promise<Shipment | null> {
  const [row] = await db().select().from(shipments).where(eq(shipments.id, id));
  return row ? (await withLines([row]))[0] : null;
}

// Boards shipped so far per batch.
export async function shippedQuantities(orderIds: string[]): Promise<Map<string, number>> {
  const result = new Map(orderIds.map((id) => [id, 0]));
  if (orderIds.length === 0) return result;
  const rows = await db().select({ orderId: shipmentLines.orderId, quantity: shipmentLines.quantity }).from(shipmentLines).where(inArray(shipmentLines.orderId, orderIds));
  for (const r of rows) result.set(r.orderId, (result.get(r.orderId) ?? 0) + r.quantity);
  return result;
}

export async function createShipment(input: NewShipment): Promise<Shipment> {
  const now = new Date();
  const shipment: Shipment = {
    id: newId(),
    number: '',
    ...input,
    carrier: castString(input.carrier)?.trim() || undefined,
    trackingNumber: castString(input.trackingNumber)?.trim() || undefined,
    note: castString(input.note)?.trim() || undefined,
    createdAt: now,
    updatedAt: now,
  };
  return withDailyNumber(shipments, shipments.number, shipment.shippedAt, async (number) => {
    shipment.number = number;
    await db().transaction(async (tx) => {
      await tx.insert(shipments).values({
        id: shipment.id,
        number,
        clientId: shipment.clientId,
        shippedAt: shipment.shippedAt,
        vatRate: shipment.vatRate,
        carrier: shipment.carrier ?? null,
        trackingNumber: shipment.trackingNumber ?? null,
        note: encryptField(shipment.note) ?? null,
        createdBy: shipment.createdBy,
        createdAt: now,
        updatedAt: now,
      });
      await tx.insert(shipmentLines).values(shipment.lines.map((l, position) => ({ shipmentId: shipment.id, position, ...l })));
    });
    return shipment;
  });
}

export async function deleteShipment(id: string): Promise<void> {
  await db().transaction(async (tx) => {
    await tx.delete(shipmentLines).where(eq(shipmentLines.shipmentId, id));
    await tx.delete(shipments).where(eq(shipments.id, id));
  });
}

export async function deleteClientShipments(clientId: string): Promise<void> {
  const ids = (await db().select({ id: shipments.id }).from(shipments).where(eq(shipments.clientId, clientId))).map((r) => r.id);
  if (ids.length === 0) return;
  await db().transaction(async (tx) => {
    await tx.delete(shipmentLines).where(inArray(shipmentLines.shipmentId, ids));
    await tx.delete(shipments).where(inArray(shipments.id, ids));
  });
}

export function shipmentJson(s: Shipment) {
  return {
    id: s.id,
    number: s.number,
    client: s.clientId,
    shippedAt: s.shippedAt,
    carrier: s.carrier ?? null,
    trackingNumber: s.trackingNumber ?? null,
    note: s.note ?? null,
    lines: s.lines.map((l) => ({ ...l, order: l.orderId, sum: round(l.quantity * l.unitPrice) })),
    ...shipmentTotals(s),
    createdAt: s.createdAt,
  };
}
