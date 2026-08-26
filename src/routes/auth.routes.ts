import { Router } from 'express';
import session from 'express-session';
import {
  startGoogleAuth,
  handleGoogleCallback,
  me,
  login,
  acceptInvite,
  forgotPassword,
  resetPassword,
} from '../controllers/auth.controller';
import { requireAuth } from '../middleware/requireAuth';

const router = Router();

router.use(
  session({
    secret: process.env.SESSION_SECRET || 'dev-session-secret',
    resave: false,
    saveUninitialized: false,
    cookie: {
      secure: process.env.NODE_ENV === 'production',
      httpOnly: true,
      sameSite: 'lax',
      maxAge: 5 * 60 * 1000,
    },
  })
);

router.get('/google', startGoogleAuth);
router.get('/google/callback', handleGoogleCallback);
router.get('/me', requireAuth, me);

router.post('/login', login);
router.post('/accept-invite', acceptInvite);
router.post('/forgot-password', forgotPassword);
router.post('/reset-password', resetPassword);

export default router;
