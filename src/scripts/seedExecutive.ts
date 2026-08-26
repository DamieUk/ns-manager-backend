import 'dotenv/config';
import mongoose from 'mongoose';
import User from '../models/user.model';
import { ROLE_DEFAULT_PERMISSIONS } from '../constants/permissions';

async function main(): Promise<void> {
  const [, , email, name] = process.argv;

  if (!email || !name) {
    console.error('Usage: tsx src/scripts/seedExecutive.ts <email> <name>');
    process.exit(1);
  }

  const uri = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/numenor';
  await mongoose.connect(uri);

  const existing = await User.findOne({ email: email.toLowerCase() });
  if (existing) {
    console.log(`User ${email} already exists (role: ${existing.role}). No changes made.`);
    await mongoose.disconnect();
    return;
  }

  const user = await User.create({
    name,
    email,
    role: 'executive',
    permissions: ROLE_DEFAULT_PERMISSIONS.executive,
  });

  console.log(`Created executive user ${user.email} (id: ${user._id.toString()}).`);
  await mongoose.disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
