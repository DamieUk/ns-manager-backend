import { Request, Response } from 'express';
import Product from '../models/product.model';
import { HttpError } from '../utils/HttpError';

export async function list(req: Request, res: Response): Promise<void> {
  const products = await Product.find().sort({ name: 1 });
  res.json(products);
}

export async function getById(req: Request, res: Response): Promise<void> {
  const product = await Product.findById(req.params.id);
  if (!product) throw new HttpError(404, 'Product not found');
  res.json(product);
}

export async function create(req: Request, res: Response): Promise<void> {
  const { name, sku, description } = req.body;
  if (!name || !sku) throw new HttpError(400, 'name and sku are required');

  const product = await Product.create({ name, sku, description });
  res.status(201).json(product);
}

export async function update(req: Request, res: Response): Promise<void> {
  const product = await Product.findById(req.params.id);
  if (!product) throw new HttpError(404, 'Product not found');

  const { name, sku, description } = req.body;
  if (name !== undefined) product.name = name;
  if (sku !== undefined) product.sku = sku;
  if (description !== undefined) product.description = description;

  await product.save();
  res.json(product);
}

export async function remove(req: Request, res: Response): Promise<void> {
  const product = await Product.findById(req.params.id);
  if (!product) throw new HttpError(404, 'Product not found');

  await product.deleteOne();
  res.status(204).send();
}
