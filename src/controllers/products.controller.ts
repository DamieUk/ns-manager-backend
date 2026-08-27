import fs from 'fs';
import { Request, Response } from 'express';
import { Types } from 'mongoose';
import Client from '../models/client.model';
import Document from '../models/document.model';
import Product, { PRODUCT_TYPES, ProductType } from '../models/product.model';
import { HttpError } from '../utils/HttpError';
import { documentFromFile } from '../utils/documentFromFile';

type MulterFields = { bomFile?: Express.Multer.File[]; additionalFiles?: Express.Multer.File[] };

export async function list(req: Request, res: Response): Promise<void> {
  const { client } = req.query as { client?: string };
  if (!client) throw new HttpError(400, 'client is required');

  const products = await Product.find({ client }).sort({ name: 1 }).populate('bomFile').populate('additionalFiles');
  res.json(products);
}

export async function getById(req: Request, res: Response): Promise<void> {
  const product = await Product.findById(req.params.id).populate('bomFile').populate('additionalFiles');
  if (!product) throw new HttpError(404, 'Product not found');
  res.json(product);
}

export async function create(req: Request, res: Response): Promise<void> {
  const { name, sku, type, client, description } = req.body as {
    name?: string;
    sku?: string;
    type?: string;
    client?: string;
    description?: string;
  };

  const files = req.files as MulterFields | undefined;
  const bomFile = files?.bomFile?.[0];
  const additionalFiles = files?.additionalFiles ?? [];
  const allUploadedFiles = [...(bomFile ? [bomFile] : []), ...additionalFiles];

  const fail = (status: number, message: string): never => {
    allUploadedFiles.forEach((f) => fs.unlink(f.path, () => {}));
    throw new HttpError(status, message);
  };

  if (!name || !sku || !type || !client) fail(400, 'name, sku, type and client are required');
  if (!PRODUCT_TYPES.includes(type as ProductType)) fail(400, 'Invalid type');
  if (type === 'PCB' && !bomFile) fail(400, 'bomFile is required for PCB products');

  const clientExists = await Client.exists({ _id: client });
  if (!clientExists) fail(400, 'client does not exist');

  const clientObjectId = new Types.ObjectId(client);

  let product;
  try {
    const bomDoc = bomFile ? await Document.create(documentFromFile(bomFile, clientObjectId, req.user!._id)) : null;
    const additionalDocs = [];
    for (const file of additionalFiles) {
      additionalDocs.push(await Document.create(documentFromFile(file, clientObjectId, req.user!._id)));
    }

    product = await Product.create({
      name,
      sku,
      type: type as ProductType,
      client,
      description,
      bomFile: bomDoc?._id,
      additionalFiles: additionalDocs.map((d) => d._id),
    });
  } catch (err) {
    allUploadedFiles.forEach((f) => fs.unlink(f.path, () => {}));
    if (product) await product.deleteOne();
    throw err;
  }

  res.status(201).json(product);
}

export async function update(req: Request, res: Response): Promise<void> {
  const product = await Product.findById(req.params.id);
  if (!product) throw new HttpError(404, 'Product not found');

  const { name, sku, type, description, bomFile, additionalFiles } = req.body as {
    name?: string;
    sku?: string;
    type?: string;
    description?: string;
    bomFile?: string | null;
    additionalFiles?: string[];
  };

  if (name !== undefined) product.name = name;
  if (sku !== undefined) product.sku = sku;
  if (type !== undefined) {
    if (!PRODUCT_TYPES.includes(type as ProductType)) throw new HttpError(400, 'Invalid type');
    product.type = type as ProductType;
  }
  if (description !== undefined) product.description = description;
  if (bomFile !== undefined) product.bomFile = (bomFile || undefined) as unknown as typeof product.bomFile;
  if (additionalFiles !== undefined) product.additionalFiles = additionalFiles as unknown as typeof product.additionalFiles;

  await product.save();
  res.json(product);
}

export async function remove(req: Request, res: Response): Promise<void> {
  const product = await Product.findById(req.params.id);
  if (!product) throw new HttpError(404, 'Product not found');

  await product.deleteOne();
  res.status(204).send();
}
