import { Request, Response, CookieOptions } from 'express';
import { createSession, deleteSession, deleteUserSessions } from '../models/session.model';
import { generateToken, hashToken, tokenExpiryDate } from './authTokens';

export const SESSION_COOKIE = 'numenor_session';

const SESSION_TTL_MS = (Number(process.env.SESSION_TTL_HOURS) || 12) * 60 * 60 * 1000;

// httpOnly keeps the token away from page scripts; SameSite=Strict stops other sites from
// riding the cookie (CSRF); path=/api means it is only ever sent to the API.
const cookieOptions: CookieOptions = {
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: 'strict',
  path: '/api',
};

export function readSessionToken(req: Request): string | undefined {
  const value: unknown = req.cookies?.[SESSION_COOKIE];
  return typeof value === 'string' && value ? value : undefined;
}

export async function startSession(res: Response, userId: string): Promise<void> {
  const { raw, hash } = generateToken();
  await createSession({ tokenHash: hash, userId, expiresAt: tokenExpiryDate(SESSION_TTL_MS) });
  res.cookie(SESSION_COOKIE, raw, { ...cookieOptions, maxAge: SESSION_TTL_MS });
}

export async function endSession(req: Request, res: Response): Promise<void> {
  const token = readSessionToken(req);
  if (token) await deleteSession(hashToken(token));
  res.clearCookie(SESSION_COOKIE, cookieOptions);
}

// Signs the user out everywhere — after a password change, deactivation or deletion.
export async function revokeUserSessions(userId: string): Promise<void> {
  await deleteUserSessions(userId);
}
