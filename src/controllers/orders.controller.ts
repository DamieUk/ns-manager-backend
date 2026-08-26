import { Request, Response } from 'express';
import Order, { ORDER_STATUSES } from '../models/order.model';
import Client from '../models/client.model';
import Product from '../models/product.model';
import { HttpError } from '../utils/HttpError';

export async function list(req: Request, res: Response): Promise<void> {
  const filter: Record<string, unknown> = {};
  if (req.query.status) filter.status = req.query.status;

  const orders = await Order.find(filter)
    .populate('client', 'name')
    .populate('product', 'name')
    .sort({ createdAt: -1 });

  res.json(orders.map(toOrderResponse));
}

export async function getById(req: Request, res: Response): Promise<void> {
  const order = await Order.findById(req.params.id).populate('client', 'name').populate('product', 'name');
  if (!order) throw new HttpError(404, 'Order not found');
  res.json(toOrderResponse(order));
}

export async function create(req: Request, res: Response): Promise<void> {
  const { client, product, quantity, status, assignedEmployees } = req.body;

  if (!client) throw new HttpError(400, 'client is required');
  if (!product) throw new HttpError(400, 'product is required');
  if (!quantity || quantity < 1) throw new HttpError(400, 'quantity must be a positive number');

  const [clientExists, productExists] = await Promise.all([
    Client.exists({ _id: client }),
    Product.exists({ _id: product }),
  ]);
  if (!clientExists) throw new HttpError(400, 'client does not exist');
  if (!productExists) throw new HttpError(400, 'product does not exist');

  if (status && !ORDER_STATUSES.includes(status)) throw new HttpError(400, 'Invalid status');

  const order = await Order.create({ client, product, quantity, status, assignedEmployees });
  res.status(201).json(order);
}

export async function update(req: Request, res: Response): Promise<void> {
  const order = await Order.findById(req.params.id);
  if (!order) throw new HttpError(404, 'Order not found');

  const { client, product, quantity, status, assignedEmployees } = req.body;

  if (client !== undefined) {
    if (!(await Client.exists({ _id: client }))) throw new HttpError(400, 'client does not exist');
    order.client = client;
  }
  if (product !== undefined) {
    if (!(await Product.exists({ _id: product }))) throw new HttpError(400, 'product does not exist');
    order.product = product;
  }
  if (quantity !== undefined) {
    if (quantity < 1) throw new HttpError(400, 'quantity must be a positive number');
    order.quantity = quantity;
  }
  if (status !== undefined) {
    if (!ORDER_STATUSES.includes(status)) throw new HttpError(400, 'Invalid status');
    order.status = status;
  }
  if (assignedEmployees !== undefined) order.assignedEmployees = assignedEmployees;

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
    status: order.status,
  };
}
