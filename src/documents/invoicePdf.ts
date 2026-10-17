import { Client } from '../models/client.model';
import { Company } from '../models/company.model';
import { Invoice, invoiceTotal, vatOf } from '../models/invoice.model';
import { batchTotal, Order } from '../models/order.model';
import { PaperState } from '../models/contract.model';
import { clientParty, supplierParty } from './parties';
import { createDocument, day, drawFooter, drawHeader, drawItems, drawParties, Row, toBuffer } from './pdfLayout';

// The line printed for an invoice when it has no text of its own.
export function defaultInvoiceDescription(kind: Invoice['kind'], order: Pick<Order, 'number' | 'quantity'>, productName: string): string {
  if (kind === 'full') return productName;
  return `${kind === 'prepayment' ? 'Передоплата' : 'Доплата'}: ${productName}, ${order.quantity} шт. (партія № ${order.number})`;
}

// «Згідно з додатком № 3 від 01.09.2026 до договору № 12/2026 від 15.08.2026»
function basisLine(annex: PaperState | null, framework: PaperState | null): string | undefined {
  if (!annex && !framework) return undefined;
  const paper = (name: string, p: PaperState | null) =>
    p ? `${name}${p.number ? ` № ${p.number}` : ''}${p.signedAt ? ` від ${day(p.signedAt)}` : ''}` : '';
  const annexPart = paper('додатком', annex);
  const frameworkPart = paper('договору', framework);
  return `Згідно з ${[annexPart, frameworkPart].filter(Boolean).join(' до ')}`;
}

export interface InvoicePdfInput {
  invoice: Invoice;
  order: Order;
  productName: string;
  client: Client;
  company: Company;
  annex: PaperState | null;
  framework: PaperState | null;
}

export function buildInvoicePdf({ invoice, order, productName, client, company, annex, framework }: InvoicePdfInput): Promise<Buffer> {
  const title = `Рахунок на оплату № ${invoice.number}`;
  const doc = createDocument(title, company.legalName ?? company.name);

  const subtitle = [
    `від ${day(invoice.issuedAt)}`,
    invoice.dueAt && `Сплатити до ${day(invoice.dueAt)}`,
    basisLine(annex, framework),
  ].filter((l): l is string => Boolean(l));
  let y = drawHeader(doc, company.name, `РАХУНОК НА ОПЛАТУ № ${invoice.number}`, subtitle);
  y = drawParties(doc, supplierParty(company), clientParty(client, 'Платник:'), y);

  // The whole batch at once is printed as its boards; an advance or the rest as one line.
  const wholeBatch = Math.abs((batchTotal(order) ?? -1) - invoice.amount) < 0.005 && order.unitPrice !== undefined;
  const row: Row = wholeBatch
    ? { description: invoice.description ?? productName, quantity: order.quantity, price: order.unitPrice!, sum: invoice.amount }
    : {
        description: invoice.description ?? defaultInvoiceDescription(invoice.kind, order, productName),
        quantity: 1,
        price: invoice.amount,
        sum: invoice.amount,
      };
  const totals = { net: invoice.amount, vatRate: invoice.vatRate, vat: vatOf(invoice.amount, invoice.vatRate), total: invoiceTotal(invoice) };
  y = drawItems(doc, [row], totals, y);
  drawFooter(doc, totals, company.signatory, y, false);
  return toBuffer(doc);
}
