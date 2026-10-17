import { Request, Response } from 'express';
import { createShipment, deleteShipment, findShipmentById, listShipments, Shipment, ShipmentLine, shipmentJson, shippedQuantities } from '../models/shipment.model';
import { findOrderById, Order } from '../models/order.model';
import { findClientById, findClientsByIds } from '../models/client.model';
import { findProductsByIds } from '../models/product.model';
import { listInvoices } from '../models/invoice.model';
import { getCompany, vatRateOf } from '../models/company.model';
import { buildDeliveryNotePdf } from '../documents/deliveryNotePdf';
import { assertRequisites } from '../documents/parties';
import { HttpError } from '../utils/HttpError';
import { byId, castId } from '../utils/validate';
import { normalizeToUTCMidnight } from '../utils/normalizeDate';
import { sendPdf } from '../utils/sendPdf';
import { loadOrderLinks } from './orderLinks';

async function findShipment(id: unknown): Promise<Shipment> {
  const shipment = await findShipmentById(castId(id));
  if (!shipment) throw new HttpError(404, 'Shipment not found');
  return shipment;
}

// Delivery notes with the client's name and each line's batch number. ?client= / ?order= narrow it.
export async function list(req: Request, res: Response): Promise<void> {
  const shipments = await listShipments({
    clientId: req.query.client ? castId(req.query.client, 'client') : undefined,
    orderIds: req.query.order ? [castId(req.query.order, 'order')] : undefined,
  });
  const [clients, links] = await Promise.all([
    findClientsByIds([...new Set(shipments.map((s) => s.clientId))]),
    loadOrderLinks(shipments.flatMap((s) => s.lines.map((l) => l.orderId))),
  ]);
  const clientsById = byId(clients);
  res.json(
    shipments
      .filter((s) => clientsById.has(s.clientId))
      .map((s) => {
        const json = shipmentJson(s);
        const client = clientsById.get(s.clientId)!;
        return {
          ...json,
          client: { id: client.id, name: client.name },
          lines: json.lines.map((l) => ({ ...l, order: { id: l.orderId, number: links.get(l.orderId)?.number ?? '—' } })),
        };
      })
  );
}

interface LineInput {
  order?: unknown;
  quantity?: unknown;
  description?: unknown;
}

// A delivery note for one client, with lines from its batches at the shipping stage. Each line
// takes the batch's agreed price per board; no batch can ship more boards than it has left.
export async function create(req: Request, res: Response): Promise<void> {
  const { client: clientId, shippedAt, carrier, trackingNumber, note, lines } = req.body as Record<string, unknown>;
  const client = clientId ? await findClientById(clientId) : null;
  if (!client) throw new HttpError(400, 'client does not exist');
  if (!Array.isArray(lines) || lines.length === 0) throw new HttpError(400, 'Додайте хоча б одну партію');

  const orders = new Map<string, Order>();
  for (const line of lines as LineInput[]) {
    const order = await findOrderById(line.order);
    if (!order || order.clientId !== client.id) throw new HttpError(400, 'Партія не належить цьому клієнту');
    orders.set(order.id, order);
  }
  const [shipped, products] = await Promise.all([
    shippedQuantities([...orders.keys()]),
    findProductsByIds([...new Set([...orders.values()].map((o) => o.productId))]),
  ]);
  const productNames = new Map(products.map((p) => [p.id, p.name]));

  const planned = new Map<string, number>();
  const shipmentLines: ShipmentLine[] = (lines as LineInput[]).map((line) => {
    const order = orders.get(castId(line.order))!;
    if (order.stage !== 'shipping') throw new HttpError(409, `Партія № ${order.number} ще не на етапі «Відвантаження»`);
    if (order.unitPrice === undefined) throw new HttpError(409, `У партії № ${order.number} немає ціни`);
    const quantity = Number(line.quantity);
    if (!Number.isInteger(quantity) || quantity < 1) throw new HttpError(400, 'Кількість має бути цілим числом більше нуля');
    const total = (planned.get(order.id) ?? 0) + quantity;
    const left = order.quantity - (shipped.get(order.id) ?? 0);
    if (total > left) throw new HttpError(409, `Партія № ${order.number}: залишилось відвантажити ${left} шт.`);
    planned.set(order.id, total);
    const description = typeof line.description === 'string' && line.description.trim() ? line.description.trim() : (productNames.get(order.productId) ?? '');
    return { orderId: order.id, description, quantity, unitPrice: order.unitPrice };
  });

  const shipment = await createShipment({
    clientId: client.id,
    shippedAt: shippedAt ? normalizeToUTCMidnight(shippedAt) : normalizeToUTCMidnight(new Date()),
    vatRate: vatRateOf(await getCompany()),
    carrier: typeof carrier === 'string' ? carrier : undefined,
    trackingNumber: typeof trackingNumber === 'string' ? trackingNumber : undefined,
    note: typeof note === 'string' ? note : undefined,
    lines: shipmentLines,
    createdBy: req.user!.id,
  });
  res.status(201).json(shipmentJson(shipment));
}

export async function remove(req: Request, res: Response): Promise<void> {
  const shipment = await findShipment(req.params.id);
  await deleteShipment(shipment.id);
  res.status(204).send();
}

// The delivery note as a PDF, referencing the invoices of the shipped batches.
export async function pdf(req: Request, res: Response): Promise<void> {
  const shipment = await findShipment(req.params.id);
  const client = await findClientById(shipment.clientId);
  if (!client) throw new HttpError(404, 'Shipment not found');
  const company = await getCompany();
  assertRequisites(company, client);
  const invoices = (await listInvoices({ orderIds: [...new Set(shipment.lines.map((l) => l.orderId))] })).filter((i) => i.status !== 'cancelled');
  sendPdf(res, await buildDeliveryNotePdf({ shipment, client, company, invoices }), `Видаткова накладна ${shipment.number}.pdf`);
}
