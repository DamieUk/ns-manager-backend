import fs from 'fs';
import path from 'path';
import { Request, Response } from 'express';
import { Types } from 'mongoose';
import { MongoServerError } from 'mongodb';
import DailyProgress, { DailyProgressDocument } from '../models/dailyProgress.model';
import Order from '../models/order.model';
import Document from '../models/document.model';
import { HttpError } from '../utils/HttpError';
import { normalizeToUTCMidnight } from '../utils/normalizeDate';
import { documentFromFile } from '../utils/documentFromFile';
import { UPLOAD_DIR } from '../middleware/upload';

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

function isAssignedToOrder(orderDoc: InstanceType<typeof Order>, userId: Types.ObjectId): boolean {
  return orderDoc.assignedEmployees.some((id) => id.equals(userId));
}

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
    .populate(ORDER_POPULATE)
    .populate('photo');

  res.json(entries.filter((e) => e.employee).map(toResponse));
}

export async function getById(req: Request, res: Response): Promise<void> {
  const entry = await DailyProgress.findById(req.params.id)
    .populate('employee', 'firstName lastName')
    .populate(ORDER_POPULATE)
    .populate('photo');
  if (!entry) throw new HttpError(404, 'Entry not found');

  const employeeId = (entry.employee as unknown as { _id: Types.ObjectId })._id;
  if (!isManagement(req.user!.role) && !employeeId.equals(req.user!._id)) {
    throw new HttpError(403, 'Not your entry');
  }

  res.json(toResponse(entry));
}

export async function create(req: Request, res: Response): Promise<void> {
  const { order, completed, needsRework, notes } = req.body as Record<string, string | undefined>;
  const file = req.file;

  const fail = (status: number, message: string): never => {
    if (file) fs.unlink(file.path, () => {});
    throw new HttpError(status, message);
  };

  if (!order) fail(400, 'order is required');

  const orderDoc = await Order.findById(order);
  if (!orderDoc) fail(400, 'order does not exist');
  if (orderDoc!.status !== 'active') fail(400, 'order is not active');
  if (!isAssignedToOrder(orderDoc!, req.user!._id)) fail(403, 'You are not assigned to this order');

  const normalizedDate = normalizeToUTCMidnight(new Date().toISOString());

  let photoId: Types.ObjectId | undefined;
  if (file) {
    const photoDoc = await Document.create(documentFromFile(file, orderDoc!.client, req.user!._id));
    photoId = photoDoc._id;
  }

  let created;
  try {
    created = await DailyProgress.create({
      employee: req.user!._id,
      order,
      date: normalizedDate,
      completed: Number(completed) || 0,
      needsRework: Number(needsRework) || 0,
      notes,
      photo: photoId,
    });
  } catch (err) {
    if (err instanceof MongoServerError && err.code === 11000) {
      throw new HttpError(409, 'Entry already exists for this order/date — update it instead');
    }
    throw err;
  }

  const populatedEntry = await DailyProgress.findById(created._id)
    .populate('employee', 'firstName lastName')
    .populate(ORDER_POPULATE)
    .populate('photo');
  res.status(201).json(toResponse(populatedEntry!));
}

export async function update(req: Request, res: Response): Promise<void> {
  const entry = await DailyProgress.findById(req.params.id);
  if (!entry) throw new HttpError(404, 'Entry not found');
  if (!entry.employee.equals(req.user!._id)) throw new HttpError(403, 'Not your entry');

  const file = req.file;
  const { date, completed, needsRework, partiallyAssembled, notes } = req.body as Record<string, string | undefined>;

  if (date !== undefined) entry.date = normalizeToUTCMidnight(date);
  if (completed !== undefined) entry.completed = Number(completed);
  if (needsRework !== undefined) entry.needsRework = Number(needsRework);
  if (partiallyAssembled !== undefined) entry.partiallyAssembled = Number(partiallyAssembled);
  if (notes !== undefined) entry.notes = notes;

  if (file) {
    if (entry.photo) {
      const oldPhoto = await Document.findByIdAndDelete(entry.photo);
      if (oldPhoto) fs.unlink(path.join(UPLOAD_DIR, oldPhoto.filename), () => {});
    }
    const orderDoc = await Order.findById(entry.order);
    const photoDoc = await Document.create(documentFromFile(file, orderDoc!.client, req.user!._id));
    entry.photo = photoDoc._id;
  }

  try {
    await entry.save();
  } catch (err) {
    if (file) fs.unlink(file.path, () => {});
    if (err instanceof MongoServerError && err.code === 11000) {
      throw new HttpError(409, 'Entry already exists for this order/date');
    }
    throw err;
  }

  const populatedEntry = await DailyProgress.findById(entry._id)
    .populate('employee', 'firstName lastName')
    .populate(ORDER_POPULATE)
    .populate('photo');
  res.json(toResponse(populatedEntry!));
}

export async function remove(req: Request, res: Response): Promise<void> {
  const entry = await DailyProgress.findById(req.params.id);
  if (!entry) throw new HttpError(404, 'Entry not found');
  if (!entry.employee.equals(req.user!._id)) throw new HttpError(403, 'Not your entry');

  if (entry.photo) {
    const photoDoc = await Document.findByIdAndDelete(entry.photo);
    if (photoDoc) fs.unlink(path.join(UPLOAD_DIR, photoDoc.filename), () => {});
  }

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
  const photo = entry.photo as unknown as InstanceType<typeof Document> | undefined;

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
    photo: photo
      ? { _id: photo._id.toString(), originalName: photo.originalName, mimeType: photo.mimeType, size: photo.size }
      : null,
  };
}
