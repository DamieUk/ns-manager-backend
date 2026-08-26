import 'dotenv/config';

import app from './app';
import connectDB from './config/db';

const PORT = process.env.PORT || 5001;
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/numenor';

async function start(): Promise<void> {
  try {
    await connectDB(MONGODB_URI);
    app.listen(PORT, () => {
      console.log(`[server] listening on http://localhost:${PORT}`);
    });
  } catch (err) {
    console.error('[server] failed to start:', err instanceof Error ? err.message : err);
    process.exit(1);
  }
}

start();
