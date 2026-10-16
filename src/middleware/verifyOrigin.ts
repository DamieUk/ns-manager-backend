import { Request, Response, NextFunction } from 'express';
import { HttpError } from '../utils/HttpError';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

// CSRF defense in depth on top of the SameSite=Strict session cookie: a browser always sends
// Origin on cross-origin writes, so any write coming from a page other than the client is rejected.
// Requests without Origin (curl, server-to-server) carry no browser cookies to abuse.
export function verifyOrigin(allowedOrigin: string) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const origin = req.headers.origin;
    if (!SAFE_METHODS.has(req.method) && origin && origin !== allowedOrigin) {
      throw new HttpError(403, 'Cross-origin request blocked');
    }
    next();
  };
}
