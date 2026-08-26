import { Request, Response, NextFunction } from 'express';
import { Error as MongooseError } from 'mongoose';
import { MongoServerError } from 'mongodb';
import { MulterError } from 'multer';
import { HttpError } from '../utils/HttpError';

export function errorHandler(err: unknown, req: Request, res: Response, next: NextFunction): void {
  console.error(err);

  if (err instanceof MongooseError.ValidationError) {
    const message = Object.values(err.errors)
      .map((e) => e.message)
      .join(', ');
    res.status(400).json({ message });
    return;
  }

  if (err instanceof MongooseError.CastError) {
    res.status(400).json({ message: `Invalid ${err.path}: ${err.value}` });
    return;
  }

  if (err instanceof MongoServerError && err.code === 11000) {
    const field = Object.keys(err.keyValue || {})[0];
    res.status(409).json({ message: `Duplicate value for ${field}` });
    return;
  }

  if (err instanceof MulterError) {
    res.status(400).json({ message: err.message });
    return;
  }

  if (err instanceof HttpError) {
    res.status(err.status).json({ message: err.message });
    return;
  }

  const status = err instanceof Error && 'status' in err ? Number((err as { status: unknown }).status) : 500;
  const message = err instanceof Error ? err.message : 'Internal Server Error';
  res.status(status || 500).json({ message: message || 'Internal Server Error' });
}

export default errorHandler;
