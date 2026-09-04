import { Request, Response } from 'express';
import Order, { ORDER_STATUSES } from '../models/order.model';
import Client from '../models/client.model';
import Product from '../models/product.model';
import Document from '../models/document.model';
import { HttpError } from '../utils/HttpError';

async function assertDocumentsBelongToClient(documentIds: string[], client: string): Promise<void> {
  if (documentIds.length === 0) return;
  const validCount = await Document.countDocuments({ _id: { $in: documentIds }, client });
  if (validCount !== documentIds.length) throw new HttpError(400, 'One or more documents are invalid for this client');
}

export async function list(req: Request, res: Response): Promise<void> {
  const filter: Record<string, unknown> = {};
  if (req.query.status) filter.status = req.query.status;
  if (req.query.client) filter.client = req.query.client;

  const orders = await Order.find(filter)
    .populate('client', 'name')
    .populate('product', 'name')
    .sort({ createdAt: -1 });

  res.json(orders.filter((order) => order.client && order.product).map(toOrderResponse));
}

export async function getById(req: Request, res: Response): Promise<void> {
  const order = await Order.findById(req.params.id)
    .populate('client', 'name')
    .populate('product', 'name')
    .populate('documents');
  if (!order || !order.client || !order.product) throw new HttpError(404, 'Order not found');
  res.json(toOrderDetailResponse(order));
}

export async function create(req: Request, res: Response): Promise<void> {
  const { client, product, quantity, description, status, assignedEmployees, documents } = req.body as {
    client?: string;
    product?: string;
    quantity?: number;
    description?: string;
    status?: string;
    assignedEmployees?: string[];
    documents?: string[];
  };

  if (!client) throw new HttpError(400, 'client is required');
  if (!product) throw new HttpError(400, 'product is required');
  if (!quantity || quantity < 1) throw new HttpError(400, 'quantity must be a positive number');
  if (!description || !description.trim()) throw new HttpError(400, 'description is required');

  const [clientExists, productExists] = await Promise.all([
    Client.exists({ _id: client }),
    Product.exists({ _id: product }),
  ]);
  if (!clientExists) throw new HttpError(400, 'client does not exist');
  if (!productExists) throw new HttpError(400, 'product does not exist');

  if (status && !ORDER_STATUSES.includes(status as (typeof ORDER_STATUSES)[number])) {
    throw new HttpError(400, 'Invalid status');
  }

  await assertDocumentsBelongToClient(documents ?? [], client);

  const order = await Order.create({
    client,
    product,
    quantity,
    description,
    status: status as (typeof ORDER_STATUSES)[number] | undefined,
    assignedEmployees,
    documents,
  });
  res.status(201).json(order);
}

export async function update(req: Request, res: Response): Promise<void> {
  const order = await Order.findById(req.params.id);
  if (!order) throw new HttpError(404, 'Order not found');

  const { client, product, quantity, description, status, assignedEmployees, documents } = req.body as {
    client?: string;
    product?: string;
    quantity?: number;
    description?: string;
    status?: string;
    assignedEmployees?: string[];
    documents?: string[];
  };

  if (client !== undefined) {
    if (!(await Client.exists({ _id: client }))) throw new HttpError(400, 'client does not exist');
    order.client = client as unknown as typeof order.client;
  }
  if (product !== undefined) {
    if (!(await Product.exists({ _id: product }))) throw new HttpError(400, 'product does not exist');
    order.product = product as unknown as typeof order.product;
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
  if (assignedEmployees !== undefined) order.assignedEmployees = assignedEmployees as unknown as typeof order.assignedEmployees;
  if (documents !== undefined) {
    await assertDocumentsBelongToClient(documents, order.client.toString());
    order.documents = documents as unknown as typeof order.documents;
  }

  await order.save();
  res.json(order);
}

export async function remove(req: Request, res: Response): Promise<void> {
  const order = await Order.findById(req.params.id);
  if (!order) throw new HttpError(404, 'Order not found');

  await order.deleteOne();
  res.status(204).send();
}

function toOrderResponse(order: InstanceType<typeof Order>) {
  const client = order.client as unknown as { _id: unknown; name: string };
  const product = order.product as unknown as { _id: unknown; name: string };
  return {
    id: order._id.toString(),
    client: { id: client._id?.toString(), name: client.name },
    product: { id: product._id?.toString(), name: product.name },
    quantity: order.quantity,
    description: order.description,
    status: order.status,
  };
}

function toOrderDetailResponse(order: InstanceType<typeof Order>) {
  const documents = order.documents as unknown as InstanceType<typeof Document>[];
  return {
    ...toOrderResponse(order),
    documents: documents.map((doc) => ({
      _id: doc._id.toString(),
      originalName: doc.originalName,
      mimeType: doc.mimeType,
      size: doc.size,
      createdAt: doc.createdAt,
    })),
  };
}
