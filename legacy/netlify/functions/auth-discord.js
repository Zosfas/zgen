import { redirect } from "./_lib/session.js";
import { hasDiscordConfig, buildDiscordLoginUrl } from "./_lib/discord.js";

export async function handler() {
  if (!hasDiscordConfig()) {
    return redirect("/auth/demo");
  }

  try {
    const location = buildDiscordLoginUrl();
    return redirect(location);
  } catch (err) {
    return redirect("/login-failed.html");
  }
}
