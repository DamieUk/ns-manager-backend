import { Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import User, { UserDocument } from '../models/user.model';
import { HttpError } from '../utils/HttpError';
import {
  generateToken,
  hashToken,
  tokenExpiryDate,
  ACTIVATION_TOKEN_TTL_MS,
  RESET_TOKEN_TTL_MS,
  MIN_PASSWORD_LENGTH,
} from '../utils/authTokens';
import { startSession, endSession, revokeUserSessions } from '../utils/session';
import { sendInviteEmail, sendPasswordResetEmail } from '../config/mailer';

const CLIENT_ORIGIN = process.env.CLIENT_ORIGIN || 'http://localhost:5173';

// Precomputed once so `login`'s "user not found" / "no password set" short-circuit
// paths can still run a bcrypt.compare of the same cost — otherwise those paths
// return near-instantly while a real mismatch takes ~100ms, leaking via timing
// whether a given email exists at all.
const DUMMY_HASH = bcrypt.hashSync('dummy-password-for-timing-normalization', 10);

function toAuthUser(user: UserDocument) {
  return {
    id: user._id.toString(),
    name: `${user.firstName} ${user.lastName}`,
    email: user.email,
    role: user.role,
    permissions: user.permissions,
    avatarUrl: user.avatarUrl ?? null,
    createdAt: user.createdAt,
  };
}

export function me(req: Request, res: Response): void {
  res.json(toAuthUser(req.user!));
}

export async function login(req: Request, res: Response): Promise<void> {
  const { email, password } = req.body as { email?: string; password?: string };
  if (!email || !password) throw new HttpError(400, 'email and password are required');

  const user = await User.findOne({ email: email.toLowerCase() }).select('+passwordHash');

  if (!user || !user.isActive || !user.passwordHash) {
    await bcrypt.compare(password, DUMMY_HASH);
    throw new HttpError(401, 'Невірний email або пароль');
  }

  const valid = await bcrypt.compare(password, user.passwordHash);
  if (!valid) throw new HttpError(401, 'Невірний email або пароль');

  await startSession(res, user._id);
  res.json(toAuthUser(user));
}

export async function logout(req: Request, res: Response): Promise<void> {
  await endSession(req, res);
  res.status(204).send();
}

async function applyPasswordFromToken(rawToken: string, newPassword: string): Promise<boolean> {
  if (newPassword.length < MIN_PASSWORD_LENGTH) {
    throw new HttpError(400, `Пароль має містити щонайменше ${MIN_PASSWORD_LENGTH} символів`);
  }

  const hash = hashToken(rawToken);
  const user = await User.findOne({ passwordTokenHash: hash, passwordTokenExpires: { $gt: new Date() } }).select(
    '+passwordTokenHash'
  );
  if (!user) return false;

  user.passwordHash = await bcrypt.hash(newPassword, 10);
  user.emailVerified = true;
  user.passwordTokenHash = undefined;
  user.passwordTokenExpires = undefined;
  await user.save();
  await revokeUserSessions(user._id);
  return true;
}

export async function acceptInvite(req: Request, res: Response): Promise<void> {
  const { token, password } = req.body as { token?: string; password?: string };
  if (!token || !password) throw new HttpError(400, 'token and password are required');

  const applied = await applyPasswordFromToken(token, password);
  if (!applied) throw new HttpError(400, 'Посилання недійсне або застаріло');

  res.json({ message: 'ok' });
}

export async function resetPassword(req: Request, res: Response): Promise<void> {
  const { token, password } = req.body as { token?: string; password?: string };
  if (!token || !password) throw new HttpError(400, 'token and password are required');

  const applied = await applyPasswordFromToken(token, password);
  if (!applied) throw new HttpError(400, 'Посилання недійсне або застаріло');

  res.json({ message: 'ok' });
}

export async function forgotPassword(req: Request, res: Response): Promise<void> {
  const { email } = req.body as { email?: string };
  const genericResponse = { message: 'Якщо такий email існує, на нього надіслано лист' };

  if (!email) {
    res.json(genericResponse);
    return;
  }

  try {
    const user = await User.findOne({ email: email.toLowerCase(), isActive: true }).select('+passwordHash');
    if (user) {
      const { raw, hash } = generateToken();
      const isFirstActivation = !user.passwordHash;

      user.passwordTokenHash = hash;
      user.passwordTokenExpires = tokenExpiryDate(isFirstActivation ? ACTIVATION_TOKEN_TTL_MS : RESET_TOKEN_TTL_MS);
      await user.save();

      const fullName = `${user.firstName} ${user.lastName}`;
      if (isFirstActivation) {
        const url = `${CLIENT_ORIGIN}/accept-invite?token=${raw}`;
        await sendInviteEmail(user.email, fullName, url);
      } else {
        const url = `${CLIENT_ORIGIN}/reset-password?token=${raw}`;
        await sendPasswordResetEmail(user.email, fullName, url);
      }
    }
  } catch (err) {
    console.error('[forgotPassword] failed', err);
  }

  res.json(genericResponse);
}
