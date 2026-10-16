import 'dotenv/config';
import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import mongoose from 'mongoose';
import User from '../models/user.model';
import { ROLE_DEFAULT_PERMISSIONS } from '../constants/permissions';

async function main(): Promise<void> {
  const [, , email, name] = process.argv;

  if (!email || !name) {
    console.error('Usage: tsx src/scripts/seedExecutive.ts <email> <"First Last">');
    console.error('  Creates the first executive account and prints a generated password (shown once).');
    process.exit(1);
  }

  const uri = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/numenor';
  await mongoose.connect(uri);

  const existing = await User.findOne({ email: email.toLowerCase() });
  if (existing) {
    console.log(`User already exists: ${existing.email} (role: ${existing.role}). No changes made.`);
    await mongoose.disconnect();
    return;
  }

  const [firstName, ...rest] = name.trim().split(/\s+/);
  const lastName = rest.join(' ') || firstName;
  const password = crypto.randomBytes(12).toString('base64url');

  const user = await User.create({
    firstName,
    lastName,
    jobTitle: 'Executive',
    phone: '—',
    address: '—',
    email,
    role: 'executive',
    permissions: ROLE_DEFAULT_PERMISSIONS.executive,
    passwordHash: await bcrypt.hash(password, 10),
    emailVerified: true,
  });

  console.log(`Created executive user ${user.email} (id: ${user._id.toString()}).`);
  console.log(`Password: ${password}`);
  console.log('Save it now — it is not stored anywhere in plain text. It can be changed later on the Users page.');
  await mongoose.disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
