// MySQL driver errors arrive wrapped by drizzle (DrizzleQueryError, original in `cause`).
interface MySqlError {
  code: string;
  sqlMessage?: string;
}

function findMySqlError(err: unknown): MySqlError | undefined {
  let current = err as { code?: unknown; cause?: unknown } | undefined;
  for (let depth = 0; current && depth < 4; depth++) {
    if (typeof current.code === 'string' && current.code.startsWith('ER_')) return current as MySqlError;
    current = current.cause as typeof current;
  }
  return undefined;
}

export function isDatabaseError(err: unknown): boolean {
  return Boolean(findMySqlError(err)) || (err instanceof Error && err.name === 'DrizzleQueryError');
}

export function isDuplicateKeyError(err: unknown): boolean {
  return findMySqlError(err)?.code === 'ER_DUP_ENTRY';
}

// Unique indexes are named after their field (`code`, `sku`, `email`), so the key name in
// "Duplicate entry 'X' for key 'clients.code'" (MySQL) or "... for key 'code'" (MariaDB) is the field.
export function duplicateKeyField(err: unknown): string | undefined {
  const e = findMySqlError(err);
  if (e?.code !== 'ER_DUP_ENTRY') return undefined;
  return /for key '(?:[^']*\.)?([^'.]+)'/.exec(e.sqlMessage ?? '')?.[1];
}
