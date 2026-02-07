import { json, getSessionUser } from "./_lib/session.js";
import { getUserProfile, isUserStoreEnabled, upsertUserProfile } from "./_lib/users.js";

export async function handler(event) {
  const user = getSessionUser(event);
  if (!user) {
    return json(200, { user: null });
  }

  if (!isUserStoreEnabled()) {
    return json(200, { user });
  }

  try {
    let profile = await getUserProfile(user.id);
    if (!profile) {
      profile = await upsertUserProfile(user, { source: "session" });
    }

    return json(200, {
      user: {
        ...user,
        usesLeftToday: profile?.usesLeftToday ?? null,
        role: profile?.role || null,
        banned: Boolean(profile?.banned),
      },
    });
  } catch (err) {
    return json(200, { user });
  }
}
