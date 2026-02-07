import { redirect, buildSessionCookie } from "./_lib/session.js";
import { upsertUserProfile } from "./_lib/users.js";

export async function handler() {
  const user = {
    id: "demo",
    username: "DemoUser",
    discriminator: "0000",
    avatar: null,
  };

  try {
    await upsertUserProfile(user, { source: "demo" });
  } catch (err) {
    // Ignore user-store failures and continue login flow.
  }

  return redirect("/welcome-user.html", {
    "Set-Cookie": buildSessionCookie(user),
  });
}
