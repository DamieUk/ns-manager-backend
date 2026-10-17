import bcrypt from 'bcryptjs';
import { Request, Response } from 'express';
import { createUser as insertUser, deleteUser as removeUser, findUserByEmail, findUserById, listUsers as findAllUsers, saveUser, User, USER_STATUSES, UserStatus } from '../models/user.model';
import { deleteEmployeeEntries } from '../models/dailyProgress.model';
import { deleteUserLeaves, listLeaves } from '../models/leave.model';
import { normalizeToUTCMidnight } from '../utils/normalizeDate';
import { HttpError } from '../utils/HttpError';
import { canManageRole, ROLES, ROLE_DEFAULT_PERMISSIONS, Role, Permission } from '../constants/permissions';
import { generateToken, tokenExpiryDate, ACTIVATION_TOKEN_TTL_MS, MIN_PASSWORD_LENGTH } from '../utils/authTokens';
import { sendInviteEmail } from '../config/mailer';
import { revokeUserSessions } from '../utils/session';

// Each user with the end of the approved leave they are on today, if any.
export async function listUsers(req: Request, res: Response): Promise<void> {
  const today = normalizeToUTCMidnight(new Date());
  const [users, away] = await Promise.all([findAllUsers(), listLeaves({ statuses: ['approved'], from: today, to: today })]);
  res.json(
    users.map((u) => {
      const leave = away.find((l) => l.userId === u.id);
      return { ...toUserResponse(u), onLeave: leave ? { kind: leave.kind, until: leave.endDate } : null };
    })
  );
}

export async function getUserById(req: Request, res: Response): Promise<void> {
  const user = await findUserById(req.params.id);
  if (!user) throw new HttpError(404, 'User not found');
  res.json(toUserResponse(user));
}

export async function createUser(req: Request, res: Response): Promise<void> {
  const { firstName, lastName, jobTitle, phone, address, status, email, role, permissions } =
    req.body as {
      firstName?: string;
      lastName?: string;
      jobTitle?: string;
      phone?: string;
      address?: string;
      status?: UserStatus;
      email?: string;
      role?: Role;
      permissions?: Permission[];
    };

  if (!firstName?.trim() || !lastName?.trim()) throw new HttpError(400, 'firstName and lastName are required');
  if (!jobTitle?.trim()) throw new HttpError(400, 'jobTitle is required');
  if (!phone?.trim()) throw new HttpError(400, 'phone is required');
  if (!address?.trim()) throw new HttpError(400, 'address is required');
  if (!email) throw new HttpError(400, 'email is required');
  if (status && !USER_STATUSES.includes(status)) throw new HttpError(400, 'Invalid status');
  if (!role || !ROLES.includes(role)) throw new HttpError(400, 'Invalid role');
  if (!canManageRole(req.user!.role, role)) throw new HttpError(403, 'Insufficient role to create this account');

  const existing = await findUserByEmail(email);
  if (existing) throw new HttpError(409, 'A user with this email already exists');

  const user = await insertUser({
    firstName: firstName!,
    lastName: lastName!,
    jobTitle: jobTitle!,
    phone: phone!,
    address: address!,
    status: status || 'working',
    email,
    role,
    permissions: permissions ?? ROLE_DEFAULT_PERMISSIONS[role],
  });

  const { raw, hash } = generateToken();
  user.passwordTokenHash = hash;
  user.passwordTokenExpires = tokenExpiryDate(ACTIVATION_TOKEN_TTL_MS);
  await saveUser(user);

  const activationUrl = `${process.env.CLIENT_ORIGIN || 'http://localhost:5173'}/accept-invite?token=${raw}`;
  try {
    await sendInviteEmail(user.email, `${user.firstName} ${user.lastName}`, activationUrl);
  } catch (err) {
    console.error(`[createUser] invite email failed for ${user.email}`, err);
  }

  res.status(201).json(toUserResponse(user));
}

export async function updateUser(req: Request, res: Response): Promise<void> {
  const user = await findUserById(req.params.id);
  if (!user) throw new HttpError(404, 'User not found');

  const { firstName, lastName, jobTitle, phone, address, status, role, permissions, isActive } =
    req.body as {
      firstName?: string;
      lastName?: string;
      jobTitle?: string;
      phone?: string;
      address?: string;
      status?: UserStatus;
      role?: Role;
      permissions?: Permission[];
      isActive?: boolean;
    };

  if (!canManageRole(req.user!.role, user.role)) throw new HttpError(403, 'Insufficient role to edit this account');

  if (role && role !== user.role) {
    if (!ROLES.includes(role)) throw new HttpError(400, 'Invalid role');
    if (!canManageRole(req.user!.role, role)) throw new HttpError(403, 'Insufficient role to assign this role');
    user.role = role;
  }

  if (firstName !== undefined) user.firstName = firstName;
  if (lastName !== undefined) user.lastName = lastName;
  if (jobTitle !== undefined) user.jobTitle = jobTitle;
  if (phone !== undefined) user.phone = phone;
  if (address !== undefined) user.address = address;
  if (status !== undefined) {
    if (!USER_STATUSES.includes(status)) throw new HttpError(400, 'Invalid status');
    const wasDeleted = user.status === 'deleted';
    user.status = status;
    // Deleting/restoring via status implicitly gates login, unless the caller also sets isActive explicitly.
    if (isActive === undefined) {
      if (status === 'deleted') user.isActive = false;
      else if (wasDeleted) user.isActive = true;
    }
  }
  if (permissions !== undefined) user.permissions = permissions;
  if (isActive !== undefined) user.isActive = isActive;

  await saveUser(user);
  if (!user.isActive) await revokeUserSessions(user.id);
  res.json(toUserResponse(user));
}

export async function setPassword(req: Request, res: Response): Promise<void> {
  const user = await findUserById(req.params.id);
  if (!user) throw new HttpError(404, 'User not found');

  if (!canManageRole(req.user!.role, user.role)) throw new HttpError(403, 'Insufficient role to reset this account');

  const { password } = req.body as { password?: string };
  if (!password || password.length < MIN_PASSWORD_LENGTH) {
    throw new HttpError(400, `Пароль має містити щонайменше ${MIN_PASSWORD_LENGTH} символів`);
  }

  user.passwordHash = await bcrypt.hash(password, 10);
  user.emailVerified = true;
  user.passwordTokenHash = undefined;
  user.passwordTokenExpires = undefined;
  await saveUser(user);
  await revokeUserSessions(user.id);

  res.json({ message: 'ok' });
}

export async function deleteUser(req: Request, res: Response): Promise<void> {
  const user = await findUserById(req.params.id);
  if (!user) throw new HttpError(404, 'User not found');

  if (user.id === req.user!.id) throw new HttpError(400, 'Cannot delete your own account');
  if (!canManageRole(req.user!.role, user.role)) throw new HttpError(403, 'Insufficient role to delete this account');

  // Two-step deletion: mark the account `status: 'deleted'` first (keeps daily-progress history
  // intact and blocks login) — only a user already in that state can be purged permanently here.
  if (user.status !== 'deleted') {
    throw new HttpError(400, 'Set status to "deleted" before permanently deleting this account');
  }

  await deleteEmployeeEntries(user.id);
  await deleteUserLeaves(user.id);
  await revokeUserSessions(user.id);
  await removeUser(user.id);
  res.status(204).send();
}

function toUserResponse(user: User) {
  return {
    id: user.id,
    firstName: user.firstName,
    lastName: user.lastName,
    jobTitle: user.jobTitle,
    phone: user.phone,
    address: user.address,
    status: user.status,
    email: user.email,
    role: user.role,
    permissions: user.permissions,
    avatarUrl: user.avatarUrl ?? null,
    isActive: user.isActive,
    createdAt: user.createdAt,
  };
}
