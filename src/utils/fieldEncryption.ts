import crypto from 'crypto';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12;
const KEY_LENGTH = 32;
// Fixed, non-secret application salt — the actual secret is FIELD_ENCRYPTION_PASSPHRASE.
// A single derived key for the whole app is acceptable here (not a per-user password hash).
const SALT = 'numenor-field-encryption-v1';

let cachedKey: Buffer | null = null;

function getKey(): Buffer {
  if (cachedKey) return cachedKey;

  const passphrase = process.env.FIELD_ENCRYPTION_PASSPHRASE;
  if (!passphrase) throw new Error('FIELD_ENCRYPTION_PASSPHRASE is not set');

  cachedKey = crypto.scryptSync(passphrase, SALT, KEY_LENGTH);
  return cachedKey;
}

/**
 * Encrypts a plaintext string for storage. Returns `iv:authTag:ciphertext` (all base64).
 * Passing undefined/null/'' returns it unchanged — optional fields stay optional.
 */
export function encryptField(value: string | undefined | null): string | undefined {
  if (value === undefined || value === null || value === '') return value ?? undefined;

  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, getKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();

  return [iv.toString('base64'), authTag.toString('base64'), ciphertext.toString('base64')].join(':');
}

/**
 * Decrypts a value produced by `encryptField`. If the value doesn't match the expected
 * `iv:authTag:ciphertext` shape (e.g. legacy plaintext data written before encryption was
 * added) or fails authentication, it's returned as-is rather than throwing — this keeps
 * pre-existing data readable instead of corrupting the response.
 */
export function decryptField(value: string | undefined | null): string | undefined {
  if (value === undefined || value === null || value === '') return value ?? undefined;

  const parts = value.split(':');
  if (parts.length !== 3) return value;

  try {
    const [ivB64, authTagB64, ciphertextB64] = parts;
    const iv = Buffer.from(ivB64, 'base64');
    const authTag = Buffer.from(authTagB64, 'base64');
    const ciphertext = Buffer.from(ciphertextB64, 'base64');

    const decipher = crypto.createDecipheriv(ALGORITHM, getKey(), iv);
    decipher.setAuthTag(authTag);
    const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
    return plaintext.toString('utf8');
  } catch {
    return value;
  }
}
