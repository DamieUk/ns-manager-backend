import { Schema, model, HydratedDocument } from 'mongoose';
import { ROLES, PERMISSION_KEYS, PERMISSION_ACTIONS, Role, Permission } from '../constants/permissions';

export interface IUser {
  name: string;
  email: string;
  googleEmail: string;
  role: Role;
  permissions: Permission[];
  googleId?: string;
  avatarUrl?: string;
  isActive: boolean;
  passwordHash?: string;
  emailVerified: boolean;
  passwordTokenHash?: string;
  passwordTokenExpires?: Date;
  createdAt?: Date;
  updatedAt?: Date;
}

export type UserDocument = HydratedDocument<IUser>;

const permissionSchema = new Schema<Permission>(
  {
    key: { type: String, enum: PERMISSION_KEYS, required: true },
    action: { type: String, enum: PERMISSION_ACTIONS, required: true },
  },
  { _id: false }
);

const userSchema = new Schema<IUser>(
  {
    name: { type: String, required: true, trim: true },
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    googleEmail: { type: String, required: true, unique: true, lowercase: true, trim: true },
    role: { type: String, enum: ROLES, required: true, default: 'employee' },
    permissions: { type: [permissionSchema], default: [] },
    googleId: { type: String, unique: true, sparse: true },
    avatarUrl: { type: String },
    isActive: { type: Boolean, default: true },
    passwordHash: { type: String, select: false },
    emailVerified: { type: Boolean, default: false },
    passwordTokenHash: { type: String, select: false, index: true },
    passwordTokenExpires: { type: Date },
  },
  { timestamps: true }
);

export default model<IUser>('User', userSchema);
