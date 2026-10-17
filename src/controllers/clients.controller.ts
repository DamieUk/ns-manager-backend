import { Request, Response } from 'express';
import { Client, CLIENT_DETAIL_FIELDS, CLIENT_STATUSES, clientJson, createClient, deleteClient, findClientById, listClients, NewClient, saveClient } from '../models/client.model';
import { contractJson, createContract, defaultContractTitle, deleteClientContracts, deleteContract, listContracts, Contract, paperStatus } from '../models/contract.model';
import { createDocument, deleteClientDocuments, Doc, documentJson, findDocumentsByIds, listDocuments, resolveDocs } from '../models/document.model';
import { deleteClientOrders } from '../models/order.model';
import { deleteClientProducts } from '../models/product.model';
import { deleteClientShipments } from '../models/shipment.model';
import { HttpError } from '../utils/HttpError';
import { byId, castDate } from '../utils/validate';
import { documentFromFile } from '../utils/documentFromFile';
import { deleteFromStorage } from '../config/storage';

type MulterFields = { nda?: Express.Multer.File[]; contract?: Express.Multer.File[]; documents?: Express.Multer.File[] };

// The optional card and requisites fields present in a request body.
function detailFields(body: Record<string, unknown>): Partial<NewClient> {
  const fields: Partial<NewClient> = {};
  for (const key of CLIENT_DETAIL_FIELDS) if (body[key] !== undefined) fields[key] = body[key] as string;
  return fields;
}

export async function list(req: Request, res: Response): Promise<void> {
  const [clients, contracts] = await Promise.all([listClients(), listContracts()]);
  res.json(clients.map((c) => ({ ...clientJson(c), papers: paperStatus(contracts.filter((k) => k.clientId === c.id)) })));
}

export async function getById(req: Request, res: Response): Promise<void> {
  const client = await findClientById(req.params.id);
  if (!client) throw new HttpError(404, 'Client not found');

  const contracts = await listContracts({ clientId: client.id });
  const contractDocs = byId(await findDocumentsByIds([...new Set(contracts.flatMap((c) => c.documents))]));
  const documents = await listDocuments({ clientId: client.id });

  res.json({
    ...clientJson(client),
    papers: paperStatus(contracts),
    contracts: contracts.map((c) =>
      contractJson(c, { documents: resolveDocs(c.documents, contractDocs).map((d) => documentJson(d, { withId: true })) })
    ),
    documents: documents.map((d) => documentJson(d)),
  });
}

// A client is only taken on once an NDA is signed: creating one needs the signed NDA (`nda` file)
// and its signing date, which become the client's first paper. A framework contract PDF can be
// attached right away as `contract`; usually it comes later via POST /contracts.
export async function create(req: Request, res: Response): Promise<void> {
  const { name, code, contractTitle, ndaNumber, ndaSignedAt } = req.body as {
    name?: string;
    code?: string;
    contractTitle?: string;
    ndaNumber?: string;
    ndaSignedAt?: string;
  };

  const files = req.files as MulterFields | undefined;
  const ndaFile = files?.nda?.[0];
  const contractFile = files?.contract?.[0];
  const supportingFiles = files?.documents ?? [];

  if (!name || !code) throw new HttpError(400, 'name and code are required');
  if (!ndaFile) throw new HttpError(400, 'Додайте скан підписаного NDA');
  if (!ndaSignedAt) throw new HttpError(400, 'Вкажіть дату підпису NDA');
  castDate(ndaSignedAt, 'ndaSignedAt');
  if (contractFile && contractFile.mimetype !== 'application/pdf') throw new HttpError(400, 'contract must be a PDF file');

  let client: Client | undefined;
  const contracts: Contract[] = [];
  const uploadedDocs: Doc[] = [];
  try {
    client = await createClient({ name, code, ...detailFields(req.body) });

    const ndaDoc = await createDocument(await documentFromFile(ndaFile, client.id, req.user!.id, 'nda'));
    uploadedDocs.push(ndaDoc);
    contracts.push(
      await createContract({
        title: defaultContractTitle('nda', ndaNumber?.trim()),
        clientId: client.id,
        type: 'nda',
        number: ndaNumber,
        signedAt: ndaSignedAt,
        status: 'active',
        documents: [ndaDoc.id],
      })
    );

    const contractDoc = contractFile
      ? await createDocument(await documentFromFile(contractFile, client.id, req.user!.id, 'framework_contract'))
      : undefined;
    if (contractDoc) uploadedDocs.push(contractDoc);
    const supportingDocs: Doc[] = [];
    for (const file of supportingFiles) {
      const doc = await createDocument(await documentFromFile(file, client.id, req.user!.id));
      uploadedDocs.push(doc);
      supportingDocs.push(doc);
    }

    if (contractDoc) {
      contracts.push(
        await createContract({
          title: contractTitle || `${name} — Договір`,
          clientId: client.id,
          type: 'framework',
          status: 'active',
          documents: [contractDoc.id, ...supportingDocs.map((d) => d.id)],
        })
      );
    }
  } catch (err) {
    uploadedDocs.forEach((doc) => deleteFromStorage(doc.filename).catch(() => {}));
    if (client) await deleteClientDocuments(client.id);
    for (const contract of contracts) await deleteContract(contract.id);
    if (client) await deleteClient(client.id);
    throw err;
  }

  res.status(201).json(clientJson(client));
}

export async function update(req: Request, res: Response): Promise<void> {
  const client = await findClientById(req.params.id);
  if (!client) throw new HttpError(404, 'Client not found');

  const { name, status } = req.body;
  if (name !== undefined) client.name = name;
  Object.assign(client, detailFields(req.body));
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

  await deleteClientShipments(client.id);
  await deleteClientOrders(client.id);
  await deleteClientProducts(client.id);
  await deleteClientContracts(client.id);
  await deleteClientDocuments(client.id);
  await deleteClient(client.id);

  documents.forEach((doc) => deleteFromStorage(doc.filename).catch(() => {}));

  res.status(204).send();
}
