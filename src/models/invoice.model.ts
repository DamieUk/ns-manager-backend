import { and, asc, eq, inArray, like, SQL } from 'drizzle-orm';
import { db } from '../db';
import { invoices } from '../db/schema';
import { newId } from '../db/ids';
import { Executor } from '../db/lists';
import { encryptField, decryptField } from '../utils/fieldEncryption';
import { isDuplicateKeyError } from '../utils/dbErrors';
import { castString, Validator } from '../utils/validate';

// prepayment: the advance that opens procurement; balance: the rest after it; full: the whole price at once.
export const INVOICE_KINDS = ['prepayment', 'balance', 'full'] as const;
export type InvoiceKind = (typeof INVOICE_KINDS)[number];

export const INVOICE_STATUSES = ['issued', 'paid', 'cancelled'] as const;
export type InvoiceStatus = (typeof INVOICE_STATUSES)[number];

export interface Invoice {
  id: string;
  number: string;
  orderId: string;
  clientId: string;
  kind: InvoiceKind;
  amount: number;
  vatRate: number;
  issuedAt: Date;
  dueAt?: Date;
  status: InvoiceStatus;
  paidAmount?: number;
  paidAt?: Date;
  note?: string;
  createdBy: string;
  createdAt: Date;
  updatedAt: Date;
}

export type NewInvoice = Omit<Invoice, 'id' | 'number' | 'status' | 'paidAmount' | 'paidAt' | 'createdAt' | 'updatedAt'>;

type Row = typeof invoices.$inferSelect;

function fromRow(row: Row): Invoice {
  return {
    id: row.id,
    number: row.number,
    orderId: row.orderId,
    clientId: row.clientId,
    kind: row.kind as InvoiceKind,
    amount: row.amount,
    vatRate: row.vatRate,
    issuedAt: row.issuedAt,
    dueAt: row.dueAt ?? undefined,
    status: row.status as InvoiceStatus,
    paidAmount: row.paidAmount ?? undefined,
    paidAt: row.paidAt ?? undefined,
    note: decryptField(row.note),
    createdBy: row.createdBy,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function toColumns(i: Omit<Invoice, 'id' | 'number' | 'createdAt' | 'updatedAt'>) {
  i.note = castString(i.note)?.trim() || undefined;
  new Validator()
    .oneOf(i.kind, INVOICE_KINDS, 'kind')
    .oneOf(i.status, INVOICE_STATUSES, 'status')
    .required(i.amount, 'amount')
    .min(i.amount, 0.01, 'amount')
    .min(i.paidAmount, 0, 'paidAmount')
    .check();
  return {
    orderId: i.orderId,
    clientId: i.clientId,
    kind: i.kind,
    amount: i.amount,
    vatRate: i.vatRate,
    issuedAt: i.issuedAt,
    dueAt: i.dueAt ?? null,
    status: i.status,
    paidAmount: i.paidAmount ?? null,
    paidAt: i.paidAt ?? null,
    note: encryptField(i.note) ?? null,
    createdBy: i.createdBy,
  };
}

export async function listInvoices(filter: { orderIds?: string[]; status?: InvoiceStatus } = {}): Promise<Invoice[]> {
  if (filter.orderIds && filter.orderIds.length === 0) return [];
  const conditions: SQL[] = [];
  if (filter.orderIds) conditions.push(inArray(invoices.orderId, filter.orderIds));
  if (filter.status) conditions.push(eq(invoices.status, filter.status));
  const rows = await db().select().from(invoices).where(and(...conditions)).orderBy(asc(invoices.issuedAt), asc(invoices.createdAt));
  return rows.map(fromRow);
}

export async function findInvoiceById(id: string): Promise<Invoice | null> {
  const [row] = await db().select().from(invoices).where(eq(invoices.id, id));
  return row ? fromRow(row) : null;
}

// Documents are numbered by their date and the sequence within the day: «070926-1», «070926-2»
// for the 7th of September 2026 (as on the paper invoices and delivery notes).
export function datePrefix(day: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(day.getUTCDate())}${pad(day.getUTCMonth() + 1)}${pad(day.getUTCFullYear() % 100)}`;
}

async function nextInvoiceNumber(issuedAt: Date): Promise<string> {
  const prefix = datePrefix(issuedAt);
  const rows = await db().select({ number: invoices.number }).from(invoices).where(like(invoices.number, `${prefix}-%`));
  const max = Math.max(0, ...rows.map((r) => Number(r.number.slice(prefix.length + 1)) || 0));
  return `${prefix}-${max + 1}`;
}

export async function createInvoice(input: NewInvoice): Promise<Invoice> {
  const now = new Date();
  const invoice: Invoice = { id: newId(), number: '', ...input, status: 'issued', createdAt: now, updatedAt: now };
  const columns = toColumns(invoice);
  for (let attempt = 0; ; attempt++) {
    invoice.number = await nextInvoiceNumber(invoice.issuedAt);
    try {
      await db().insert(invoices).values({ id: invoice.id, number: invoice.number, ...columns, createdAt: now, updatedAt: now });
      return invoice;
    } catch (err) {
      if (!isDuplicateKeyError(err) || attempt >= 4) throw err;
    }
  }
}

export async function saveInvoice(invoice: Invoice): Promise<void> {
  invoice.updatedAt = new Date();
  await db().update(invoices).set({ ...toColumns(invoice), updatedAt: invoice.updatedAt }).where(eq(invoices.id, invoice.id));
}

export async function deleteInvoice(id: string): Promise<void> {
  await db().delete(invoices).where(eq(invoices.id, id));
}

export async function deleteOrderInvoices(executor: Executor, orderIds: string[]): Promise<void> {
  if (orderIds.length === 0) return;
  await executor.delete(invoices).where(inArray(invoices.orderId, orderIds));
}

// Procurement opens once an advance (or the full price) is paid.
export function isPrepaid(list: Invoice[]): boolean {
  return list.some((i) => i.status === 'paid' && (i.kind === 'prepayment' || i.kind === 'full'));
}

export function isInvoiceOverdue(i: Invoice): boolean {
  return i.status === 'issued' && Boolean(i.dueAt) && i.dueAt! < new Date();
}

const round = (n: number) => Math.round(n * 100) / 100;

// VAT is charged on the invoice amount (which is without VAT), as on the paper documents.
export const vatOf = (amount: number, vatRate: number) => round((amount * vatRate) / 100);
export const totalWithVat = (amount: number, vatRate: number) => round(amount + vatOf(amount, vatRate));
export const invoiceTotal = (i: Pick<Invoice, 'amount' | 'vatRate'>) => totalWithVat(i.amount, i.vatRate);

// Totals of a batch's invoices that aren't cancelled: invoiced without VAT (against the batch
// price), and with VAT and received (what the client pays).
export function invoiceTotals(list: Invoice[]) {
  const live = list.filter((i) => i.status !== 'cancelled');
  return {
    invoiced: round(live.reduce((sum, i) => sum + i.amount, 0)),
    invoicedWithVat: round(live.reduce((sum, i) => sum + invoiceTotal(i), 0)),
    paid: round(live.reduce((sum, i) => sum + (i.paidAmount ?? 0), 0)),
  };
}

export function invoiceJson(i: Invoice) {
  return {
    id: i.id,
    number: i.number,
    order: i.orderId,
    kind: i.kind,
    amount: i.amount,
    vatRate: i.vatRate,
    vatAmount: vatOf(i.amount, i.vatRate),
    total: invoiceTotal(i),
    issuedAt: i.issuedAt,
    dueAt: i.dueAt ?? null,
    status: i.status,
    paidAmount: i.paidAmount ?? null,
    paidAt: i.paidAt ?? null,
    isOverdue: isInvoiceOverdue(i),
    note: i.note ?? null,
    createdAt: i.createdAt,
  };
}
