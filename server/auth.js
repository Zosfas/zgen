import passport from "passport";
import { Strategy as DiscordStrategy } from "passport-discord";

export function configureDiscordAuth({
  clientID,
  clientSecret,
  callbackURL,
  allowedGuild,
}) {
  passport.serializeUser((user, done) => done(null, user));
  passport.deserializeUser((obj, done) => done(null, obj));

  passport.use(
    new DiscordStrategy(
      {
        clientID,
        clientSecret,
        callbackURL,
        scope: ["identify", "guilds"],
      },
      (accessToken, refreshToken, profile, done) => {
        if (allowedGuild) {
          const inGuild = profile.guilds?.some((g) => g.id === allowedGuild);
          if (!inGuild) {
            return done(null, false, { message: "Not in allowed guild" });
          }
        }
        return done(null, {
          id: profile.id,
          username: profile.username,
          discriminator: profile.discriminator,
          avatar: profile.avatar,
        });
      }
    )
  );
}

export function ensureAuthenticated(req, res, next) {
  if (req.isAuthenticated && req.isAuthenticated()) {
    return next();
  }
  if (req.session && req.session.demoUser) {
    req.user = req.session.demoUser;
    return next();
  }
  return res.status(401).json({ error: "Unauthorized" });
}
