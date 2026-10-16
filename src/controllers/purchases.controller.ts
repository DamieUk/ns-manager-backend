import { Request, Response } from 'express';
import {
  COMMITTED_STATUSES,
  createPurchase,
  deletePurchase,
  findPurchaseById,
  listPurchases,
  Purchase,
  PurchaseCategory,
  purchaseJson,
  PurchaseStatus,
  savePurchase,
} from '../models/purchase.model';
import { findOrderById, Order } from '../models/order.model';
import { Currency } from '../models/orderStage.model';
import { isPrepaid, listInvoices } from '../models/invoice.model';
import { HttpError } from '../utils/HttpError';
import { castDate, castId, castNumber } from '../utils/validate';
import { loadOrderLinks } from './orderLinks';

const FIELDS = ['category', 'supplier', 'description', 'supplierOrderNo', 'trackingNumber', 'cost', 'currency', 'status', 'expectedAt'] as const;

const blank = (v: unknown) => v === null || v === '';

function applyFields(p: Purchase, body: Record<string, unknown>): void {
  for (const key of FIELDS) {
    const value = body[key];
    if (value === undefined) continue;
    if (key === 'cost') p.cost = blank(value) ? undefined : (castNumber(value, 'cost') ?? undefined);
    else if (key === 'expectedAt') p.expectedAt = castDate(value, 'expectedAt') ?? undefined;
    else if (key === 'currency') p.currency = blank(value) ? undefined : (value as Currency);
    else if (key === 'category') p.category = value as PurchaseCategory;
    else if (key === 'status') p.status = value as PurchaseStatus;
    else if (key === 'supplier') p.supplier = blank(value) ? '' : String(value);
    else p[key] = blank(value) ? undefined : String(value);
  }
}

// Money goes to a supplier only for a prepaid batch: until then purchases can just be planned.
async function assertPrepaidFor(order: Order, status: PurchaseStatus): Promise<void> {
  if (!COMMITTED_STATUSES.includes(status)) return;
  if (!isPrepaid(await listInvoices({ orderIds: [order.id] }))) {
    throw new HttpError(409, 'Чекаємо передоплату: замовляти можна після оплати рахунку');
  }
}

async function findPurchase(id: unknown): Promise<Purchase> {
  const purchase = await findPurchaseById(castId(id));
  if (!purchase) throw new HttpError(404, 'Purchase not found');
  return purchase;
}

// ?open=1: only what hasn't arrived yet (for the procurement overview).
export async function list(req: Request, res: Response): Promise<void> {
  const purchases = await listPurchases({ open: req.query.open === '1' || req.query.open === 'true' });
  const links = await loadOrderLinks(purchases.map((p) => p.orderId));
  res.json(
    purchases
      .filter((p) => links.has(p.orderId))
      .map((p) => {
        const link = links.get(p.orderId)!;
        return { ...purchaseJson(p), order: { id: link.id, number: link.number, product: link.product }, client: link.client };
      })
  );
}

export async function create(req: Request, res: Response): Promise<void> {
  const body = req.body as Record<string, unknown>;
  const order = body.order ? await findOrderById(body.order) : null;
  if (!order) throw new HttpError(400, 'order does not exist');
  if (order.stage === 'cancelled') throw new HttpError(409, 'Партію скасовано');

  const purchase = { orderId: order.id, category: 'components', supplier: '', status: 'planned' } as Purchase;
  applyFields(purchase, body);
  await assertPrepaidFor(order, purchase.status);
  res.status(201).json(purchaseJson(await createPurchase(purchase)));
}

export async function update(req: Request, res: Response): Promise<void> {
  const purchase = await findPurchase(req.params.id);
  const order = await findOrderById(purchase.orderId);
  if (!order) throw new HttpError(404, 'Purchase not found');

  const wasCommitted = COMMITTED_STATUSES.includes(purchase.status);
  applyFields(purchase, req.body as Record<string, unknown>);
  if (!wasCommitted) await assertPrepaidFor(order, purchase.status);

  await savePurchase(purchase);
  res.json(purchaseJson(purchase));
}

export async function remove(req: Request, res: Response): Promise<void> {
  const purchase = await findPurchase(req.params.id);
  await deletePurchase(purchase.id);
  res.status(204).send();
}
