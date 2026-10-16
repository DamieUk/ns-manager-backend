import { Request, Response, NextFunction } from 'express';
import { MulterError } from 'multer';
import { HttpError } from '../utils/HttpError';
import { duplicateKeyField, isDatabaseError } from '../utils/dbErrors';

export function errorHandler(err: unknown, req: Request, res: Response, next: NextFunction): void {
  console.error(err);

  const duplicate = duplicateKeyField(err);
  if (duplicate) {
    res.status(409).json({ message: `Duplicate value for ${duplicate}` });
    return;
  }

  // Database errors carry the failed SQL and its parameters — never send those to the client.
  if (isDatabaseError(err)) {
    res.status(500).json({ message: 'Internal Server Error' });
    return;
  }

  if (err instanceof MulterError) {
    res.status(400).json({ message: err.message });
    return;
  }

  if (err instanceof HttpError) {
    res.status(err.status).json({ ...err.details, message: err.message });
    return;
  }

  const status = err instanceof Error && 'status' in err ? Number((err as { status: unknown }).status) : 500;
  const message = err instanceof Error ? err.message : 'Internal Server Error';
  res.status(status || 500).json({ message: message || 'Internal Server Error' });
}

export default errorHandler;
