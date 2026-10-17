import bcrypt from 'bcryptjs';
import { Request, Response } from 'express';
import { findUserById, saveUser } from '../models/user.model';
import { leaveDays, listLeaves } from '../models/leave.model';
import { HttpError } from '../utils/HttpError';
import { MIN_PASSWORD_LENGTH } from '../utils/authTokens';
import { revokeUserSessions, startSession } from '../utils/session';

// One's own card: what the owners keep about you, and this year's approved vacation days.
export async function get(req: Request, res: Response): Promise<void> {
  const user = req.user!;
  const year = new Date().getUTCFullYear();
  const leaves = await listLeaves({ userId: user.id, statuses: ['approved'], from: new Date(Date.UTC(year, 0, 1)), to: new Date(Date.UTC(year, 11, 31)) });
  res.json({
    id: user.id,
    firstName: user.firstName,
    lastName: user.lastName,
    jobTitle: user.jobTitle,
    email: user.email,
    phone: user.phone,
    address: user.address,
    role: user.role,
    status: user.status,
    avatarUrl: user.avatarUrl ?? null,
    createdAt: user.createdAt,
    vacationDaysThisYear: leaves.filter((l) => l.kind === 'vacation').reduce((sum, l) => sum + leaveDays(l), 0),
  });
}

// Everyone keeps their own phone and address up to date; name, job title and role are the owners'.
export async function update(req: Request, res: Response): Promise<void> {
  const user = await findUserById(req.user!.id);
  if (!user) throw new HttpError(404, 'User not found');
  const { phone, address } = req.body as { phone?: unknown; address?: unknown };
  if (phone !== undefined) {
    if (typeof phone !== 'string' || !phone.trim()) throw new HttpError(400, 'Вкажіть телефон');
    user.phone = phone.trim();
  }
  if (address !== undefined) {
    if (typeof address !== 'string' || !address.trim()) throw new HttpError(400, 'Вкажіть адресу');
    user.address = address.trim();
  }
  await saveUser(user);
  res.status(204).send();
}

// Changing one's password signs out every other session; this browser gets a fresh one.
export async function changePassword(req: Request, res: Response): Promise<void> {
  const user = await findUserById(req.user!.id);
  if (!user || !user.passwordHash) throw new HttpError(404, 'User not found');
  const { currentPassword, newPassword } = req.body as { currentPassword?: unknown; newPassword?: unknown };
  if (typeof currentPassword !== 'string' || !(await bcrypt.compare(currentPassword, user.passwordHash))) {
    throw new HttpError(400, 'Поточний пароль невірний');
  }
  if (typeof newPassword !== 'string' || newPassword.length < MIN_PASSWORD_LENGTH) {
    throw new HttpError(400, `Пароль має містити щонайменше ${MIN_PASSWORD_LENGTH} символів`);
  }
  user.passwordHash = await bcrypt.hash(newPassword, 10);
  await saveUser(user);
  await revokeUserSessions(user.id);
  await startSession(res, user.id);
  res.status(204).send();
}
