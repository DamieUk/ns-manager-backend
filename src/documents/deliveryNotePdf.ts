import { Client } from '../models/client.model';
import { Company } from '../models/company.model';
import { Invoice } from '../models/invoice.model';
import { Shipment, shipmentTotals } from '../models/shipment.model';
import { clientParty, supplierParty } from './parties';
import { createDocument, day, drawFooter, drawHeader, drawItems, drawParties, toBuffer } from './pdfLayout';

export interface DeliveryNotePdfInput {
  shipment: Shipment;
  client: Client;
  company: Company;
  // The invoices of the shipped batches, referenced under the title.
  invoices: Invoice[];
}

export function buildDeliveryNotePdf({ shipment, client, company, invoices }: DeliveryNotePdfInput): Promise<Buffer> {
  const doc = createDocument(`Видаткова накладна № ${shipment.number}`, company.legalName ?? company.name);

  const subtitle = [
    `від ${day(shipment.shippedAt)}`,
    ...invoices.map((i) => `Рахунок № ${i.number} від ${day(i.issuedAt)} р.`),
    shipment.trackingNumber && `${shipment.carrier ? `${shipment.carrier}, ` : ''}ТТН ${shipment.trackingNumber}`,
  ].filter((l): l is string => Boolean(l));
  let y = drawHeader(doc, company.name, `ВИДАТКОВА НАКЛАДНА № ${shipment.number}`, subtitle);
  y = drawParties(doc, supplierParty(company), clientParty(client, 'Отримувач:'), y);

  // Only what the note itself lists; boards that went out on top of it are the shop's own record.
  const rows = shipment.lines.filter((l) => l.quantity > 0).map((l) => ({
    description: l.description,
    quantity: l.quantity,
    price: l.unitPrice,
    sum: Math.round(l.quantity * l.unitPrice * 100) / 100,
  }));
  const totals = shipmentTotals(shipment);
  y = drawItems(doc, rows, totals, y);
  drawFooter(doc, totals, company.signatory, y, true);
  return toBuffer(doc);
}
