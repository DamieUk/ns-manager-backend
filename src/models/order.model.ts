import { and, asc, desc, eq, inArray, SQL } from 'drizzle-orm';
import { db } from '../db';
import { orders, orderDocuments, orderEmployees } from '../db/schema';
import { newId } from '../db/ids';
import { deleteLists, ListTable, loadLists, saveList } from '../db/lists';
import { encryptField, decryptField } from '../utils/fieldEncryption';
import { castId, castNumber, Validator } from '../utils/validate';

export const ORDER_STATUSES = ['active', 'completed', 'cancelled'] as const;
export type OrderStatus = (typeof ORDER_STATUSES)[number];

export interface Order {
  id: string;
  clientId: string;
  productId: string;
  quantity: number;
  description: string;
  status: OrderStatus;
  dueDate?: Date;
  managerId?: string;
  assignedEmployees: string[];
  documents: string[];
  createdAt: Date;
  updatedAt: Date;
}

export type NewOrder = Omit<Order, 'id' | 'status' | 'createdAt' | 'updatedAt'> & { status?: OrderStatus };

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
    clientId: row.clientId,
    productId: row.productId,
    quantity: row.quantity,
    description: decryptField(row.description) ?? '',
    status: row.status as OrderStatus,
    dueDate: row.dueDate ?? undefined,
    managerId: row.managerId ?? undefined,
    assignedEmployees: employees.get(row.id) ?? [],
    documents: docs.get(row.id) ?? [],
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }));
}

function toColumns(o: Omit<Order, 'id' | 'createdAt' | 'updatedAt'>) {
  o.quantity = castNumber(o.quantity, 'quantity') as number;
  o.managerId = o.managerId === undefined || o.managerId === null ? undefined : castId(o.managerId, 'manager');
  o.assignedEmployees = (o.assignedEmployees ?? []).map((id) => castId(id, 'assignedEmployees'));
  o.documents = (o.documents ?? []).map((id) => castId(id, 'documents'));
  new Validator()
    .required(o.clientId, 'client')
    .required(o.productId, 'product')
    .required(o.quantity, 'quantity')
    .min(o.quantity, 1, 'quantity')
    .required(o.description, 'description')
    .oneOf(o.status, ORDER_STATUSES, 'status')
    .check();
  return {
    clientId: o.clientId,
    productId: o.productId,
    quantity: o.quantity,
    description: encryptField(o.description)!,
    status: o.status,
    dueDate: o.dueDate ?? null,
    managerId: o.managerId ?? null,
  };
}

const assignedTo = (userId: string) =>
  inArray(orders.id, db().select({ id: orderEmployees.orderId }).from(orderEmployees).where(eq(orderEmployees.userId, userId)));

export async function listOrders(filter: { status?: unknown; clientId?: unknown; employeeId?: string } = {}): Promise<Order[]> {
  const conditions: SQL[] = [];
  if (filter.status) conditions.push(eq(orders.status, String(filter.status)));
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

export async function listActiveOrders(): Promise<Order[]> {
  return withLists(await db().select().from(orders).where(eq(orders.status, 'active')).orderBy(asc(orders.createdAt), asc(orders.id)));
}

export async function findOrderById(id: unknown): Promise<Order | null> {
  const [row] = await db().select().from(orders).where(eq(orders.id, castId(id)));
  return row ? (await withLists([row]))[0] : null;
}

// Just the client/product links of the given orders (for progress-report responses).
export async function findOrderLinks(ids: string[]): Promise<Array<Pick<Order, 'id' | 'clientId' | 'productId'>>> {
  if (ids.length === 0) return [];
  return db().select({ id: orders.id, clientId: orders.clientId, productId: orders.productId }).from(orders).where(inArray(orders.id, ids));
}

export async function createOrder(input: NewOrder): Promise<Order> {
  const now = new Date();
  const order: Order = { id: newId(), ...input, status: input.status ?? 'active', createdAt: now, updatedAt: now };
  const columns = toColumns(order);
  await db().transaction(async (tx) => {
    await tx.insert(orders).values({ id: order.id, ...columns, createdAt: now, updatedAt: now });
    await saveList(tx, EMPLOYEES, order.id, order.assignedEmployees);
    await saveList(tx, DOCUMENTS, order.id, order.documents);
  });
  return order;
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

async function deleteOrderRows(ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  await db().transaction(async (tx) => {
    await deleteLists(tx, EMPLOYEES, ids);
    await deleteLists(tx, DOCUMENTS, ids);
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
    client: o.clientId,
    product: o.productId,
    quantity: o.quantity,
    description: o.description,
    status: o.status,
    dueDate: o.dueDate,
    manager: o.managerId === undefined ? undefined : (people.manager ?? null),
    assignedEmployees: people.assignedEmployees,
    documents: o.documents,
    createdAt: o.createdAt,
    updatedAt: o.updatedAt,
    id: o.id,
  };
}
