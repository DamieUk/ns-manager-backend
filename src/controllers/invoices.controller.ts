import { Request, Response } from 'express';
import {
  createInvoice,
  deleteInvoice,
  findInvoiceById,
  Invoice,
  INVOICE_KINDS,
  InvoiceKind,
  invoiceJson,
  invoiceTotal,
  invoiceTotals,
  listInvoices,
  saveInvoice,
} from '../models/invoice.model';
import { batchTotal, findOrderById, Order, roundMoney } from '../models/order.model';
import { stageIndex } from '../models/orderStage.model';
import { getCompany, vatRateOf } from '../models/company.model';
import { HttpError } from '../utils/HttpError';
import { castId, castNumber } from '../utils/validate';
import { normalizeToUTCMidnight } from '../utils/normalizeDate';
import { loadOrderLinks } from './orderLinks';
import { findClientById } from '../models/client.model';
import { findProductsByIds } from '../models/product.model';
import { isSigned, listContracts, paperStatus } from '../models/contract.model';
import { buildInvoicePdf } from '../documents/invoicePdf';
import { assertRequisites } from '../documents/parties';
import { sendPdf } from '../utils/sendPdf';

// A date field from a request: undefined when absent, null when cleared.
function dayField(value: unknown): Date | null | undefined {
  if (value === undefined) return undefined;
  if (value === null || value === '') return null;
  return normalizeToUTCMidnight(value);
}

function amountField(value: unknown, path: string): number {
  const n = castNumber(value === '' ? null : value, path);
  if (n === null || n === undefined || n <= 0) throw new HttpError(400, 'Сума має бути більшою за нуль');
  return roundMoney(n);
}

const uah = (n: number) => `${n.toLocaleString('uk-UA', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} грн`;

async function findInvoice(id: unknown): Promise<Invoice> {
  const invoice = await findInvoiceById(castId(id));
  if (!invoice) throw new HttpError(404, 'Invoice not found');
  return invoice;
}

// The batch's invoices (other than `except`) together with `amount` must stay within the batch
// price; both are without VAT.
async function assertWithinPrice(order: Order, amount: number, except?: string): Promise<void> {
  const others = (await listInvoices({ orderIds: [order.id] })).filter((i) => i.id !== except);
  const { invoiced } = invoiceTotals(others);
  const left = roundMoney((batchTotal(order) ?? 0) - invoiced);
  if (amount > left + 0.001) throw new HttpError(400, `Рахунки перевищать ціну партії: залишилось виставити ${uah(Math.max(left, 0))} без ПДВ`);
}

// ?status=open (awaiting payment), paid, cancelled; all invoices without it.
export async function list(req: Request, res: Response): Promise<void> {
  const status = req.query.status === 'open' ? 'issued' : req.query.status;
  if (status !== undefined && status !== 'issued' && status !== 'paid' && status !== 'cancelled') throw new HttpError(400, 'Invalid status');
  const invoices = await listInvoices({ status });
  const links = await loadOrderLinks(invoices.map((i) => i.orderId));
  res.json(
    invoices
      .filter((i) => links.has(i.orderId))
      .reverse()
      .map((i) => {
        const link = links.get(i.orderId)!;
        return { ...invoiceJson(i), order: { id: link.id, number: link.number, product: link.product }, client: link.client };
      })
  );
}

// Invoices are issued from the invoicing stage on, once the annex is signed and the UAH price
// fixed. `amount` is without VAT. The first one is the prepayment unless it covers the whole price.
export async function create(req: Request, res: Response): Promise<void> {
  const { order: orderId, kind, description, amount, issuedAt, dueAt, note } = req.body as Record<string, unknown>;
  const order = orderId ? await findOrderById(orderId) : null;
  if (!order) throw new HttpError(400, 'order does not exist');
  if (order.stage === 'cancelled' || stageIndex(order.stage) < stageIndex('invoicing')) {
    throw new HttpError(409, 'Рахунок виставляють з етапу «Оплата»: після підписання додатку');
  }
  const total = batchTotal(order);
  if (!total) throw new HttpError(409, 'Спершу зафіксуйте ціну за плату в гривнях');

  const value = amountField(amount, 'amount');
  await assertWithinPrice(order, value);
  if (kind !== undefined && !INVOICE_KINDS.includes(kind as InvoiceKind)) throw new HttpError(400, 'Invalid kind');
  const existing = (await listInvoices({ orderIds: [order.id] })).filter((i) => i.status !== 'cancelled');
  const defaultKind: InvoiceKind = existing.length > 0 ? 'balance' : value >= total ? 'full' : 'prepayment';

  const invoice = await createInvoice({
    orderId: order.id,
    clientId: order.clientId,
    kind: (kind as InvoiceKind | undefined) ?? defaultKind,
    description: typeof description === 'string' ? description : undefined,
    amount: value,
    vatRate: vatRateOf(await getCompany()),
    issuedAt: dayField(issuedAt) ?? normalizeToUTCMidnight(new Date()),
    dueAt: dayField(dueAt) ?? undefined,
    note: typeof note === 'string' ? note : undefined,
    createdBy: req.user!.id,
  });
  res.status(201).json(invoiceJson(invoice));
}

// Edits an unpaid invoice, cancels it (status: 'cancelled') or restores it (status: 'issued').
export async function update(req: Request, res: Response): Promise<void> {
  const invoice = await findInvoice(req.params.id);
  const { kind, description, amount, issuedAt, dueAt, note, status } = req.body as Record<string, unknown>;
  const order = await findOrderById(invoice.orderId);
  if (!order) throw new HttpError(404, 'Invoice not found');

  const hasPayment = invoice.paidAmount !== undefined;
  if ((kind !== undefined || amount !== undefined || issuedAt !== undefined) && hasPayment) {
    throw new HttpError(409, 'Оплачений рахунок не змінюють: спершу скасуйте оплату');
  }
  if (kind !== undefined) {
    if (!INVOICE_KINDS.includes(kind as InvoiceKind)) throw new HttpError(400, 'Invalid kind');
    invoice.kind = kind as InvoiceKind;
  }
  if (amount !== undefined) invoice.amount = amountField(amount, 'amount');
  const issued = dayField(issuedAt);
  if (issued) invoice.issuedAt = issued;
  const due = dayField(dueAt);
  if (due !== undefined) invoice.dueAt = due ?? undefined;
  if (note !== undefined) invoice.note = typeof note === 'string' ? note : undefined;
  if (description !== undefined) {
    if (hasPayment) throw new HttpError(409, 'Оплачений рахунок не змінюють: спершу скасуйте оплату');
    invoice.description = typeof description === 'string' ? description : undefined;
  }

  if (status !== undefined) {
    if (status === 'cancelled') {
      if (hasPayment) throw new HttpError(409, 'Рахунок з оплатою не скасовують: спершу скасуйте оплату');
      invoice.status = 'cancelled';
    } else if (status === 'issued') {
      if (invoice.status === 'cancelled') invoice.status = 'issued';
    } else {
      throw new HttpError(400, 'Invalid status');
    }
  }
  if (invoice.status !== 'cancelled') await assertWithinPrice(order, invoice.amount, invoice.id);

  await saveInvoice(invoice);
  res.json(invoiceJson(invoice));
}

// Records the payment received ({ paidAmount, paidAt }, VAT included); paidAmount: null clears it.
// The invoice counts as paid once its whole total has come in.
export async function recordPayment(req: Request, res: Response): Promise<void> {
  const invoice = await findInvoice(req.params.id);
  if (invoice.status === 'cancelled') throw new HttpError(409, 'Рахунок скасовано');
  const { paidAmount, paidAt } = req.body as Record<string, unknown>;

  if (paidAmount === null || paidAmount === '') {
    invoice.paidAmount = undefined;
    invoice.paidAt = undefined;
    invoice.status = 'issued';
  } else {
    invoice.paidAmount = amountField(paidAmount, 'paidAmount');
    invoice.paidAt = dayField(paidAt) ?? normalizeToUTCMidnight(new Date());
    invoice.status = invoice.paidAmount >= invoiceTotal(invoice) - 0.001 ? 'paid' : 'issued';
  }

  await saveInvoice(invoice);
  res.json(invoiceJson(invoice));
}

export async function remove(req: Request, res: Response): Promise<void> {
  const invoice = await findInvoice(req.params.id);
  if (invoice.paidAmount !== undefined) throw new HttpError(409, 'Рахунок з оплатою не видаляють');
  await deleteInvoice(invoice.id);
  res.status(204).send();
}

// The invoice as a PDF in our document layout, with the annex and framework contract it is based on.
export async function pdf(req: Request, res: Response): Promise<void> {
  const invoice = await findInvoice(req.params.id);
  const order = await findOrderById(invoice.orderId);
  const client = order ? await findClientById(order.clientId) : null;
  if (!order || !client) throw new HttpError(404, 'Invoice not found');
  const [company, [product], contracts] = await Promise.all([getCompany(), findProductsByIds([order.productId]), listContracts({ clientId: client.id })]);
  assertRequisites(company, client);

  const annex = contracts
    .filter((c) => c.type === 'annex' && c.orderId === order.id && isSigned(c))
    .sort((a, b) => b.signedAt!.getTime() - a.signedAt!.getTime())[0];
  const pdfBuffer = await buildInvoicePdf({
    invoice,
    order,
    productName: product?.name ?? '',
    client,
    company,
    annex: annex ? { contractId: annex.id, number: annex.number ?? null, signedAt: annex.signedAt ?? null } : null,
    framework: paperStatus(contracts).framework,
  });
  sendPdf(res, pdfBuffer, `Рахунок ${invoice.number}.pdf`);
}
