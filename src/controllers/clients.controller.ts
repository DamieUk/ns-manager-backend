import { Request, Response } from 'express';
import Client from '../models/client.model';
import Contract from '../models/contract.model';
import Document from '../models/document.model';
import { HttpError } from '../utils/HttpError';

export async function list(req: Request, res: Response): Promise<void> {
  const clients = await Client.find().sort({ name: 1 });
  res.json(clients);
}

export async function getById(req: Request, res: Response): Promise<void> {
  const client = await Client.findById(req.params.id);
  if (!client) throw new HttpError(404, 'Client not found');

  const contracts = await Contract.find({ client: client._id }).sort({ createdAt: -1 });
  const documents = await Document.find({
    relatedType: 'Contract',
    relatedId: { $in: contracts.map((c) => c._id) },
  });

  res.json({ ...client.toObject(), contracts, documents });
}

export async function create(req: Request, res: Response): Promise<void> {
  const { name, contactName, email, phone, address, notes } = req.body;
  if (!name) throw new HttpError(400, 'name is required');

  const client = await Client.create({ name, contactName, email, phone, address, notes });
  res.status(201).json(client);
}

export async function update(req: Request, res: Response): Promise<void> {
  const client = await Client.findById(req.params.id);
  if (!client) throw new HttpError(404, 'Client not found');

  const { name, contactName, email, phone, address, notes } = req.body;
  if (name !== undefined) client.name = name;
  if (contactName !== undefined) client.contactName = contactName;
  if (email !== undefined) client.email = email;
  if (phone !== undefined) client.phone = phone;
  if (address !== undefined) client.address = address;
  if (notes !== undefined) client.notes = notes;

  await client.save();
  res.json(client);
}

export async function remove(req: Request, res: Response): Promise<void> {
  const client = await Client.findById(req.params.id);
  if (!client) throw new HttpError(404, 'Client not found');

  await client.deleteOne();
  res.status(204).send();
}
