import { Request, Response, NextFunction } from 'express';
import { HttpError } from '../utils/HttpError';
import { hashToken } from '../utils/authTokens';
import { readSessionToken } from '../utils/session';
import Session from '../models/session.model';
import User from '../models/user.model';

export async function requireAuth(req: Request, res: Response, next: NextFunction): Promise<void> {
  const token = readSessionToken(req);
  if (!token) throw new HttpError(401, 'Not signed in');

  const session = await Session.findOne({ tokenHash: hashToken(token), expiresAt: { $gt: new Date() } });
  if (!session) throw new HttpError(401, 'Session expired');

  const user = await User.findById(session.user);
  if (!user || !user.isActive) throw new HttpError(401, 'User no longer exists');

  req.user = user;
  next();
}
