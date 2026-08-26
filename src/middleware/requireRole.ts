import { Request, Response, NextFunction } from 'express';
import { HttpError } from '../utils/HttpError';
import { Role } from '../constants/permissions';

export function requireRole(...roles: Role[]) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!req.user || !roles.includes(req.user.role)) {
      throw new HttpError(403, 'Insufficient role');
    }
    next();
  };
}
