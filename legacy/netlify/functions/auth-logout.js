import { json, buildClearSessionCookie } from "./_lib/session.js";

export async function handler() {
  return json(200, { ok: true }, { "Set-Cookie": buildClearSessionCookie() });
}
