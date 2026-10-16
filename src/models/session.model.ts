import { and, eq, gt, lte } from 'drizzle-orm';
import { db } from '../db';
import { sessions } from '../db/schema';

// A login session. The browser holds the raw token in an httpOnly cookie; only its SHA-256
// hash is stored, so a database leak does not hand out usable sessions.
export interface Session {
  tokenHash: string;
  userId: string;
  expiresAt: Date;
}

export async function createSession(session: Session): Promise<void> {
  const now = new Date();
  // Expired sessions are swept on each login; requireAuth ignores them in the meantime.
  await db().delete(sessions).where(lte(sessions.expiresAt, now));
  await db().insert(sessions).values({ ...session, createdAt: now, updatedAt: now });
}

export async function findValidSession(tokenHash: string): Promise<Session | null> {
  const [row] = await db()
    .select({ tokenHash: sessions.tokenHash, userId: sessions.userId, expiresAt: sessions.expiresAt })
    .from(sessions)
    .where(and(eq(sessions.tokenHash, tokenHash), gt(sessions.expiresAt, new Date())));
  return row ?? null;
}

export async function deleteSession(tokenHash: string): Promise<void> {
  await db().delete(sessions).where(eq(sessions.tokenHash, tokenHash));
}

export async function deleteUserSessions(userId: string): Promise<void> {
  await db().delete(sessions).where(eq(sessions.userId, userId));
}
