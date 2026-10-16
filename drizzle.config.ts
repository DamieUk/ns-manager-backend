import { defineConfig } from 'drizzle-kit';

// `npm run db:generate` writes a new SQL migration into drizzle/ after a change to
// src/db/schema.ts. Migrations are applied automatically when the server starts.
// New CREATE TABLE statements need `ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin`
// appended by hand (drizzle-kit can't emit table options), as in 0000_init.sql.
export default defineConfig({
  dialect: 'mysql',
  schema: './src/db/schema.ts',
  out: './drizzle',
});
