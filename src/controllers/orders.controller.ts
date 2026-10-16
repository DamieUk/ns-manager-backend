import { Request, Response } from 'express';
import {
  changeOrderStage,
  createOrder,
  deleteOrder,
  findOrderById,
  listEmployeeOrders,
  listOrders,
  Order,
  batchTotal,
  orderJson,
  roundMoney,
  saveOrder,
} from '../models/order.model';
import { CURRENCIES, Currency, isStage, listStageEvents, nextStage } from '../models/orderStage.model';
import { GateContext, isPriceLocked, loadGateContexts, nextStageBlockers, stageBlockers } from '../models/batchGates';
import { Client, clientExists, findClientsByIds } from '../models/client.model';
import { findProductsByIds, productExists } from '../models/product.model';
import { contractJson, listOrderAnnexes } from '../models/contract.model';
import { countClientDocuments, documentJson, findDocumentsByIds, resolveDocs } from '../models/document.model';
import { findUserById, findUsersByIds, User, userRefJson } from '../models/user.model';
import { listEntries } from '../models/dailyProgress.model';
import { invoiceJson, invoiceTotals, listInvoices } from '../models/invoice.model';
import { listPurchases, purchaseJson } from '../models/purchase.model';
import { getCompany, vatRateOf } from '../models/company.model';
import { HttpError } from '../utils/HttpError';
import { byId, castId, castIds, castNumber } from '../utils/validate';
import { normalizeToUTCMidnight } from '../utils/normalizeDate';

async function assertDocumentsBelongToClient(documentIds: string[], client: string): Promise<void> {
  if (documentIds.length === 0) return;
  const validCount = await countClientDocuments(documentIds, client);
  if (validCount !== documentIds.length) throw new HttpError(400, 'One or more documents are invalid for this client');
}

// `manager` is the order's responsible owner («Відповідальний») — always an executive.
async function assertValidManager(managerId: string): Promise<void> {
  const manager = await findUserById(managerId);
  if (!manager || manager.role !== 'executive') throw new HttpError(400, 'manager must be an executive');
}

async function assertValidEmployees(employeeIds: string[]): Promise<void> {
  if (employeeIds.length === 0) return;
  const valid = await findUsersByIds(castIds(employeeIds, '_id'), { role: 'employee' });
  if (valid.length !== employeeIds.length) throw new HttpError(400, 'One or more assignedEmployees are invalid');
}

const PRICE_FIELDS = ['unitQuote', 'quoteCurrency', 'exchangeRate', 'unitPrice'] as const;
type PriceInput = Partial<Record<(typeof PRICE_FIELDS)[number], unknown>>;

const blankToUndefined = (value: unknown) => (value === null || value === '' ? undefined : value);

// Applies the quote and the agreed UAH price (both per board, without VAT) from a request body.
// A UAH quote needs no rate; otherwise the UAH price follows quote × rate unless it is given
// explicitly. Only owners set prices, and once the batch is invoiced its price is locked.
function applyPrice(order: Order, body: PriceInput, user: Express.Request['user']): void {
  if (!PRICE_FIELDS.some((k) => body[k] !== undefined)) return;
  if (user!.role !== 'executive') throw new HttpError(403, 'Ціну партії встановлює лише власник');

  const before = PRICE_FIELDS.map((k) => order[k]);
  const quote = body.unitQuote !== undefined ? castNumber(blankToUndefined(body.unitQuote), 'unitQuote') ?? undefined : order.unitQuote;
  const currency = body.quoteCurrency !== undefined ? (blankToUndefined(body.quoteCurrency) as Currency | undefined) : order.quoteCurrency;
  if (currency !== undefined && !CURRENCIES.includes(currency)) throw new HttpError(400, 'Invalid quoteCurrency');
  let rate = body.exchangeRate !== undefined ? castNumber(blankToUndefined(body.exchangeRate), 'exchangeRate') ?? undefined : order.exchangeRate;
  if (currency === 'UAH') rate = 1;
  let unitPrice = body.unitPrice !== undefined ? castNumber(blankToUndefined(body.unitPrice), 'unitPrice') ?? undefined : order.unitPrice;
  if (body.unitPrice === undefined && quote !== undefined && rate !== undefined && (quote !== order.unitQuote || rate !== order.exchangeRate)) {
    unitPrice = roundMoney(quote * rate);
  }

  Object.assign(order, { unitQuote: quote, quoteCurrency: currency, exchangeRate: rate, unitPrice });
  const changed = PRICE_FIELDS.some((k, i) => order[k] !== before[i]);
  if (changed && isPriceLocked(order)) {
    throw new HttpError(409, 'Ціна партії зафіксована: щоб змінити її, поверніть партію на етап «Погодження»');
  }
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

const isOverdue = (order: Order) => Boolean(order.dueDate) && order.dueDate! < new Date() && order.status === 'active';

// Prices, papers and gate blockers are shown to owners only.
function toOrderResponse(order: Order, refs: OrderRefs, gate?: GateContext) {
  const client = refs.clients.get(order.clientId)!;
  const product = refs.products.get(order.productId)!;
  const { manager, assignedEmployees } = assignment(order, refs);
  return {
    id: order.id,
    number: order.number,
    client: { id: client.id, name: client.name },
    product: { id: product.id, name: product.name },
    quantity: order.quantity,
    description: order.description,
    status: order.status,
    stage: order.stage,
    stageChangedAt: order.stageChangedAt,
    dueDate: order.dueDate ?? null,
    isOverdue: isOverdue(order),
    manager: manager ? personJson(manager) : null,
    assignedEmployees: assignedEmployees.map(personJson),
    createdAt: order.createdAt,
    ...(gate && {
      unitQuote: order.unitQuote ?? null,
      quoteCurrency: order.quoteCurrency ?? null,
      exchangeRate: order.exchangeRate ?? null,
      unitPrice: order.unitPrice ?? null,
      total: batchTotal(order) ?? null,
      priceLocked: isPriceLocked(order),
      nextStage: nextStage(order.stage) ?? null,
      blockers: nextStageBlockers(order, gate),
    }),
  };
}

const visible = (refs: OrderRefs) => (o: Order) => refs.clients.has(o.clientId) && refs.products.has(o.productId);

export async function list(req: Request, res: Response): Promise<void> {
  const isOwner = req.user!.role === 'executive';
  const orders = await listOrders({
    status: req.query.status,
    stage: req.query.stage,
    clientId: req.query.client,
    employeeId: isOwner ? undefined : req.user!.id,
  });
  const [refs, gates] = await Promise.all([loadOrderRefs(orders), isOwner ? loadGateContexts(orders) : undefined]);

  res.json(orders.filter(visible(refs)).map((o) => toOrderResponse(o, refs, gates?.get(o.id))));
}

export async function getById(req: Request, res: Response): Promise<void> {
  const order = await findOrderById(req.params.id);
  const refs = order ? await loadOrderRefs([order]) : undefined;
  if (!order || !visible(refs!)(order)) throw new HttpError(404, 'Order not found');

  const isOwner = req.user!.role === 'executive';
  if (!isOwner && !order.assignedEmployees.includes(req.user!.id)) {
    throw new HttpError(403, 'You are not assigned to this order');
  }

  const [docs, events, entries, annexes, invoices, purchases, gates, company] = await Promise.all([
    findDocumentsByIds(order.documents),
    listStageEvents(order.id),
    listEntries({ orderId: order.id }),
    isOwner ? listOrderAnnexes(order.id) : Promise.resolve([]),
    isOwner ? listInvoices({ orderIds: [order.id] }) : Promise.resolve([]),
    isOwner ? listPurchases({ orderIds: [order.id] }) : Promise.resolve([]),
    isOwner ? loadGateContexts([order]) : undefined,
    getCompany(),
  ]);
  const annexDocs = byId(await findDocumentsByIds([...new Set(annexes.flatMap((a) => a.documents))]));
  const eventUsers = byId(await findUsersByIds([...new Set(events.flatMap((e) => (e.userId ? [e.userId] : [])))]));

  const progress = entries.reduce(
    (acc, e) => ({
      completed: acc.completed + e.completed,
      needsRework: acc.needsRework + e.needsRework,
      partiallyAssembled: acc.partiallyAssembled + e.partiallyAssembled,
    }),
    { completed: 0, needsRework: 0, partiallyAssembled: 0 }
  );

  res.json({
    ...toOrderResponse(order, refs!, gates?.get(order.id)),
    documents: resolveDocs(order.documents, byId(docs)).map((doc) => ({
      _id: doc.id,
      originalName: doc.originalName,
      mimeType: doc.mimeType,
      size: doc.size,
      type: doc.type,
      createdAt: doc.createdAt,
    })),
    progress: { ...progress, remaining: Math.max(order.quantity - progress.completed, 0) },
    history: events.map((e) => {
      const user = e.userId ? eventUsers.get(e.userId) : undefined;
      return {
        id: e.id,
        fromStage: e.fromStage ?? null,
        toStage: e.toStage,
        user: user ? personJson(user) : null,
        note: e.note ?? null,
        createdAt: e.createdAt,
      };
    }),
    ...(isOwner && {
      annexes: annexes.map((a) =>
        contractJson(a, { documents: resolveDocs(a.documents, annexDocs).map((d) => documentJson(d, { withId: true })) })
      ),
      invoices: invoices.map(invoiceJson),
      payments: (() => {
        const { invoiced, invoicedWithVat, paid } = invoiceTotals(invoices);
        return {
          invoiced,
          invoicedWithVat,
          paid,
          toInvoice: Math.max(roundMoney((batchTotal(order) ?? 0) - invoiced), 0),
          awaiting: Math.max(roundMoney(invoicedWithVat - paid), 0),
          vatRate: vatRateOf(company),
        };
      })(),
      purchases: purchases.map(purchaseJson),
    }),
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

  const response = orders.filter(visible(refs)).map((order) => {
    const client = refs.clients.get(order.clientId)!;
    const product = refs.products.get(order.productId)!;
    const completed = completedByOrder.get(order.id) ?? 0;
    const remaining = Math.max(order.quantity - completed, 0);
    return {
      id: order.id,
      number: order.number,
      client: { id: client.id, name: client.name },
      product: { id: product.id, name: product.name },
      quantity: order.quantity,
      status: order.status,
      stage: order.stage,
      dueDate: order.dueDate ?? null,
      completed,
      remaining,
      isOverdue: isOverdue(order),
    };
  });

  res.json(response);
}

interface OrderBody extends PriceInput {
  client?: string;
  product?: string;
  quantity?: number;
  description?: string;
  dueDate?: string | null;
  manager?: string | null;
  assignedEmployees?: string[];
  documents?: string[];
}

// New batches start at the quote stage; stages change only through POST /orders/:id/stage.
export async function create(req: Request, res: Response): Promise<void> {
  const body = req.body as OrderBody;
  const { client, product, quantity, description, dueDate, manager, assignedEmployees, documents } = body;

  if (!client) throw new HttpError(400, 'client is required');
  if (!product) throw new HttpError(400, 'product is required');
  if (!quantity || quantity < 1) throw new HttpError(400, 'quantity must be a positive number');
  if (!description || !description.trim()) throw new HttpError(400, 'description is required');

  const [clientFound, productFound] = await Promise.all([clientExists(client), productExists(product)]);
  if (!clientFound) throw new HttpError(400, 'client does not exist');
  if (!productFound) throw new HttpError(400, 'product does not exist');

  const clientId = castId(client);
  if (manager) await assertValidManager(manager);
  await assertValidEmployees(assignedEmployees ?? []);
  await assertDocumentsBelongToClient(documents ?? [], clientId);

  const draft = { stage: 'quote' } as Order;
  applyPrice(draft, body, req.user);

  const order = await createOrder(
    {
      clientId,
      productId: castId(product),
      quantity,
      description,
      dueDate: dueDate ? normalizeToUTCMidnight(dueDate) : undefined,
      managerId: manager || undefined,
      unitQuote: draft.unitQuote,
      quoteCurrency: draft.quoteCurrency,
      exchangeRate: draft.exchangeRate,
      unitPrice: draft.unitPrice,
      assignedEmployees: assignedEmployees ?? [],
      documents: documents ?? [],
    },
    req.user!.id
  );
  res.status(201).json(storedOrderJson(order, await loadOrderRefs([order])));
}

export async function update(req: Request, res: Response): Promise<void> {
  const order = await findOrderById(req.params.id);
  if (!order) throw new HttpError(404, 'Order not found');

  const body = req.body as OrderBody;
  const { client, product, quantity, description, dueDate, manager, assignedEmployees, documents } = body;

  if (client !== undefined) {
    if (!(await clientExists(client))) throw new HttpError(400, 'client does not exist');
    order.clientId = castId(client);
  }
  if (product !== undefined) {
    if (!(await productExists(product))) throw new HttpError(400, 'product does not exist');
    order.productId = castId(product);
  }
  if (quantity !== undefined && quantity !== order.quantity) {
    if (quantity < 1) throw new HttpError(400, 'quantity must be a positive number');
    if (isPriceLocked(order)) throw new HttpError(409, 'Кількість зафіксована додатком: щоб змінити її, поверніть партію на етап «Погодження»');
    order.quantity = quantity;
  }
  if (description !== undefined) {
    if (!description.trim()) throw new HttpError(400, 'description is required');
    order.description = description;
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
  applyPrice(order, body, req.user);

  await saveOrder(order);
  res.json(storedOrderJson(order, await loadOrderRefs([order])));
}

// Moves a batch to another stage (owners only). Forward moves must pass the stage gates; the
// response carries the unmet requirements as `blockers` when they don't.
export async function changeStage(req: Request, res: Response): Promise<void> {
  const order = await findOrderById(req.params.id);
  const refs = order ? await loadOrderRefs([order]) : undefined;
  if (!order || !visible(refs!)(order)) throw new HttpError(404, 'Order not found');

  const { stage, note } = req.body as { stage?: unknown; note?: unknown };
  if (!isStage(stage)) throw new HttpError(400, 'Invalid stage');
  if (stage === order.stage) throw new HttpError(400, 'Партія вже на цьому етапі');
  if (note !== undefined && note !== null && typeof note !== 'string') throw new HttpError(400, 'Invalid note');

  const gates = await loadGateContexts([order]);
  const blockers = stageBlockers(order, gates.get(order.id)!, stage);
  if (blockers.length > 0) throw new HttpError(409, blockers.join('. '), { blockers });

  await changeOrderStage(order, stage, req.user!.id, note ?? undefined);
  res.json(toOrderResponse(order, refs!, gates.get(order.id)));
}

export async function remove(req: Request, res: Response): Promise<void> {
  const order = await findOrderById(req.params.id);
  if (!order) throw new HttpError(404, 'Order not found');
  if ((await listInvoices({ orderIds: [order.id] })).length > 0) {
    throw new HttpError(409, 'Партію з рахунками не видаляють: скасуйте її');
  }

  await deleteOrder(order.id);
  res.status(204).send();
}
