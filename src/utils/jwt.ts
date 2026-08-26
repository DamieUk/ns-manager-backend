import jwt from 'jsonwebtoken';
import { UserDocument } from '../models/user.model';
import { Role, Permission } from '../constants/permissions';

export interface JwtPayload {
  sub: string;
  role: Role;
  permissions: Permission[];
}

function getJwtSecret(): string {
  const secret = process.env.JWT_SECRET;
  if (!secret) throw new Error('JWT_SECRET is not set');
  return secret;
}

export function signToken(user: UserDocument): string {
  const payload: JwtPayload = {
    sub: user._id.toString(),
    role: user.role,
    permissions: user.permissions,
  };
  const expiresIn = (process.env.JWT_EXPIRES_IN || '12h') as jwt.SignOptions['expiresIn'];
  return jwt.sign(payload, getJwtSecret(), { expiresIn });
}

export function verifyToken(token: string): JwtPayload {
  return jwt.verify(token, getJwtSecret()) as JwtPayload;
}
