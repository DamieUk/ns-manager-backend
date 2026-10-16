import { Request, Response } from 'express';
import { Contract, contractJson, CONTRACT_STATUSES, createContract, deleteContract, findContractById, listContracts, saveContract } from '../models/contract.model';
import { clientExists, clientRefJson, findClientsByIds } from '../models/client.model';
import { HttpError } from '../utils/HttpError';
import { byId, castId } from '../utils/validate';

async function withClients(contracts: Contract[]) {
  const clients = byId(await findClientsByIds([...new Set(contracts.map((c) => c.clientId))]));
  return contracts.map((c) => contractJson(c, { client: clientRefJson(clients.get(c.clientId)) }));
}

export async function list(req: Request, res: Response): Promise<void> {
  const contracts = await listContracts({ clientId: req.query.client || undefined });
  res.json(await withClients(contracts));
}

export async function getById(req: Request, res: Response): Promise<void> {
  const contract = await findContractById(req.params.id);
  if (!contract) throw new HttpError(404, 'Contract not found');
  res.json((await withClients([contract]))[0]);
}

export async function create(req: Request, res: Response): Promise<void> {
  const { title, client, startDate, endDate, status, notes } = req.body;
  if (!title) throw new HttpError(400, 'title is required');
  if (!client) throw new HttpError(400, 'client is required');

  if (!(await clientExists(client))) throw new HttpError(400, 'client does not exist');

  if (status && !CONTRACT_STATUSES.includes(status)) throw new HttpError(400, 'Invalid status');

  const contract = await createContract({ title, clientId: castId(client), startDate, endDate, status, notes });
  res.status(201).json(contractJson(contract));
}

export async function update(req: Request, res: Response): Promise<void> {
  const contract = await findContractById(req.params.id);
  if (!contract) throw new HttpError(404, 'Contract not found');

  const { title, client, startDate, endDate, status, notes } = req.body;

  if (client !== undefined) {
    if (!(await clientExists(client))) throw new HttpError(400, 'client does not exist');
    contract.clientId = castId(client);
  }
  if (title !== undefined) contract.title = title;
  if (startDate !== undefined) contract.startDate = startDate;
  if (endDate !== undefined) contract.endDate = endDate;
  if (status !== undefined) {
    if (!CONTRACT_STATUSES.includes(status)) throw new HttpError(400, 'Invalid status');
    contract.status = status;
  }
  if (notes !== undefined) contract.notes = notes;

  await saveContract(contract);
  res.json(contractJson(contract));
}

export async function remove(req: Request, res: Response): Promise<void> {
  const contract = await findContractById(req.params.id);
  if (!contract) throw new HttpError(404, 'Contract not found');

  await deleteContract(contract.id);
  res.status(204).send();
}
