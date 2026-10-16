import mysql from 'mysql2/promise';

// The only database-specific part of the API test: where the test database lives and how to
// wipe it before a run (the server applies the migrations when it starts).
const SERVER_URL = process.env.TEST_MYSQL_URL || 'mysql://root@127.0.0.1:3306';
const DATABASE = 'numenor_test';

export const TEST_DB_ENV = { DATABASE_URL: `${SERVER_URL}/${DATABASE}` };

export async function resetTestDatabase(): Promise<void> {
  const conn = await mysql.createConnection(SERVER_URL);
  await conn.query(`DROP DATABASE IF EXISTS \`${DATABASE}\``);
  await conn.query(`CREATE DATABASE \`${DATABASE}\``);
  await conn.end();
}
