import { Request, Response, NextFunction } from 'express';
import passport from '../config/passport';
import { signToken } from '../utils/jwt';
import { UserDocument } from '../models/user.model';

// `@types/passport-google-oauth20` types `state` as a string (custom payload),
// but passport-oauth2's actual runtime behavior treats `state: true` as "generate
// and verify CSRF state via the session" — a real capability the types don't model.
export const startGoogleAuth = passport.authenticate('google', {
  scope: ['profile', 'email'],
  session: false,
  state: true,
} as unknown as Parameters<typeof passport.authenticate>[1]);

export function handleGoogleCallback(req: Request, res: Response, next: NextFunction): void {
  const clientOrigin = process.env.CLIENT_ORIGIN || 'http://localhost:5173';

  passport.authenticate(
    'google',
    { session: false, state: true } as unknown as Parameters<typeof passport.authenticate>[1],
    (err: unknown, user: UserDocument | false, info?: { message?: string }) => {
      if (err) {
        next(err);
        return;
      }

      if (!user) {
        res.redirect(`${clientOrigin}/auth/callback#error=${info?.message || 'auth_failed'}`);
        return;
      }

      const token = signToken(user);
      res.redirect(`${clientOrigin}/auth/callback#token=${token}`);
    }
  )(req, res, next);
}

export function me(req: Request, res: Response): void {
  const user = req.user!;
  res.json({
    id: user._id.toString(),
    name: user.name,
    email: user.email,
    role: user.role,
    permissions: user.permissions,
    avatarUrl: user.avatarUrl ?? null,
    createdAt: user.createdAt,
  });
}
