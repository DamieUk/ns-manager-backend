import { Request, Response, NextFunction } from 'express';
import { HttpError } from '../utils/HttpError';
import { ACTION_RANK, PermissionAction, PermissionKey } from '../constants/permissions';

export function requirePermission(key: PermissionKey, minAction: PermissionAction) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const entry = req.user?.permissions.find((p) => p.key === key);
    const actual: PermissionAction = entry?.action ?? 'none';

    if (ACTION_RANK[actual] < ACTION_RANK[minAction]) {
      throw new HttpError(403, `Requires ${key}:${minAction} permission`);
    }
    next();
  };
}
