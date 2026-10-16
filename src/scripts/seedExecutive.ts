import 'dotenv/config';
import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import { connectDB, disconnectDB, DEFAULT_DATABASE_URL } from '../db';
import { createUser, findUserByEmail } from '../models/user.model';
import { ROLE_DEFAULT_PERMISSIONS } from '../constants/permissions';

async function main(): Promise<void> {
  const [, , email, name] = process.argv;

  if (!email || !name) {
    console.error('Usage: tsx src/scripts/seedExecutive.ts <email> <"First Last">');
    console.error('  Creates the first executive account and prints a generated password (shown once).');
    process.exit(1);
  }

  await connectDB(process.env.DATABASE_URL || DEFAULT_DATABASE_URL);

  const existing = await findUserByEmail(email);
  if (existing) {
    console.log(`User already exists: ${existing.email} (role: ${existing.role}). No changes made.`);
    await disconnectDB();
    return;
  }

  const [firstName, ...rest] = name.trim().split(/\s+/);
  const lastName = rest.join(' ') || firstName;
  const password = crypto.randomBytes(12).toString('base64url');

  const user = await createUser({
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

  console.log(`Created executive user ${user.email} (id: ${user.id}).`);
  console.log(`Password: ${password}`);
  console.log('Save it now — it is not stored anywhere in plain text. It can be changed later on the Users page.');
  await disconnectDB();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
