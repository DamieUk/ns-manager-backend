import 'dotenv/config';
import mongoose from 'mongoose';
import User from '../models/user.model';
import { ROLE_DEFAULT_PERMISSIONS } from '../constants/permissions';

async function main(): Promise<void> {
  const [, , email, name, googleEmail] = process.argv;

  if (!email || !name) {
    console.error('Usage: tsx src/scripts/seedExecutive.ts <email> <name> [googleEmail]');
    console.error('  email       — business/contact email shown in the app');
    console.error('  googleEmail — the Google account used to log in (defaults to <email> if omitted)');
    process.exit(1);
  }

  const uri = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/numenor';
  await mongoose.connect(uri);

  const resolvedGoogleEmail = (googleEmail || email).toLowerCase();

  const existing = await User.findOne({
    $or: [{ email: email.toLowerCase() }, { googleEmail: resolvedGoogleEmail }],
  });
  if (existing) {
    console.log(`User already exists: ${existing.email} / login ${existing.googleEmail} (role: ${existing.role}). No changes made.`);
    await mongoose.disconnect();
    return;
  }

  const user = await User.create({
    name,
    email,
    googleEmail: resolvedGoogleEmail,
    role: 'executive',
    permissions: ROLE_DEFAULT_PERMISSIONS.executive,
  });

  console.log(`Created executive user ${user.email} (login via ${user.googleEmail}, id: ${user._id.toString()}).`);
  await mongoose.disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
