import fs from 'fs';
import path from 'path';
import type { Readable } from 'stream';

// Uploaded files (contracts, BOM files, progress-report photos) live on the backend's own disk.
// In production UPLOAD_DIR points at a persistent Docker volume — see deploy/docker-compose.yml.
export const UPLOAD_DIR = path.resolve(process.env.UPLOAD_DIR || path.join(__dirname, '..', '..', 'uploads'));

fs.mkdirSync(UPLOAD_DIR, { recursive: true });

// Keys are generated server-side (documentFromFile), but never let one escape UPLOAD_DIR.
function resolveKey(key: string): string {
  if (!key || key === '.' || key === '..' || path.basename(key) !== key) {
    throw new Error(`Invalid storage key: ${key}`);
  }
  return path.join(UPLOAD_DIR, key);
}

export async function uploadToStorage(key: string, body: Buffer): Promise<void> {
  await fs.promises.writeFile(resolveKey(key), body, { flag: 'wx' });
}

export async function deleteFromStorage(key: string): Promise<void> {
  await fs.promises.unlink(resolveKey(key));
}

export interface StorageObject {
  body: Readable;
  contentLength: number;
}

export async function readFromStorage(key: string): Promise<StorageObject> {
  const filePath = resolveKey(key);
  const { size } = await fs.promises.stat(filePath);
  return { body: fs.createReadStream(filePath), contentLength: size };
}
