import { Request, Response, NextFunction } from 'express';
import { HttpError } from '../utils/HttpError';
import { hashToken } from '../utils/authTokens';
import { readSessionToken } from '../utils/session';
import { findValidSession } from '../models/session.model';
import { findUserById } from '../models/user.model';

export async function requireAuth(req: Request, res: Response, next: NextFunction): Promise<void> {
  const token = readSessionToken(req);
  if (!token) throw new HttpError(401, 'Not signed in');

  const session = await findValidSession(hashToken(token));
  if (!session) throw new HttpError(401, 'Session expired');

  const user = await findUserById(session.userId);
  if (!user || !user.isActive) throw new HttpError(401, 'User no longer exists');

  req.user = user;
  next();
}
