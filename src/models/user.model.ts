import { and, desc, eq, gt, inArray } from 'drizzle-orm';
import { db } from '../db';
import { users } from '../db/schema';
import { newId } from '../db/ids';
import { ROLES, PERMISSION_KEYS, PERMISSION_ACTIONS, Role, Permission } from '../constants/permissions';
import { encryptField, decryptField } from '../utils/fieldEncryption';
import { castId, castString, Validator } from '../utils/validate';

export const USER_STATUSES = ['working', 'fired', 'vacation', 'deleted'] as const;
export type UserStatus = (typeof USER_STATUSES)[number];

export interface User {
  id: string;
  firstName: string;
  lastName: string;
  jobTitle: string;
  phone: string;
  address: string;
  status: UserStatus;
  email: string;
  role: Role;
  permissions: Permission[];
  avatarUrl?: string;
  isActive: boolean;
  passwordHash?: string;
  emailVerified: boolean;
  passwordTokenHash?: string;
  passwordTokenExpires?: Date;
  createdAt: Date;
  updatedAt: Date;
}

export type NewUser = Pick<User, 'firstName' | 'lastName' | 'jobTitle' | 'phone' | 'address' | 'email' | 'role'> &
  Partial<Pick<User, 'status' | 'permissions' | 'passwordHash' | 'emailVerified'>>;

type Row = typeof users.$inferSelect;

function fromRow(row: Row): User {
  return {
    id: row.id,
    firstName: decryptField(row.firstName) ?? '',
    lastName: decryptField(row.lastName) ?? '',
    jobTitle: decryptField(row.jobTitle) ?? '',
    phone: decryptField(row.phone) ?? '',
    address: decryptField(row.address) ?? '',
    status: row.status as UserStatus,
    email: row.email,
    role: row.role as Role,
    permissions: JSON.parse(row.permissions) as Permission[],
    avatarUrl: row.avatarUrl ?? undefined,
    isActive: row.isActive,
    passwordHash: row.passwordHash ?? undefined,
    emailVerified: row.emailVerified,
    passwordTokenHash: row.passwordTokenHash ?? undefined,
    passwordTokenExpires: row.passwordTokenExpires ?? undefined,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

// Applies the field normalization (trim, lower-case email) and validation, then returns the
// column values with sensitive fields encrypted.
function toColumns(user: Omit<User, 'id' | 'createdAt' | 'updatedAt'>) {
  user.firstName = castString(user.firstName)?.trim() as string;
  user.lastName = castString(user.lastName)?.trim() as string;
  user.jobTitle = castString(user.jobTitle)?.trim() as string;
  user.phone = castString(user.phone)?.trim() as string;
  user.address = castString(user.address)?.trim() as string;
  user.email = castString(user.email)?.trim().toLowerCase() as string;
  user.permissions = (user.permissions ?? []).map((p) => ({ key: p?.key, action: p?.action }));

  const v = new Validator()
    .required(user.firstName, 'firstName')
    .required(user.lastName, 'lastName')
    .required(user.jobTitle, 'jobTitle')
    .required(user.phone, 'phone')
    .required(user.address, 'address')
    .required(user.status, 'status')
    .oneOf(user.status, USER_STATUSES, 'status')
    .required(user.email, 'email')
    .required(user.role, 'role')
    .oneOf(user.role, ROLES, 'role');
  for (const p of user.permissions) v.required(p.key, 'key').oneOf(p.key, PERMISSION_KEYS, 'key').required(p.action, 'action').oneOf(p.action, PERMISSION_ACTIONS, 'action');
  v.check();

  return {
    firstName: encryptField(user.firstName)!,
    lastName: encryptField(user.lastName)!,
    jobTitle: encryptField(user.jobTitle)!,
    phone: encryptField(user.phone)!,
    address: encryptField(user.address)!,
    status: user.status,
    email: user.email,
    role: user.role,
    permissions: JSON.stringify(user.permissions),
    avatarUrl: user.avatarUrl ?? null,
    isActive: user.isActive,
    passwordHash: user.passwordHash ?? null,
    emailVerified: user.emailVerified,
    passwordTokenHash: user.passwordTokenHash ?? null,
    passwordTokenExpires: user.passwordTokenExpires ?? null,
  };
}

export async function findUserById(id: unknown): Promise<User | null> {
  const [row] = await db().select().from(users).where(eq(users.id, castId(id)));
  return row ? fromRow(row) : null;
}

export async function findUserByEmail(email: string, opts: { activeOnly?: boolean } = {}): Promise<User | null> {
  const conditions = [eq(users.email, email.toLowerCase())];
  if (opts.activeOnly) conditions.push(eq(users.isActive, true));
  const [row] = await db().select().from(users).where(and(...conditions));
  return row ? fromRow(row) : null;
}

export async function findUserByPasswordToken(tokenHash: string): Promise<User | null> {
  const [row] = await db()
    .select()
    .from(users)
    .where(and(eq(users.passwordTokenHash, tokenHash), gt(users.passwordTokenExpires, new Date())));
  return row ? fromRow(row) : null;
}

export async function listUsers(): Promise<User[]> {
  const rows = await db().select().from(users).orderBy(desc(users.createdAt), desc(users.id));
  return rows.map(fromRow);
}

export async function findUsersByIds(ids: string[], opts: { role?: Role } = {}): Promise<User[]> {
  if (ids.length === 0) return [];
  const conditions = [inArray(users.id, ids)];
  if (opts.role) conditions.push(eq(users.role, opts.role));
  const rows = await db().select().from(users).where(and(...conditions));
  return rows.map(fromRow);
}

export async function createUser(input: NewUser): Promise<User> {
  const now = new Date();
  const user: User = {
    id: newId(),
    status: 'working',
    permissions: [],
    isActive: true,
    emailVerified: false,
    ...input,
    createdAt: now,
    updatedAt: now,
  };
  await db().insert(users).values({ id: user.id, ...toColumns(user), createdAt: now, updatedAt: now });
  return user;
}

export async function saveUser(user: User): Promise<void> {
  user.updatedAt = new Date();
  await db().update(users).set({ ...toColumns(user), updatedAt: user.updatedAt }).where(eq(users.id, user.id));
}

export async function deleteUser(id: string): Promise<void> {
  await db().delete(users).where(eq(users.id, id));
}

// A user as embedded in other records' responses (order manager/employees).
export function userRefJson(user: User) {
  return { _id: user.id, firstName: user.firstName, lastName: user.lastName, id: user.id };
}
