import { Request, Response } from 'express';
import Contract from '../models/contract.model';
import Client from '../models/client.model';
import { HttpError } from '../utils/HttpError';
import { CONTRACT_STATUSES } from '../models/contract.model';

export async function list(req: Request, res: Response): Promise<void> {
  const filter: Record<string, unknown> = {};
  if (req.query.client) filter.client = req.query.client;

  const contracts = await Contract.find(filter).populate('client', 'name').sort({ createdAt: -1 });
  res.json(contracts);
}

export async function getById(req: Request, res: Response): Promise<void> {
  const contract = await Contract.findById(req.params.id).populate('client', 'name');
  if (!contract) throw new HttpError(404, 'Contract not found');
  res.json(contract);
}

export async function create(req: Request, res: Response): Promise<void> {
  const { title, client, startDate, endDate, status, notes } = req.body;
  if (!title) throw new HttpError(400, 'title is required');
  if (!client) throw new HttpError(400, 'client is required');

  const clientExists = await Client.exists({ _id: client });
  if (!clientExists) throw new HttpError(400, 'client does not exist');

  if (status && !CONTRACT_STATUSES.includes(status)) throw new HttpError(400, 'Invalid status');

  const contract = await Contract.create({ title, client, startDate, endDate, status, notes });
  res.status(201).json(contract);
}

export async function update(req: Request, res: Response): Promise<void> {
  const contract = await Contract.findById(req.params.id);
  if (!contract) throw new HttpError(404, 'Contract not found');

  const { title, client, startDate, endDate, status, notes } = req.body;

  if (client !== undefined) {
    const clientExists = await Client.exists({ _id: client });
    if (!clientExists) throw new HttpError(400, 'client does not exist');
    contract.client = client;
  }
  if (title !== undefined) contract.title = title;
  if (startDate !== undefined) contract.startDate = startDate;
  if (endDate !== undefined) contract.endDate = endDate;
  if (status !== undefined) {
    if (!CONTRACT_STATUSES.includes(status)) throw new HttpError(400, 'Invalid status');
    contract.status = status;
  }
  if (notes !== undefined) contract.notes = notes;

  await contract.save();
  res.json(contract);
}

export async function remove(req: Request, res: Response): Promise<void> {
  const contract = await Contract.findById(req.params.id);
  if (!contract) throw new HttpError(404, 'Contract not found');

  await contract.deleteOne();
  res.status(204).send();
}
