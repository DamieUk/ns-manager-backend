import fs from 'fs';
import path from 'path';
import { Request, Response } from 'express';
import Client from '../models/client.model';
import Contract from '../models/contract.model';
import Document from '../models/document.model';
import Order from '../models/order.model';
import Product from '../models/product.model';
import { HttpError } from '../utils/HttpError';
import { documentFromFile } from '../utils/documentFromFile';
import { UPLOAD_DIR } from '../middleware/upload';

type MulterFields = { contract?: Express.Multer.File[]; documents?: Express.Multer.File[] };

export async function list(req: Request, res: Response): Promise<void> {
  const clients = await Client.find().sort({ name: 1 });
  res.json(clients);
}

export async function getById(req: Request, res: Response): Promise<void> {
  const client = await Client.findById(req.params.id);
  if (!client) throw new HttpError(404, 'Client not found');

  const contracts = await Contract.find({ client: client._id }).sort({ createdAt: -1 }).populate('documents');
  const documents = await Document.find({ client: client._id }).sort({ createdAt: -1 });

  res.json({ ...client.toObject(), contracts, documents });
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
  const allUploadedFiles = [...(contractFile ? [contractFile] : []), ...supportingFiles];

  const fail = (status: number, message: string): never => {
    allUploadedFiles.forEach((f) => fs.unlink(f.path, () => {}));
    throw new HttpError(status, message);
  };

  if (!name || !code) fail(400, 'name and code are required');
  if (!contractFile) fail(400, 'contract PDF file is required');
  if (contractFile!.mimetype !== 'application/pdf') fail(400, 'contract must be a PDF file');

  let client;
  let contract;
  try {
    client = await Client.create({ name, code, contactName, email, phone, address, notes });

    const contractDoc = await Document.create(documentFromFile(contractFile!, client._id, req.user!._id));
    const supportingDocs = [];
    for (const file of supportingFiles) {
      supportingDocs.push(await Document.create(documentFromFile(file, client._id, req.user!._id)));
    }

    contract = await Contract.create({
      title: contractTitle || `${name} — Договір`,
      client: client._id,
      status: 'active',
      documents: [contractDoc._id, ...supportingDocs.map((d) => d._id)],
    });
  } catch (err) {
    allUploadedFiles.forEach((f) => fs.unlink(f.path, () => {}));
    if (client) await Document.deleteMany({ client: client._id });
    if (contract) await contract.deleteOne();
    if (client) await client.deleteOne();
    throw err;
  }

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

  const documents = await Document.find({ client: client._id });

  await Order.deleteMany({ client: client._id });
  await Product.deleteMany({ client: client._id });
  await Contract.deleteMany({ client: client._id });
  await Document.deleteMany({ client: client._id });
  await client.deleteOne();

  documents.forEach((doc) => fs.unlink(path.join(UPLOAD_DIR, doc.filename), () => {}));

  res.status(204).send();
}
