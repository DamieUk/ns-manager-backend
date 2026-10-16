import 'dotenv/config';

import app from './app';
import { connectDB, DEFAULT_DATABASE_URL } from './db';

const PORT = process.env.PORT || 5001;
const DATABASE_URL = process.env.DATABASE_URL || DEFAULT_DATABASE_URL;

async function start(): Promise<void> {
  try {
    await connectDB(DATABASE_URL);
    app.listen(PORT, () => {
      console.log(`[server] listening on http://localhost:${PORT}`);
    });
  } catch (err) {
    console.error('[server] failed to start:', err instanceof Error ? err.message : err);
    process.exit(1);
  }
}

start();
