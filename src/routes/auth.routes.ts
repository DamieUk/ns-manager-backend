import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { me, login, logout, acceptInvite, forgotPassword, resetPassword } from '../controllers/auth.controller';
import { requireAuth } from '../middleware/requireAuth';

const router = Router();

// Password login is the only way in, so slow down guessing. Limits are per client IP and kept
// in memory (one backend instance). Successful logins do not count against the limit.
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  skipSuccessfulRequests: true,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message: { message: 'Забагато спроб входу. Спробуйте через 15 хвилин.' },
});

const passwordTokenLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message: { message: 'Забагато запитів. Спробуйте через 15 хвилин.' },
});

router.get('/me', requireAuth, me);

router.post('/login', loginLimiter, login);
router.post('/logout', logout);
router.post('/accept-invite', passwordTokenLimiter, acceptInvite);
router.post('/forgot-password', passwordTokenLimiter, forgotPassword);
router.post('/reset-password', passwordTokenLimiter, resetPassword);

export default router;
