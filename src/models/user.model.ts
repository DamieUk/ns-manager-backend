import { Schema, model, HydratedDocument } from 'mongoose';
import { ROLES, PERMISSION_KEYS, PERMISSION_ACTIONS, Role, Permission } from '../constants/permissions';
import { encryptField, decryptField } from '../utils/fieldEncryption';

export const USER_STATUSES = ['working', 'fired', 'vacation'] as const;
export type UserStatus = (typeof USER_STATUSES)[number];

export interface IUser {
  firstName: string;
  lastName: string;
  jobTitle: string;
  phone: string;
  address: string;
  status: UserStatus;
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
    firstName: { type: String, required: true, set: (v?: string) => encryptField(v?.trim()), get: decryptField },
    lastName: { type: String, required: true, set: (v?: string) => encryptField(v?.trim()), get: decryptField },
    jobTitle: { type: String, required: true, set: (v?: string) => encryptField(v?.trim()), get: decryptField },
    phone: { type: String, required: true, set: (v?: string) => encryptField(v?.trim()), get: decryptField },
    address: { type: String, required: true, set: (v?: string) => encryptField(v?.trim()), get: decryptField },
    status: { type: String, enum: USER_STATUSES, required: true, default: 'working' },
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
  { timestamps: true, toJSON: { getters: true }, toObject: { getters: true } }
);

export default model<IUser>('User', userSchema);
