import { Request, Response } from 'express';
import {
  createOrder,
  deleteOrder,
  findOrderById,
  listEmployeeOrders,
  listOrders,
  Order,
  orderJson,
  ORDER_STATUSES,
  saveOrder,
} from '../models/order.model';
import { Client, clientExists, findClientsByIds } from '../models/client.model';
import { findProductsByIds, productExists } from '../models/product.model';
import { countClientDocuments, findDocumentsByIds, resolveDocs } from '../models/document.model';
import { findUserById, findUsersByIds, User, userRefJson } from '../models/user.model';
import { listEntries } from '../models/dailyProgress.model';
import { HttpError } from '../utils/HttpError';
import { byId, castId, castIds } from '../utils/validate';
import { normalizeToUTCMidnight } from '../utils/normalizeDate';

const MANAGER_ROLES = ['executive', 'manager'];

async function assertDocumentsBelongToClient(documentIds: string[], client: string): Promise<void> {
  if (documentIds.length === 0) return;
  const validCount = await countClientDocuments(documentIds, client);
  if (validCount !== documentIds.length) throw new HttpError(400, 'One or more documents are invalid for this client');
}

async function assertValidManager(managerId: string): Promise<void> {
  const manager = await findUserById(managerId);
  if (!manager || !MANAGER_ROLES.includes(manager.role)) throw new HttpError(400, 'manager must be a manager or executive');
}

async function assertValidEmployees(employeeIds: string[]): Promise<void> {
  if (employeeIds.length === 0) return;
  const valid = await findUsersByIds(castIds(employeeIds, '_id'), { role: 'employee' });
  if (valid.length !== employeeIds.length) throw new HttpError(400, 'One or more assignedEmployees are invalid');
}

// Loads what an order response shows besides the order itself: client and product names,
// manager and employees. Records deleted since are missing from the maps.
export async function loadOrderRefs(orders: Order[]) {
  const unique = (ids: string[]) => [...new Set(ids)];
  const [clients, products, users] = await Promise.all([
    findClientsByIds(unique(orders.map((o) => o.clientId))),
    findProductsByIds(unique(orders.map((o) => o.productId))),
    findUsersByIds(unique(orders.flatMap((o) => [...(o.managerId ? [o.managerId] : []), ...o.assignedEmployees]))),
  ]);
  return { clients: byId<Client>(clients), products: byId(products), users: byId<User>(users) };
}

type OrderRefs = Awaited<ReturnType<typeof loadOrderRefs>>;

const personJson = (u: User) => ({ id: u.id, name: `${u.firstName} ${u.lastName}` });

function assignment(order: Order, refs: OrderRefs) {
  const manager = order.managerId ? refs.users.get(order.managerId) : undefined;
  const assignedEmployees = order.assignedEmployees.map((id) => refs.users.get(id)).filter((u): u is User => Boolean(u));
  return { manager, assignedEmployees };
}

function storedOrderJson(order: Order, refs: OrderRefs) {
  const { manager, assignedEmployees } = assignment(order, refs);
  return orderJson(order, { manager: manager ? userRefJson(manager) : null, assignedEmployees: assignedEmployees.map(userRefJson) });
}

export async function list(req: Request, res: Response): Promise<void> {
  const orders = await listOrders({
    status: req.query.status,
    clientId: req.query.client,
    employeeId: req.user!.role === 'employee' ? req.user!.id : undefined,
  });
  const refs = await loadOrderRefs(orders);

  res.json(orders.filter((o) => refs.clients.has(o.clientId) && refs.products.has(o.productId)).map((o) => toOrderResponse(o, refs)));
}

export async function getById(req: Request, res: Response): Promise<void> {
  const order = await findOrderById(req.params.id);
  const refs = order ? await loadOrderRefs([order]) : undefined;
  if (!order || !refs!.clients.has(order.clientId) || !refs!.products.has(order.productId)) throw new HttpError(404, 'Order not found');

  if (req.user!.role === 'employee' && !order.assignedEmployees.includes(req.user!.id)) {
    throw new HttpError(403, 'You are not assigned to this order');
  }

  const docs = byId(await findDocumentsByIds(order.documents));
  res.json({
    ...toOrderResponse(order, refs!),
    documents: resolveDocs(order.documents, docs).map((doc) => ({
      _id: doc.id,
      originalName: doc.originalName,
      mimeType: doc.mimeType,
      size: doc.size,
      createdAt: doc.createdAt,
    })),
  });
}

export async function listMine(req: Request, res: Response): Promise<void> {
  const orders = await listEmployeeOrders(req.user!.id);
  const refs = await loadOrderRefs(orders);

  const entries = await listEntries({ orderIds: orders.map((o) => o.id) });
  const completedByOrder = new Map<string, number>();
  for (const entry of entries) {
    completedByOrder.set(entry.orderId, (completedByOrder.get(entry.orderId) ?? 0) + entry.completed);
  }

  const now = new Date();
  const response = orders
    .filter((order) => refs.clients.has(order.clientId) && refs.products.has(order.productId))
    .map((order) => {
      const client = refs.clients.get(order.clientId)!;
      const product = refs.products.get(order.productId)!;
      const completed = completedByOrder.get(order.id) ?? 0;
      const remaining = Math.max(order.quantity - completed, 0);
      return {
        id: order.id,
        client: { id: client.id, name: client.name },
        product: { id: product.id, name: product.name },
        quantity: order.quantity,
        status: order.status,
        dueDate: order.dueDate ?? null,
        completed,
        remaining,
        isOverdue: Boolean(order.dueDate) && order.dueDate! < now && order.status === 'active',
      };
    });

  res.json(response);
}

export async function create(req: Request, res: Response): Promise<void> {
  const { client, product, quantity, description, status, dueDate, manager, assignedEmployees, documents } =
    req.body as {
      client?: string;
      product?: string;
      quantity?: number;
      description?: string;
      status?: string;
      dueDate?: string | null;
      manager?: string | null;
      assignedEmployees?: string[];
      documents?: string[];
    };

  if (!client) throw new HttpError(400, 'client is required');
  if (!product) throw new HttpError(400, 'product is required');
  if (!quantity || quantity < 1) throw new HttpError(400, 'quantity must be a positive number');
  if (!description || !description.trim()) throw new HttpError(400, 'description is required');

  const [clientFound, productFound] = await Promise.all([clientExists(client), productExists(product)]);
  if (!clientFound) throw new HttpError(400, 'client does not exist');
  if (!productFound) throw new HttpError(400, 'product does not exist');

  if (status && !ORDER_STATUSES.includes(status as (typeof ORDER_STATUSES)[number])) {
    throw new HttpError(400, 'Invalid status');
  }

  const clientId = castId(client);
  if (manager) await assertValidManager(manager);
  await assertValidEmployees(assignedEmployees ?? []);
  await assertDocumentsBelongToClient(documents ?? [], clientId);

  const order = await createOrder({
    clientId,
    productId: castId(product),
    quantity,
    description,
    status: status as (typeof ORDER_STATUSES)[number] | undefined,
    dueDate: dueDate ? normalizeToUTCMidnight(dueDate) : undefined,
    managerId: manager || undefined,
    assignedEmployees: assignedEmployees ?? [],
    documents: documents ?? [],
  });
  res.status(201).json(storedOrderJson(order, await loadOrderRefs([order])));
}

export async function update(req: Request, res: Response): Promise<void> {
  const order = await findOrderById(req.params.id);
  if (!order) throw new HttpError(404, 'Order not found');

  const { client, product, quantity, description, status, dueDate, manager, assignedEmployees, documents } =
    req.body as {
      client?: string;
      product?: string;
      quantity?: number;
      description?: string;
      status?: string;
      dueDate?: string | null;
      manager?: string | null;
      assignedEmployees?: string[];
      documents?: string[];
    };

  if (client !== undefined) {
    if (!(await clientExists(client))) throw new HttpError(400, 'client does not exist');
    order.clientId = castId(client);
  }
  if (product !== undefined) {
    if (!(await productExists(product))) throw new HttpError(400, 'product does not exist');
    order.productId = castId(product);
  }
  if (quantity !== undefined) {
    if (quantity < 1) throw new HttpError(400, 'quantity must be a positive number');
    order.quantity = quantity;
  }
  if (description !== undefined) {
    if (!description.trim()) throw new HttpError(400, 'description is required');
    order.description = description;
  }
  if (status !== undefined) {
    if (!ORDER_STATUSES.includes(status as (typeof ORDER_STATUSES)[number])) throw new HttpError(400, 'Invalid status');
    order.status = status as (typeof ORDER_STATUSES)[number];
  }
  if (dueDate !== undefined) {
    order.dueDate = dueDate ? normalizeToUTCMidnight(dueDate) : undefined;
  }
  if (manager !== undefined) {
    if (manager) await assertValidManager(manager);
    order.managerId = manager || undefined;
  }
  if (assignedEmployees !== undefined) {
    await assertValidEmployees(assignedEmployees);
    order.assignedEmployees = assignedEmployees;
  }
  if (documents !== undefined) {
    await assertDocumentsBelongToClient(documents, order.clientId);
    order.documents = documents;
  }

  await saveOrder(order);
  res.json(storedOrderJson(order, await loadOrderRefs([order])));
}

export async function remove(req: Request, res: Response): Promise<void> {
  const order = await findOrderById(req.params.id);
  if (!order) throw new HttpError(404, 'Order not found');

  await deleteOrder(order.id);
  res.status(204).send();
}

function toOrderResponse(order: Order, refs: OrderRefs) {
  const client = refs.clients.get(order.clientId)!;
  const product = refs.products.get(order.productId)!;
  const { manager, assignedEmployees } = assignment(order, refs);
  return {
    id: order.id,
    client: { id: client.id, name: client.name },
    product: { id: product.id, name: product.name },
    quantity: order.quantity,
    description: order.description,
    status: order.status,
    dueDate: order.dueDate ?? null,
    manager: manager ? personJson(manager) : null,
    assignedEmployees: assignedEmployees.map(personJson),
  };
}
