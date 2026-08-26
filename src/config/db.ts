import mongoose from 'mongoose';

export async function connectDB(uri: string): Promise<void> {
  mongoose.connection.on('connected', () => {
    console.log('[mongo] connected');
  });
  mongoose.connection.on('error', (err: Error) => {
    console.error('[mongo] connection error:', err.message);
  });

  await mongoose.connect(uri);
}

export default connectDB;
