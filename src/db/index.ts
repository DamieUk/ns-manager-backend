import path from 'path';
import mysql from 'mysql2/promise';
import { drizzle, MySql2Database } from 'drizzle-orm/mysql2';
import { migrate } from 'drizzle-orm/mysql2/migrator';

const MIGRATIONS_DIR = path.join(__dirname, '..', '..', 'drizzle');

let pool: mysql.Pool | null = null;
let database: MySql2Database | null = null;

export function db(): MySql2Database {
  if (!database) throw new Error('Database is not connected — call connectDB() first');
  return database;
}

// Opens the connection pool and applies any pending migrations from drizzle/.
export async function connectDB(url: string): Promise<void> {
  pool = mysql.createPool({ uri: url, timezone: 'Z', charset: 'utf8mb4', connectionLimit: 10 });
  database = drizzle(pool);
  await migrate(database, { migrationsFolder: MIGRATIONS_DIR });
  console.log('[db] connected, migrations applied');
}

export async function disconnectDB(): Promise<void> {
  await pool?.end();
  pool = null;
  database = null;
}

export async function pingDB(): Promise<boolean> {
  try {
    await pool?.query('SELECT 1');
    return Boolean(pool);
  } catch {
    return false;
  }
}

export const DEFAULT_DATABASE_URL = 'mysql://root@127.0.0.1:3306/numenor';
