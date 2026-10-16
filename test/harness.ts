import { spawn, ChildProcess } from 'child_process';
import crypto from 'crypto';
import fs from 'fs';
import os from 'os';
import path from 'path';

export const ROOT = path.resolve(__dirname, '..');
export const PORT = 5099;
export const BASE = `http://127.0.0.1:${PORT}/api`;
export const ORIGIN = 'http://localhost:5173';

const TSX = path.join(ROOT, 'node_modules', '.bin', 'tsx');

// Settings shared by the test server and the seed script. Real secrets and SMTP are never used:
// without SMTP the mailer logs invite/reset links, which the scenario reads from the server output.
export function baseEnv(dbEnv: Record<string, string>): NodeJS.ProcessEnv {
  return {
    ...process.env,
    ...dbEnv,
    NODE_ENV: 'test',
    FIELD_ENCRYPTION_PASSPHRASE: 'test-passphrase-not-a-secret',
    CLIENT_ORIGIN: ORIGIN,
    SESSION_TTL_HOURS: '12',
    SMTP_HOST: '',
    SMTP_USER: '',
    SMTP_PASSWORD: '',
  };
}

export async function seedExecutive(dbEnv: Record<string, string>, email: string, name: string): Promise<string> {
  const output = await new Promise<string>((resolve, reject) => {
    const proc = spawn(TSX, ['src/scripts/seedExecutive.ts', email, name], { cwd: ROOT, env: baseEnv(dbEnv) });
    let out = '';
    proc.stdout.on('data', (d) => (out += d));
    proc.stderr.on('data', (d) => (out += d));
    proc.on('error', reject);
    proc.on('close', (code) => (code === 0 ? resolve(out) : reject(new Error(`seed failed (${code}): ${out}`))));
  });
  const match = output.match(/^Password: (\S+)$/m);
  if (!match) throw new Error(`seed printed no password: ${output}`);
  return match[1];
}

export interface TestServer {
  uploadDir: string;
  output(): string;
  stop(): Promise<void>;
}

export async function startServer(dbEnv: Record<string, string>): Promise<TestServer> {
  const uploadDir = fs.mkdtempSync(path.join(os.tmpdir(), 'numenor-test-uploads-'));
  const proc: ChildProcess = spawn(TSX, ['src/server.ts'], {
    cwd: ROOT,
    env: { ...baseEnv(dbEnv), PORT: String(PORT), UPLOAD_DIR: uploadDir },
  });
  let out = '';
  proc.stdout!.on('data', (d) => (out += d));
  proc.stderr!.on('data', (d) => (out += d));

  const deadline = Date.now() + 30_000;
  for (;;) {
    try {
      const res = await fetch(`${BASE}/health`);
      if (res.ok) break;
    } catch {
      // not listening yet
    }
    if (proc.exitCode !== null || Date.now() > deadline) {
      proc.kill();
      throw new Error(`server did not start:\n${out}`);
    }
    await sleep(200);
  }

  return {
    uploadDir,
    output: () => out,
    stop: async () => {
      if (proc.exitCode === null) {
        proc.kill();
        await new Promise((r) => proc.once('close', r));
      }
      fs.rmSync(uploadDir, { recursive: true, force: true });
    },
  };
}

export function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

export interface ApiResponse {
  status: number;
  headers: Headers;
  data: unknown;
  bytes: Buffer;
}

export interface RequestOptions {
  json?: unknown;
  form?: FormData;
  headers?: Record<string, string>;
  // Browsers send Origin on writes; null leaves it out (like curl).
  origin?: string | null;
}

// One signed-in (or anonymous) browser: keeps the session cookie between requests.
export class Actor {
  cookie: string | undefined;

  constructor(readonly name: string) {}

  async req(method: string, url: string, opts: RequestOptions = {}): Promise<ApiResponse> {
    const headers: Record<string, string> = { ...opts.headers };
    if (this.cookie) headers.cookie = this.cookie;
    const origin = opts.origin === undefined ? ORIGIN : opts.origin;
    if (origin && method !== 'GET') headers.origin = origin;

    let body: string | FormData | undefined;
    if (opts.json !== undefined) {
      headers['content-type'] = 'application/json';
      body = JSON.stringify(opts.json);
    } else if (opts.form) {
      body = opts.form;
    }

    const res = await fetch(BASE + url, { method, headers, body, redirect: 'manual' });
    for (const raw of res.headers.getSetCookie()) {
      const [pair] = raw.split(';');
      const eq = pair.indexOf('=');
      if (pair.slice(0, eq) === 'numenor_session') {
        const value = pair.slice(eq + 1);
        this.cookie = value ? pair : undefined;
      }
    }
    const bytes = Buffer.from(await res.arrayBuffer());
    const isJson = (res.headers.get('content-type') ?? '').includes('application/json');
    return { status: res.status, headers: res.headers, data: isJson ? JSON.parse(bytes.toString('utf8')) : null, bytes };
  }
}

export function upload(content: string | Buffer, type: string, filename: string): { blob: Blob; filename: string } {
  return { blob: new Blob([typeof content === 'string' ? Buffer.from(content) : content], { type }), filename };
}

export function form(fields: Record<string, string | undefined>, files: Record<string, ReturnType<typeof upload>[]> = {}): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) if (v !== undefined) fd.append(k, v);
  for (const [k, list] of Object.entries(files)) for (const f of list) fd.append(k, f.blob, f.filename);
  return fd;
}

export function sha256(buf: Buffer): string {
  return crypto.createHash('sha256').update(buf).digest('hex');
}

// YYYY-MM-DD relative to today (UTC). Every date the scenario sends is relative, so the
// normalized snapshot is the same whichever day the test runs.
export function day(offset: number): string {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + offset)).toISOString().slice(0, 10);
}

export interface Step {
  step: string;
  status: number;
  body: unknown;
}

const OBJECT_ID = /^[0-9a-f]{24}$/;
const ID_TOKEN = /^<id:\d+>$/;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const STORAGE_KEY = /^\d{13}-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}(\.[A-Za-z0-9]+)?$/;

// Replaces run-specific values with stable placeholders: ids become <id:N> in order of first
// appearance (walking object keys alphabetically, so field order doesn't matter), timestamps
// <ts>, midnight dates <day+N> relative to today, storage keys <file.ext>. Already-normalized
// input comes out unchanged apart from renumbering, so a snapshot can be re-canonicalized.
// `__v` (Mongoose's version key) is dropped. Arrays of file records are sorted by originalName,
// since files uploaded in one request can share a createdAt millisecond.
export function normalizeSteps(steps: Step[]): Step[] {
  const ids = new Map<string, string>();
  const now = new Date();
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());

  const id = (raw: string): string => {
    if (!ids.has(raw)) ids.set(raw, `<id:${ids.size + 1}>`);
    return ids.get(raw)!;
  };

  const walk = (value: unknown): unknown => {
    if (Array.isArray(value)) {
      const items = value.every((v) => v && typeof v === 'object' && 'originalName' in v)
        ? [...value].sort((a, b) => String(a.originalName).localeCompare(String(b.originalName)))
        : value;
      return items.map(walk);
    }
    if (value && typeof value === 'object') {
      const out: Record<string, unknown> = {};
      for (const k of Object.keys(value).sort()) if (k !== '__v') out[k] = walk((value as Record<string, unknown>)[k]);
      return out;
    }
    if (typeof value === 'string') {
      if (OBJECT_ID.test(value) || ID_TOKEN.test(value)) return id(value);
      if (ISO_DATE.test(value)) {
        const t = new Date(value).getTime();
        if (t % 86_400_000 !== 0) return '<ts>';
        const offset = Math.round((t - today) / 86_400_000);
        return `<day${offset >= 0 ? '+' : ''}${offset}>`;
      }
      if (STORAGE_KEY.test(value)) return `<file${path.extname(value)}>`;
      return value.replace(/[0-9a-f]{24}|<id:\d+>/g, id);
    }
    return value;
  };

  return steps.map((s) => ({ step: s.step, status: s.status, body: walk(s.body) }));
}
