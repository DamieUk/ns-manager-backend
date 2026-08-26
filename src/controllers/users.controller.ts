import { Request, Response } from 'express';
import User from '../models/user.model';
import { HttpError } from '../utils/HttpError';
import { canManageRole, ROLES, ROLE_DEFAULT_PERMISSIONS, Role, Permission } from '../constants/permissions';
import { generateToken, tokenExpiryDate, ACTIVATION_TOKEN_TTL_MS } from '../utils/authTokens';
import { sendInviteEmail } from '../config/mailer';

export async function listUsers(req: Request, res: Response): Promise<void> {
  const users = await User.find().sort({ createdAt: -1 });
  res.json(users.map(toUserResponse));
}

export async function getUserById(req: Request, res: Response): Promise<void> {
  const user = await User.findById(req.params.id);
  if (!user) throw new HttpError(404, 'User not found');
  res.json(toUserResponse(user));
}

export async function createUser(req: Request, res: Response): Promise<void> {
  const { name, email, googleEmail, role, permissions } = req.body as {
    name?: string;
    email?: string;
    googleEmail?: string;
    role?: Role;
    permissions?: Permission[];
  };

  if (!name || !email) throw new HttpError(400, 'name and email are required');
  if (!role || !ROLES.includes(role)) throw new HttpError(400, 'Invalid role');
  if (!canManageRole(req.user!.role, role)) throw new HttpError(403, 'Insufficient role to create this account');

  const resolvedGoogleEmail = (googleEmail || email).toLowerCase();

  const existing = await User.findOne({
    $or: [{ email: email.toLowerCase() }, { googleEmail: resolvedGoogleEmail }],
  });
  if (existing) throw new HttpError(409, 'A user with this email or Google email already exists');

  const user = await User.create({
    name,
    email,
    googleEmail: resolvedGoogleEmail,
    role,
    permissions: permissions ?? ROLE_DEFAULT_PERMISSIONS[role],
  });

  const { raw, hash } = generateToken();
  user.passwordTokenHash = hash;
  user.passwordTokenExpires = tokenExpiryDate(ACTIVATION_TOKEN_TTL_MS);
  await user.save();

  const activationUrl = `${process.env.CLIENT_ORIGIN || 'http://localhost:5173'}/accept-invite?token=${raw}`;
  try {
    await sendInviteEmail(user.email, user.name, activationUrl);
  } catch (err) {
    console.error(`[createUser] invite email failed for ${user.email}`, err);
  }

  res.status(201).json(toUserResponse(user));
}

export async function updateUser(req: Request, res: Response): Promise<void> {
  const user = await User.findById(req.params.id);
  if (!user) throw new HttpError(404, 'User not found');

  const { name, googleEmail, role, permissions, isActive } = req.body as {
    name?: string;
    googleEmail?: string;
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

  if (name !== undefined) user.name = name;
  if (googleEmail !== undefined) user.googleEmail = googleEmail.toLowerCase();
  if (permissions !== undefined) user.permissions = permissions;
  if (isActive !== undefined) user.isActive = isActive;

  await user.save();
  res.json(toUserResponse(user));
}

export async function deleteUser(req: Request, res: Response): Promise<void> {
  const user = await User.findById(req.params.id);
  if (!user) throw new HttpError(404, 'User not found');

  if (user._id.equals(req.user!._id)) throw new HttpError(400, 'Cannot delete your own account');
  if (!canManageRole(req.user!.role, user.role)) throw new HttpError(403, 'Insufficient role to delete this account');

  await user.deleteOne();
  res.status(204).send();
}

function toUserResponse(user: InstanceType<typeof User>) {
  return {
    id: user._id.toString(),
    name: user.name,
    email: user.email,
    googleEmail: user.googleEmail,
    role: user.role,
    permissions: user.permissions,
    avatarUrl: user.avatarUrl ?? null,
    isActive: user.isActive,
    createdAt: user.createdAt,
  };
}
