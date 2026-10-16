import { Request, Response } from 'express';
import {
  createEntry,
  deleteEntry,
  findEntryById,
  listEntries,
  ProgressEntry,
  saveEntry,
} from '../models/dailyProgress.model';
import { findOrderById, findOrderLinks, Order } from '../models/order.model';
import { findClientsByIds } from '../models/client.model';
import { findProductsByIds } from '../models/product.model';
import { findUsersByIds } from '../models/user.model';
import { createDocument, deleteDocument, findDocumentById, findDocumentsByIds } from '../models/document.model';
import { HttpError } from '../utils/HttpError';
import { byId } from '../utils/validate';
import { isDuplicateKeyError } from '../utils/dbErrors';
import { normalizeToUTCMidnight } from '../utils/normalizeDate';
import { documentFromFile } from '../utils/documentFromFile';
import { deleteFromStorage } from '../config/storage';

function isManagement(role: string): boolean {
  return role === 'executive';
}

function isAssignedToOrder(order: Order, userId: string): boolean {
  return order.assignedEmployees.includes(userId);
}

// Resolves each entry's employee, order (with client/product names) and photo. Entries whose
// employee or order has been deleted come back without them.
async function populate(entries: ProgressEntry[]) {
  const unique = (ids: string[]) => [...new Set(ids)];
  const orderRows = await findOrderLinks(unique(entries.map((e) => e.orderId)));
  const [employees, clients, products, photos] = await Promise.all([
    findUsersByIds(unique(entries.map((e) => e.employeeId))),
    findClientsByIds(unique(orderRows.map((o) => o.clientId))),
    findProductsByIds(unique(orderRows.map((o) => o.productId))),
    findDocumentsByIds(unique(entries.flatMap((e) => (e.photoId ? [e.photoId] : [])))),
  ]);
  const ordersById = byId(orderRows);
  const employeesById = byId(employees);
  const clientsById = byId(clients);
  const productsById = byId(products);
  const photosById = byId(photos);

  return entries.map((entry) => {
    const order = ordersById.get(entry.orderId);
    return {
      entry,
      employee: employeesById.get(entry.employeeId),
      order: order && {
        id: order.id,
        client: clientsById.get(order.clientId),
        product: productsById.get(order.productId),
      },
      photo: entry.photoId ? photosById.get(entry.photoId) : undefined,
    };
  });
}

type Populated = Awaited<ReturnType<typeof populate>>[number];

export async function list(req: Request, res: Response): Promise<void> {
  const filter: Parameters<typeof listEntries>[0] = {};

  if (isManagement(req.user!.role)) {
    if (req.query.employee) filter.employeeId = req.query.employee;
    if (req.query.order) filter.orderId = req.query.order;
  } else {
    filter.employeeId = req.user!.id;
  }

  if (req.query.from) filter.from = normalizeToUTCMidnight(req.query.from);
  if (req.query.to) filter.to = normalizeToUTCMidnight(req.query.to);

  const entries = await populate(await listEntries(filter));

  // Entries whose employee or order has since been deleted are no longer shown.
  res.json(entries.filter((e) => e.employee && e.order).map(toResponse));
}

export async function getById(req: Request, res: Response): Promise<void> {
  const found = await findEntryById(req.params.id);
  const entry = found ? (await populate([found]))[0] : undefined;
  if (!entry || !entry.order) throw new HttpError(404, 'Entry not found');

  if (!isManagement(req.user!.role) && entry.entry.employeeId !== req.user!.id) {
    throw new HttpError(403, 'Not your entry');
  }

  res.json(toResponse(entry));
}

export async function create(req: Request, res: Response): Promise<void> {
  const { order, completed, needsRework, notes } = req.body as Record<string, string | undefined>;
  const file = req.file;

  if (!order) throw new HttpError(400, 'order is required');

  const orderDoc = await findOrderById(order);
  if (!orderDoc) throw new HttpError(400, 'order does not exist');
  if (orderDoc.status !== 'active') throw new HttpError(400, 'order is not active');
  if (!isAssignedToOrder(orderDoc, req.user!.id)) throw new HttpError(403, 'You are not assigned to this order');

  const normalizedDate = normalizeToUTCMidnight(new Date().toISOString());

  let photoId: string | undefined;
  if (file) {
    const photoDoc = await createDocument(await documentFromFile(file, orderDoc.clientId, req.user!.id, 'photo'));
    photoId = photoDoc.id;
  }

  let created;
  try {
    created = await createEntry({
      employeeId: req.user!.id,
      orderId: orderDoc.id,
      date: normalizedDate,
      completed: Number(completed) || 0,
      needsRework: Number(needsRework) || 0,
      notes,
      photoId,
    });
  } catch (err) {
    if (isDuplicateKeyError(err)) {
      throw new HttpError(409, 'Entry already exists for this order/date — update it instead');
    }
    throw err;
  }

  res.status(201).json(toResponse((await populate([created]))[0]));
}

export async function update(req: Request, res: Response): Promise<void> {
  const entry = await findEntryById(req.params.id);
  if (!entry) throw new HttpError(404, 'Entry not found');
  if (entry.employeeId !== req.user!.id) throw new HttpError(403, 'Not your entry');

  const orderDoc = await findOrderById(entry.orderId);
  if (!orderDoc) throw new HttpError(404, 'Entry not found');

  const file = req.file;
  const { date, completed, needsRework, partiallyAssembled, notes } = req.body as Record<string, string | undefined>;

  if (date !== undefined) entry.date = normalizeToUTCMidnight(date);
  if (completed !== undefined) entry.completed = Number(completed);
  if (needsRework !== undefined) entry.needsRework = Number(needsRework);
  if (partiallyAssembled !== undefined) entry.partiallyAssembled = Number(partiallyAssembled);
  if (notes !== undefined) entry.notes = notes;

  if (file) {
    if (entry.photoId) {
      const oldPhoto = await findDocumentById(entry.photoId);
      if (oldPhoto) {
        await deleteDocument(oldPhoto.id);
        deleteFromStorage(oldPhoto.filename).catch(() => {});
      }
    }
    const photoDoc = await createDocument(await documentFromFile(file, orderDoc.clientId, req.user!.id, 'photo'));
    entry.photoId = photoDoc.id;
  }

  try {
    await saveEntry(entry);
  } catch (err) {
    if (isDuplicateKeyError(err)) {
      throw new HttpError(409, 'Entry already exists for this order/date');
    }
    throw err;
  }

  res.json(toResponse((await populate([entry]))[0]));
}

export async function remove(req: Request, res: Response): Promise<void> {
  const entry = await findEntryById(req.params.id);
  if (!entry) throw new HttpError(404, 'Entry not found');
  if (entry.employeeId !== req.user!.id) throw new HttpError(403, 'Not your entry');

  if (entry.photoId) {
    const photoDoc = await findDocumentById(entry.photoId);
    if (photoDoc) {
      await deleteDocument(photoDoc.id);
      deleteFromStorage(photoDoc.filename).catch(() => {});
    }
  }

  await deleteEntry(entry.id);
  res.status(204).send();
}

function toResponse({ entry, employee, order, photo }: Populated) {
  return {
    id: entry.id,
    order: {
      id: order?.id,
      client: { id: order?.client?.id, name: order?.client?.name },
      product: { id: order?.product?.id, name: order?.product?.name },
    },
    employee: { id: employee?.id, name: `${employee?.firstName} ${employee?.lastName}` },
    date: entry.date,
    completed: entry.completed,
    needsRework: entry.needsRework,
    partiallyAssembled: entry.partiallyAssembled,
    notes: entry.notes ?? '',
    photo: photo ? { _id: photo.id, originalName: photo.originalName, mimeType: photo.mimeType, size: photo.size } : null,
  };
}
