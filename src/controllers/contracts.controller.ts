import { Request, Response } from 'express';
import {
  Contract,
  CONTRACT_DOCUMENT_TYPE,
  contractJson,
  CONTRACT_STATUSES,
  CONTRACT_TYPES,
  ContractType,
  createContract,
  defaultContractTitle,
  deleteContract,
  findContractById,
  listContracts,
  saveContract,
} from '../models/contract.model';
import { clientExists, clientRefJson, findClientsByIds } from '../models/client.model';
import { createDocument, deleteDocuments, Doc } from '../models/document.model';
import { findOrderById } from '../models/order.model';
import { HttpError } from '../utils/HttpError';
import { byId, castId } from '../utils/validate';
import { documentFromFile } from '../utils/documentFromFile';
import { deleteFromStorage } from '../config/storage';

async function withClients(contracts: Contract[]) {
  const clients = byId(await findClientsByIds([...new Set(contracts.map((c) => c.clientId))]));
  return contracts.map((c) => contractJson(c, { client: clientRefJson(clients.get(c.clientId)) }));
}

function assertType(type: unknown): asserts type is ContractType | undefined {
  if (type !== undefined && !CONTRACT_TYPES.includes(type as ContractType)) throw new HttpError(400, 'Invalid type');
}

// An annex covers one of the same client's batches; other contract types aren't tied to a batch.
async function assertOrderLink(order: unknown, type: ContractType, clientId: string): Promise<void> {
  if (order === undefined || order === null || order === '') return;
  if (type !== 'annex') throw new HttpError(400, 'Only an annex can be linked to an order');
  const found = await findOrderById(order);
  if (!found) throw new HttpError(400, 'order does not exist');
  if (found.clientId !== clientId) throw new HttpError(400, 'order belongs to another client');
}

// Stores uploaded files as the contract's documents; removes them again if a later step fails.
async function uploadContractFiles(req: Request, type: ContractType, clientId: string): Promise<Doc[]> {
  const files = (req.files as Express.Multer.File[] | undefined) ?? [];
  const docs: Doc[] = [];
  try {
    for (const file of files) {
      docs.push(await createDocument(await documentFromFile(file, clientId, req.user!.id, CONTRACT_DOCUMENT_TYPE[type])));
    }
  } catch (err) {
    await discard(docs);
    throw err;
  }
  return docs;
}

async function discard(docs: Doc[]): Promise<void> {
  docs.forEach((doc) => deleteFromStorage(doc.filename).catch(() => {}));
  await deleteDocuments(docs.map((d) => d.id));
}

export async function list(req: Request, res: Response): Promise<void> {
  let contracts = await listContracts({ clientId: req.query.client || undefined });
  if (req.query.type) contracts = contracts.filter((c) => c.type === req.query.type);
  res.json(await withClients(contracts));
}

export async function getById(req: Request, res: Response): Promise<void> {
  const contract = await findContractById(req.params.id);
  if (!contract) throw new HttpError(404, 'Contract not found');
  res.json((await withClients([contract]))[0]);
}

export async function create(req: Request, res: Response): Promise<void> {
  const { title, client, type, number, signedAt, order, startDate, endDate, status, notes } = req.body;
  if (!client) throw new HttpError(400, 'client is required');

  if (!(await clientExists(client))) throw new HttpError(400, 'client does not exist');
  const clientId = castId(client);

  assertType(type);
  const contractType: ContractType = type ?? 'framework';
  if (status && !CONTRACT_STATUSES.includes(status)) throw new HttpError(400, 'Invalid status');
  await assertOrderLink(order, contractType, clientId);

  const docs = await uploadContractFiles(req, contractType, clientId);
  let contract;
  try {
    contract = await createContract({
      title: title || defaultContractTitle(contractType, number),
      clientId,
      type: contractType,
      number,
      signedAt,
      orderId: order || undefined,
      startDate,
      endDate,
      // A contract uploaded with its signing date is in force unless a status says otherwise.
      status: status || (signedAt ? 'active' : undefined),
      notes,
      documents: docs.map((d) => d.id),
    });
  } catch (err) {
    await discard(docs);
    throw err;
  }
  res.status(201).json(contractJson(contract));
}

export async function update(req: Request, res: Response): Promise<void> {
  const contract = await findContractById(req.params.id);
  if (!contract) throw new HttpError(404, 'Contract not found');

  const { title, client, type, number, signedAt, order, startDate, endDate, status, notes } = req.body;

  if (client !== undefined) {
    if (!(await clientExists(client))) throw new HttpError(400, 'client does not exist');
    contract.clientId = castId(client);
  }
  if (type !== undefined) {
    assertType(type);
    contract.type = type as ContractType;
  }
  if (order !== undefined) {
    await assertOrderLink(order, contract.type, contract.clientId);
    contract.orderId = order || undefined;
  } else if (contract.orderId && contract.type !== 'annex') {
    throw new HttpError(400, 'Only an annex can be linked to an order');
  }
  if (title !== undefined) contract.title = title;
  if (number !== undefined) contract.number = number;
  if (signedAt !== undefined) {
    contract.signedAt = signedAt;
    if (signedAt && status === undefined && contract.status === 'draft') contract.status = 'active';
  }
  if (startDate !== undefined) contract.startDate = startDate;
  if (endDate !== undefined) contract.endDate = endDate;
  if (status !== undefined) {
    if (!CONTRACT_STATUSES.includes(status)) throw new HttpError(400, 'Invalid status');
    contract.status = status;
  }
  if (notes !== undefined) contract.notes = notes;

  const docs = await uploadContractFiles(req, contract.type, contract.clientId);
  contract.documents = [...contract.documents, ...docs.map((d) => d.id)];
  try {
    await saveContract(contract);
  } catch (err) {
    await discard(docs);
    throw err;
  }
  res.json(contractJson(contract));
}

export async function remove(req: Request, res: Response): Promise<void> {
  const contract = await findContractById(req.params.id);
  if (!contract) throw new HttpError(404, 'Contract not found');

  await deleteContract(contract.id);
  res.status(204).send();
}
