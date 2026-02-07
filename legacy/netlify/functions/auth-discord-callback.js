import { redirect, buildSessionCookie } from "./_lib/session.js";
import { hasDiscordConfig, resolveDiscordUserFromCode } from "./_lib/discord.js";
import { upsertUserProfile } from "./_lib/users.js";

export async function handler(event) {
  if (!hasDiscordConfig()) {
    return redirect("/auth/demo");
  }

  const code = String(event.queryStringParameters?.code || "");
  if (!code) {
    return redirect("/login-failed.html");
  }

  try {
    const user = await resolveDiscordUserFromCode(code);
    try {
      await upsertUserProfile(user, { source: "discord" });
    } catch (err) {
      // Ignore user-store failures and continue login flow.
    }
    return redirect("/welcome-user.html", {
      "Set-Cookie": buildSessionCookie(user),
    });
  } catch (err) {
    return redirect("/login-failed.html");
  }
}
