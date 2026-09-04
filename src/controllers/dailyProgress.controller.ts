import { Request, Response } from 'express';
import { Types } from 'mongoose';
import { MongoServerError } from 'mongodb';
import DailyProgress, { DailyProgressDocument } from '../models/dailyProgress.model';
import Order from '../models/order.model';
import { HttpError } from '../utils/HttpError';
import { normalizeToUTCMidnight } from '../utils/normalizeDate';

const MANAGEMENT_ROLES = ['executive', 'manager'];

function isManagement(role: string): boolean {
  return MANAGEMENT_ROLES.includes(role);
}

const ORDER_POPULATE = {
  path: 'order',
  select: 'client product',
  populate: [
    { path: 'client', select: 'name' },
    { path: 'product', select: 'name' },
  ],
};

export async function list(req: Request, res: Response): Promise<void> {
  const filter: Record<string, unknown> = {};

  if (isManagement(req.user!.role)) {
    if (req.query.employee) filter.employee = req.query.employee;
    if (req.query.order) filter.order = req.query.order;
  } else {
    filter.employee = req.user!._id;
  }

  if (req.query.from || req.query.to) {
    const range: Record<string, Date> = {};
    if (req.query.from) range.$gte = normalizeToUTCMidnight(req.query.from);
    if (req.query.to) range.$lte = normalizeToUTCMidnight(req.query.to);
    filter.date = range;
  }

  const entries = await DailyProgress.find(filter)
    .sort({ date: -1 })
    .populate('employee', 'firstName lastName')
    .populate(ORDER_POPULATE);

  res.json(entries.map(toResponse));
}

export async function getById(req: Request, res: Response): Promise<void> {
  const entry = await DailyProgress.findById(req.params.id).populate('employee', 'firstName lastName').populate(ORDER_POPULATE);
  if (!entry) throw new HttpError(404, 'Entry not found');

  const employeeId = (entry.employee as unknown as { _id: Types.ObjectId })._id;
  if (!isManagement(req.user!.role) && !employeeId.equals(req.user!._id)) {
    throw new HttpError(403, 'Not your entry');
  }

  res.json(toResponse(entry));
}

export async function create(req: Request, res: Response): Promise<void> {
  const { order, date, completed, needsRework, partiallyAssembled, notes } = req.body;

  if (!order) throw new HttpError(400, 'order is required');

  const orderDoc = await Order.findById(order);
  if (!orderDoc) throw new HttpError(400, 'order does not exist');
  if (orderDoc.status !== 'active') throw new HttpError(400, 'order is not active');

  const normalizedDate = normalizeToUTCMidnight(date);

  let created;
  try {
    created = await DailyProgress.create({
      employee: req.user!._id,
      order,
      date: normalizedDate,
      completed,
      needsRework,
      partiallyAssembled,
      notes,
    });
  } catch (err) {
    if (err instanceof MongoServerError && err.code === 11000) {
      throw new HttpError(409, 'Entry already exists for this order/date — update it instead');
    }
    throw err;
  }

  const populatedEntry = await DailyProgress.findById(created._id).populate('employee', 'firstName lastName').populate(ORDER_POPULATE);
  res.status(201).json(toResponse(populatedEntry!));
}

export async function update(req: Request, res: Response): Promise<void> {
  const entry = await DailyProgress.findById(req.params.id);
  if (!entry) throw new HttpError(404, 'Entry not found');
  if (!entry.employee.equals(req.user!._id)) throw new HttpError(403, 'Not your entry');

  const { date, completed, needsRework, partiallyAssembled, notes } = req.body;

  if (date !== undefined) entry.date = normalizeToUTCMidnight(date);
  if (completed !== undefined) entry.completed = completed;
  if (needsRework !== undefined) entry.needsRework = needsRework;
  if (partiallyAssembled !== undefined) entry.partiallyAssembled = partiallyAssembled;
  if (notes !== undefined) entry.notes = notes;

  try {
    await entry.save();
  } catch (err) {
    if (err instanceof MongoServerError && err.code === 11000) {
      throw new HttpError(409, 'Entry already exists for this order/date');
    }
    throw err;
  }

  const populatedEntry = await DailyProgress.findById(entry._id).populate('employee', 'firstName lastName').populate(ORDER_POPULATE);
  res.json(toResponse(populatedEntry!));
}

export async function remove(req: Request, res: Response): Promise<void> {
  const entry = await DailyProgress.findById(req.params.id);
  if (!entry) throw new HttpError(404, 'Entry not found');
  if (!entry.employee.equals(req.user!._id)) throw new HttpError(403, 'Not your entry');

  await entry.deleteOne();
  res.status(204).send();
}

function toResponse(entry: DailyProgressDocument) {
  const employee = entry.employee as unknown as { _id: unknown; firstName: string; lastName: string };
  const order = entry.order as unknown as {
    _id: unknown;
    client: { _id: unknown; name: string };
    product: { _id: unknown; name: string };
  };

  return {
    id: entry._id.toString(),
    order: {
      id: order._id?.toString(),
      client: { id: order.client?._id?.toString(), name: order.client?.name },
      product: { id: order.product?._id?.toString(), name: order.product?.name },
    },
    employee: { id: employee._id?.toString(), name: `${employee.firstName} ${employee.lastName}` },
    date: entry.date,
    completed: entry.completed,
    needsRework: entry.needsRework,
    partiallyAssembled: entry.partiallyAssembled,
    notes: entry.notes ?? '',
  };
}
