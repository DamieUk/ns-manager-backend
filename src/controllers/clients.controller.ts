import { Request, Response } from 'express';
import { Client, CLIENT_STATUSES, clientJson, createClient, deleteClient, findClientById, listClients, saveClient } from '../models/client.model';
import { contractJson, createContract, deleteClientContracts, deleteContract, listContracts, Contract } from '../models/contract.model';
import { createDocument, deleteClientDocuments, Doc, documentJson, findDocumentsByIds, listDocuments, resolveDocs } from '../models/document.model';
import { deleteClientOrders } from '../models/order.model';
import { deleteClientProducts } from '../models/product.model';
import { HttpError } from '../utils/HttpError';
import { byId } from '../utils/validate';
import { documentFromFile } from '../utils/documentFromFile';
import { deleteFromStorage } from '../config/storage';

type MulterFields = { contract?: Express.Multer.File[]; documents?: Express.Multer.File[] };

export async function list(req: Request, res: Response): Promise<void> {
  const clients = await listClients();
  res.json(clients.map(clientJson));
}

export async function getById(req: Request, res: Response): Promise<void> {
  const client = await findClientById(req.params.id);
  if (!client) throw new HttpError(404, 'Client not found');

  const contracts = await listContracts({ clientId: client.id });
  const contractDocs = byId(await findDocumentsByIds([...new Set(contracts.flatMap((c) => c.documents))]));
  const documents = await listDocuments({ clientId: client.id });

  res.json({
    ...clientJson(client),
    contracts: contracts.map((c) =>
      contractJson(c, { documents: resolveDocs(c.documents, contractDocs).map((d) => documentJson(d, { withId: true })) })
    ),
    documents: documents.map((d) => documentJson(d)),
  });
}

export async function create(req: Request, res: Response): Promise<void> {
  const { name, code, contactName, email, phone, address, notes, contractTitle } = req.body as {
    name?: string;
    code?: string;
    contactName?: string;
    email?: string;
    phone?: string;
    address?: string;
    notes?: string;
    contractTitle?: string;
  };

  const files = req.files as MulterFields | undefined;
  const contractFile = files?.contract?.[0];
  const supportingFiles = files?.documents ?? [];

  if (!name || !code) throw new HttpError(400, 'name and code are required');
  if (!contractFile) throw new HttpError(400, 'contract PDF file is required');
  if (contractFile.mimetype !== 'application/pdf') throw new HttpError(400, 'contract must be a PDF file');

  let client: Client | undefined;
  let contract: Contract | undefined;
  const uploadedDocs: Doc[] = [];
  try {
    client = await createClient({ name, code, contactName, email, phone, address, notes });

    const contractDoc = await createDocument(await documentFromFile(contractFile, client.id, req.user!.id));
    uploadedDocs.push(contractDoc);
    const supportingDocs: Doc[] = [];
    for (const file of supportingFiles) {
      const doc = await createDocument(await documentFromFile(file, client.id, req.user!.id));
      uploadedDocs.push(doc);
      supportingDocs.push(doc);
    }

    contract = await createContract({
      title: contractTitle || `${name} — Договір`,
      clientId: client.id,
      status: 'active',
      documents: [contractDoc.id, ...supportingDocs.map((d) => d.id)],
    });
  } catch (err) {
    uploadedDocs.forEach((doc) => deleteFromStorage(doc.filename).catch(() => {}));
    if (client) await deleteClientDocuments(client.id);
    if (contract) await deleteContract(contract.id);
    if (client) await deleteClient(client.id);
    throw err;
  }

  res.status(201).json(clientJson(client));
}

export async function update(req: Request, res: Response): Promise<void> {
  const client = await findClientById(req.params.id);
  if (!client) throw new HttpError(404, 'Client not found');

  const { name, contactName, email, phone, address, notes, status } = req.body;
  if (name !== undefined) client.name = name;
  if (contactName !== undefined) client.contactName = contactName;
  if (email !== undefined) client.email = email;
  if (phone !== undefined) client.phone = phone;
  if (address !== undefined) client.address = address;
  if (notes !== undefined) client.notes = notes;
  if (status !== undefined) {
    if (!CLIENT_STATUSES.includes(status)) throw new HttpError(400, 'Invalid status');
    client.status = status;
  }

  await saveClient(client);
  res.json(clientJson(client));
}

export async function remove(req: Request, res: Response): Promise<void> {
  const client = await findClientById(req.params.id);
  if (!client) throw new HttpError(404, 'Client not found');

  // Two-step deletion: mark the client `status: 'deleted'` first (keeps its orders/products/
  // contracts/documents intact for history) — only a client already in that state can be
  // purged permanently here.
  if (client.status !== 'deleted') {
    throw new HttpError(400, 'Set status to "deleted" before permanently deleting this client');
  }

  const documents = await listDocuments({ clientId: client.id });

  await deleteClientOrders(client.id);
  await deleteClientProducts(client.id);
  await deleteClientContracts(client.id);
  await deleteClientDocuments(client.id);
  await deleteClient(client.id);

  documents.forEach((doc) => deleteFromStorage(doc.filename).catch(() => {}));

  res.status(204).send();
}
