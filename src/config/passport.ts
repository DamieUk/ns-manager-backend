import passport from 'passport';
import { Strategy as GoogleStrategy, Profile, VerifyCallback } from 'passport-google-oauth20';
import User from '../models/user.model';

const clientID = process.env.GOOGLE_CLIENT_ID;
const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
const callbackURL = process.env.GOOGLE_CALLBACK_URL;

if (!clientID || !clientSecret || !callbackURL) {
  console.warn(
    '[passport] Google OAuth env vars are not fully set — skipping strategy registration; /api/auth/google will 500 until they are set.'
  );
} else {
  passport.use(
    new GoogleStrategy(
      { clientID, clientSecret, callbackURL },
      async (accessToken: string, refreshToken: string, profile: Profile, done: VerifyCallback) => {
        try {
          const googleEmail = profile.emails?.[0]?.value?.toLowerCase();
          if (!googleEmail) {
            done(null, false, { message: 'no_email' });
            return;
          }

          const user = await User.findOne({ googleEmail });
          if (!user) {
            done(null, false, { message: 'not_invited' });
            return;
          }

          if (!user.isActive) {
            done(null, false, { message: 'account_disabled' });
            return;
          }

          let dirty = false;
          if (!user.googleId) {
            user.googleId = profile.id;
            user.avatarUrl = profile.photos?.[0]?.value;
            dirty = true;
          }
          if (!user.emailVerified) {
            user.emailVerified = true;
            dirty = true;
          }
          if (dirty) await user.save();

          done(null, user);
        } catch (err) {
          done(err as Error);
        }
      }
    )
  );
}

export default passport;
