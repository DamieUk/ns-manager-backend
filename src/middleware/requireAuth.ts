import { Request, Response, NextFunction } from 'express';
import { HttpError } from '../utils/HttpError';
import { verifyToken } from '../utils/jwt';
import User from '../models/user.model';

export async function requireAuth(req: Request, res: Response, next: NextFunction): Promise<void> {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) {
    throw new HttpError(401, 'Missing or malformed Authorization header');
  }

  const token = header.slice('Bearer '.length);

  let payload;
  try {
    payload = verifyToken(token);
  } catch {
    throw new HttpError(401, 'Invalid or expired token');
  }

  const user = await User.findById(payload.sub);
  if (!user || !user.isActive) {
    throw new HttpError(401, 'User no longer exists');
  }

  req.user = user;
  next();
}
