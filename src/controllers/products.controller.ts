import { Request, Response } from 'express';
import { clientExists } from '../models/client.model';
import { createDocument, deleteDocuments, Doc, documentJson, findDocumentsByIds, resolveDocs } from '../models/document.model';
import {
  createProduct,
  deleteProduct,
  findProductById,
  listClientProducts,
  Product,
  productJson,
  PRODUCT_TYPES,
  ProductType,
  saveProduct,
} from '../models/product.model';
import { HttpError } from '../utils/HttpError';
import { byId, castId } from '../utils/validate';
import { documentFromFile } from '../utils/documentFromFile';
import { deleteFromStorage } from '../config/storage';

type MulterFields = { bomFile?: Express.Multer.File[]; additionalFiles?: Express.Multer.File[] };

async function withFiles(products: Product[]) {
  const ids = products.flatMap((p) => [...(p.bomFile ? [p.bomFile] : []), ...p.additionalFiles]);
  const docs = byId(await findDocumentsByIds([...new Set(ids)]));
  return products.map((p) => {
    const bom = p.bomFile ? docs.get(p.bomFile) : undefined;
    return productJson(p, {
      bomFile: bom ? documentJson(bom, { withId: true }) : null,
      additionalFiles: resolveDocs(p.additionalFiles, docs).map((d) => documentJson(d, { withId: true })),
    });
  });
}

export async function list(req: Request, res: Response): Promise<void> {
  const { client } = req.query as { client?: string };
  if (!client) throw new HttpError(400, 'client is required');

  res.json(await withFiles(await listClientProducts(client)));
}

export async function getById(req: Request, res: Response): Promise<void> {
  const product = await findProductById(req.params.id);
  if (!product) throw new HttpError(404, 'Product not found');
  res.json((await withFiles([product]))[0]);
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

  if (!name || !sku || !type || !client) throw new HttpError(400, 'name, sku, type and client are required');
  if (!PRODUCT_TYPES.includes(type as ProductType)) throw new HttpError(400, 'Invalid type');
  if (type === 'PCB' && !bomFile) throw new HttpError(400, 'bomFile is required for PCB products');

  if (!(await clientExists(client))) throw new HttpError(400, 'client does not exist');

  const clientId = castId(client);

  let product: Product | undefined;
  const uploadedDocs: Doc[] = [];
  try {
    const bomDoc = bomFile ? await createDocument(await documentFromFile(bomFile, clientId, req.user!.id)) : null;
    if (bomDoc) uploadedDocs.push(bomDoc);
    const additionalDocs: Doc[] = [];
    for (const file of additionalFiles) {
      const doc = await createDocument(await documentFromFile(file, clientId, req.user!.id));
      uploadedDocs.push(doc);
      additionalDocs.push(doc);
    }

    product = await createProduct({
      name,
      sku,
      type: type as ProductType,
      clientId,
      description,
      bomFile: bomDoc?.id,
      additionalFiles: additionalDocs.map((d) => d.id),
    });
  } catch (err) {
    uploadedDocs.forEach((doc) => deleteFromStorage(doc.filename).catch(() => {}));
    await deleteDocuments(uploadedDocs.map((d) => d.id));
    if (product) await deleteProduct(product.id);
    throw err;
  }

  res.status(201).json(productJson(product));
}

export async function update(req: Request, res: Response): Promise<void> {
  const product = await findProductById(req.params.id);
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
  if (bomFile !== undefined) product.bomFile = bomFile || undefined;
  if (additionalFiles !== undefined) product.additionalFiles = additionalFiles;

  await saveProduct(product);
  res.json(productJson(product));
}

export async function remove(req: Request, res: Response): Promise<void> {
  const product = await findProductById(req.params.id);
  if (!product) throw new HttpError(404, 'Product not found');

  await deleteProduct(product.id);
  res.status(204).send();
}
