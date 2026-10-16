import { and, asc, desc, eq, inArray, like, sql, SQL } from 'drizzle-orm';
import { db } from '../db';
import { orders, orderDocuments, orderEmployees } from '../db/schema';
import { newId } from '../db/ids';
import { deleteLists, ListTable, loadLists, saveList } from '../db/lists';
import { encryptField, decryptField } from '../utils/fieldEncryption';
import { castId, castNumber, Validator } from '../utils/validate';
import { isDuplicateKeyError } from '../utils/dbErrors';
import {
  Currency,
  CURRENCIES,
  deleteStageEvents,
  OrderStatus,
  recordStageEvent,
  Stage,
  STAGES,
  statusOfStage,
} from './orderStage.model';

export type { OrderStatus } from './orderStage.model';

export interface Order {
  id: string;
  number: string;
  clientId: string;
  productId: string;
  quantity: number;
  description: string;
  status: OrderStatus; // follows `stage`
  stage: Stage;
  stageChangedAt: Date;
  dueDate?: Date;
  managerId?: string;
  quoteAmount?: number;
  quoteCurrency?: Currency;
  exchangeRate?: number;
  priceUah?: number;
  assignedEmployees: string[];
  documents: string[];
  createdAt: Date;
  updatedAt: Date;
}

export type NewOrder = Omit<Order, 'id' | 'number' | 'status' | 'stage' | 'stageChangedAt' | 'createdAt' | 'updatedAt'>;

const EMPLOYEES: ListTable = {
  table: orderEmployees,
  owner: orderEmployees.orderId,
  value: orderEmployees.userId,
  position: orderEmployees.position,
  ownerKey: 'orderId',
  valueKey: 'userId',
};

const DOCUMENTS: ListTable = {
  table: orderDocuments,
  owner: orderDocuments.orderId,
  value: orderDocuments.documentId,
  position: orderDocuments.position,
  ownerKey: 'orderId',
  valueKey: 'documentId',
};

type Row = typeof orders.$inferSelect;

async function withLists(rows: Row[]): Promise<Order[]> {
  const ids = rows.map((r) => r.id);
  const [employees, docs] = await Promise.all([loadLists(EMPLOYEES, ids), loadLists(DOCUMENTS, ids)]);
  return rows.map((row) => ({
    id: row.id,
    number: row.number,
    clientId: row.clientId,
    productId: row.productId,
    quantity: row.quantity,
    description: decryptField(row.description) ?? '',
    status: row.status as OrderStatus,
    stage: row.stage as Stage,
    stageChangedAt: row.stageChangedAt,
    dueDate: row.dueDate ?? undefined,
    managerId: row.managerId ?? undefined,
    quoteAmount: row.quoteAmount ?? undefined,
    quoteCurrency: (row.quoteCurrency as Currency | null) ?? undefined,
    exchangeRate: row.exchangeRate ?? undefined,
    priceUah: row.priceUah ?? undefined,
    assignedEmployees: employees.get(row.id) ?? [],
    documents: docs.get(row.id) ?? [],
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }));
}

const optionalNumber = (value: unknown, path: string) => castNumber(value, path) ?? undefined;

// Money is kept to the kopiyka (cent), exchange rates to four decimals.
export const roundMoney = (n: number) => Math.round(n * 100) / 100;

function toColumns(o: Omit<Order, 'id' | 'number' | 'createdAt' | 'updatedAt'>) {
  o.quantity = castNumber(o.quantity, 'quantity') as number;
  o.managerId = o.managerId === undefined || o.managerId === null ? undefined : castId(o.managerId, 'manager');
  o.assignedEmployees = (o.assignedEmployees ?? []).map((id) => castId(id, 'assignedEmployees'));
  o.documents = (o.documents ?? []).map((id) => castId(id, 'documents'));
  o.quoteAmount = optionalNumber(o.quoteAmount, 'quoteAmount');
  o.quoteCurrency = (o.quoteCurrency as unknown) === '' || o.quoteCurrency === null ? undefined : o.quoteCurrency;
  o.exchangeRate = optionalNumber(o.exchangeRate, 'exchangeRate');
  o.priceUah = optionalNumber(o.priceUah, 'priceUah');
  if (o.quoteAmount !== undefined) o.quoteAmount = roundMoney(o.quoteAmount);
  if (o.priceUah !== undefined) o.priceUah = roundMoney(o.priceUah);
  if (o.exchangeRate !== undefined) o.exchangeRate = Math.round(o.exchangeRate * 10_000) / 10_000;
  o.status = statusOfStage(o.stage);
  new Validator()
    .required(o.clientId, 'client')
    .required(o.productId, 'product')
    .required(o.quantity, 'quantity')
    .min(o.quantity, 1, 'quantity')
    .required(o.description, 'description')
    .oneOf(o.stage, STAGES, 'stage')
    .oneOf(o.quoteCurrency, CURRENCIES, 'quoteCurrency')
    .min(o.quoteAmount, 0, 'quoteAmount')
    .min(o.exchangeRate, 0, 'exchangeRate')
    .min(o.priceUah, 0, 'priceUah')
    .check();
  return {
    clientId: o.clientId,
    productId: o.productId,
    quantity: o.quantity,
    description: encryptField(o.description)!,
    status: o.status,
    stage: o.stage,
    stageChangedAt: o.stageChangedAt,
    dueDate: o.dueDate ?? null,
    managerId: o.managerId ?? null,
    quoteAmount: o.quoteAmount ?? null,
    quoteCurrency: o.quoteCurrency ?? null,
    exchangeRate: o.exchangeRate ?? null,
    priceUah: o.priceUah ?? null,
  };
}

const assignedTo = (userId: string) =>
  inArray(orders.id, db().select({ id: orderEmployees.orderId }).from(orderEmployees).where(eq(orderEmployees.userId, userId)));

export async function listOrders(
  filter: { status?: unknown; stage?: unknown; clientId?: unknown; employeeId?: string } = {}
): Promise<Order[]> {
  const conditions: SQL[] = [];
  if (filter.status) conditions.push(eq(orders.status, String(filter.status)));
  if (filter.stage) conditions.push(inArray(orders.stage, String(filter.stage).split(',')));
  if (filter.clientId) conditions.push(eq(orders.clientId, castId(filter.clientId, 'client')));
  if (filter.employeeId) conditions.push(assignedTo(filter.employeeId));
  return withLists(await db().select().from(orders).where(and(...conditions)).orderBy(desc(orders.createdAt), desc(orders.id)));
}

// An employee's orders: earliest due date first (orders without one come first), newest next.
export async function listEmployeeOrders(employeeId: string): Promise<Order[]> {
  return withLists(
    await db().select().from(orders).where(assignedTo(employeeId)).orderBy(asc(orders.dueDate), desc(orders.createdAt), desc(orders.id))
  );
}

export async function listOrdersInStages(stages: readonly Stage[]): Promise<Order[]> {
  return withLists(
    await db().select().from(orders).where(inArray(orders.stage, [...stages])).orderBy(asc(orders.createdAt), asc(orders.id))
  );
}

export async function findOrderById(id: unknown): Promise<Order | null> {
  const [row] = await db().select().from(orders).where(eq(orders.id, castId(id)));
  return row ? (await withLists([row]))[0] : null;
}

export async function isDocumentOfAssignedOrder(documentId: string, userId: string): Promise<boolean> {
  const [row] = await db()
    .select({ orderId: orderDocuments.orderId })
    .from(orderDocuments)
    .innerJoin(orderEmployees, eq(orderEmployees.orderId, orderDocuments.orderId))
    .where(and(eq(orderDocuments.documentId, documentId), eq(orderEmployees.userId, userId)))
    .limit(1);
  return Boolean(row);
}

// Just the client/product links of the given orders (for progress-report responses).
export async function findOrderLinks(ids: string[]): Promise<Array<Pick<Order, 'id' | 'clientId' | 'productId'>>> {
  if (ids.length === 0) return [];
  return db().select({ id: orders.id, clientId: orders.clientId, productId: orders.productId }).from(orders).where(inArray(orders.id, ids));
}

// The next free batch number of the year: «26-001», «26-002», ...
async function nextOrderNumber(now: Date): Promise<string> {
  const prefix = `${String(now.getUTCFullYear()).slice(-2)}-`;
  const [row] = await db()
    .select({ max: sql<number | null>`MAX(CAST(SUBSTRING(${orders.number}, 4) AS UNSIGNED))` })
    .from(orders)
    .where(like(orders.number, `${prefix}%`));
  return prefix + String(Number(row?.max ?? 0) + 1).padStart(3, '0');
}

// A new batch starts at the quote stage; its creation is the first entry of its history.
export async function createOrder(input: NewOrder, createdBy: string): Promise<Order> {
  const now = new Date();
  const order: Order = {
    id: newId(),
    number: '',
    ...input,
    status: 'active',
    stage: 'quote',
    stageChangedAt: now,
    createdAt: now,
    updatedAt: now,
  };
  const columns = toColumns(order);
  // Two batches created at the same moment can draw the same number: the unique index rejects
  // the second one, which then takes the next number.
  for (let attempt = 0; ; attempt++) {
    order.number = await nextOrderNumber(now);
    try {
      await db().transaction(async (tx) => {
        await tx.insert(orders).values({ id: order.id, number: order.number, ...columns, createdAt: now, updatedAt: now });
        await saveList(tx, EMPLOYEES, order.id, order.assignedEmployees);
        await saveList(tx, DOCUMENTS, order.id, order.documents);
        await recordStageEvent(tx, { orderId: order.id, toStage: order.stage, userId: createdBy, createdAt: now });
      });
      return order;
    } catch (err) {
      if (!isDuplicateKeyError(err) || attempt >= 4) throw err;
    }
  }
}

export async function saveOrder(order: Order): Promise<void> {
  order.updatedAt = new Date();
  const columns = toColumns(order);
  await db().transaction(async (tx) => {
    await tx.update(orders).set({ ...columns, updatedAt: order.updatedAt }).where(eq(orders.id, order.id));
    await saveList(tx, EMPLOYEES, order.id, order.assignedEmployees);
    await saveList(tx, DOCUMENTS, order.id, order.documents);
  });
}

// Moves a batch to another stage and records the change in its history.
export async function changeOrderStage(order: Order, toStage: Stage, userId: string, note?: string): Promise<void> {
  const now = new Date();
  const fromStage = order.stage;
  order.stage = toStage;
  order.status = statusOfStage(toStage);
  order.stageChangedAt = now;
  order.updatedAt = now;
  await db().transaction(async (tx) => {
    await tx
      .update(orders)
      .set({ stage: order.stage, status: order.status, stageChangedAt: now, updatedAt: now })
      .where(eq(orders.id, order.id));
    await recordStageEvent(tx, { orderId: order.id, fromStage, toStage, userId, note, createdAt: now });
  });
}

async function deleteOrderRows(ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  await db().transaction(async (tx) => {
    await deleteLists(tx, EMPLOYEES, ids);
    await deleteLists(tx, DOCUMENTS, ids);
    await deleteStageEvents(tx, ids);
    await tx.delete(orders).where(inArray(orders.id, ids));
  });
}

export async function deleteOrder(id: string): Promise<void> {
  await deleteOrderRows([id]);
}

export async function deleteClientOrders(clientId: string): Promise<void> {
  const ids = (await db().select({ id: orders.id }).from(orders).where(eq(orders.clientId, clientId))).map((r) => r.id);
  await deleteOrderRows(ids);
}

// The order as stored, with manager/employees resolved (as returned by create and update).
export function orderJson(o: Order, people: { manager?: object | null; assignedEmployees: object[] }) {
  return {
    _id: o.id,
    number: o.number,
    client: o.clientId,
    product: o.productId,
    quantity: o.quantity,
    description: o.description,
    status: o.status,
    stage: o.stage,
    stageChangedAt: o.stageChangedAt,
    dueDate: o.dueDate,
    quoteAmount: o.quoteAmount,
    quoteCurrency: o.quoteCurrency,
    exchangeRate: o.exchangeRate,
    priceUah: o.priceUah,
    manager: o.managerId === undefined ? undefined : (people.manager ?? null),
    assignedEmployees: people.assignedEmployees,
    documents: o.documents,
    createdAt: o.createdAt,
    updatedAt: o.updatedAt,
    id: o.id,
  };
}
