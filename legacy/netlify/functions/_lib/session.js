import crypto from "node:crypto";

const SESSION_COOKIE = "sdv_session";
const ONE_DAY_SECONDS = 60 * 60 * 24;

function base64urlEncode(input) {
  return Buffer.from(input).toString("base64url");
}

function base64urlDecode(input) {
  return Buffer.from(input, "base64url").toString("utf8");
}

function getSecret() {
  return process.env.SESSION_SECRET || "change-me";
}

function sign(payloadPart) {
  return crypto
    .createHmac("sha256", getSecret())
    .update(payloadPart)
    .digest("base64url");
}

function parseCookies(cookieHeader = "") {
  const cookies = {};
  for (const segment of cookieHeader.split(";")) {
    const [rawKey, ...rest] = segment.trim().split("=");
    if (!rawKey) continue;
    cookies[rawKey] = decodeURIComponent(rest.join("="));
  }
  return cookies;
}

export function createSessionToken(user, ttlSeconds = ONE_DAY_SECONDS) {
  const now = Math.floor(Date.now() / 1000);
  const payload = {
    id: user.id,
    username: user.username,
    discriminator: user.discriminator || "0000",
    avatar: user.avatar || null,
    iat: now,
    exp: now + ttlSeconds,
  };
  const payloadPart = base64urlEncode(JSON.stringify(payload));
  const signature = sign(payloadPart);
  return `${payloadPart}.${signature}`;
}

export function verifySessionToken(token) {
  if (!token || !token.includes(".")) return null;
  const [payloadPart, signature] = token.split(".");
  if (!payloadPart || !signature) return null;

  const expected = sign(payloadPart);
  const left = Buffer.from(signature);
  const right = Buffer.from(expected);
  if (left.length !== right.length) return null;
  const valid = crypto.timingSafeEqual(left, right);
  if (!valid) return null;

  try {
    const payload = JSON.parse(base64urlDecode(payloadPart));
    const now = Math.floor(Date.now() / 1000);
    if (!payload.exp || payload.exp < now) return null;
    return {
      id: payload.id,
      username: payload.username,
      discriminator: payload.discriminator,
      avatar: payload.avatar,
    };
  } catch (err) {
    return null;
  }
}

export function getSessionUser(event) {
  const cookies = parseCookies(event.headers?.cookie || event.headers?.Cookie || "");
  const token = cookies[SESSION_COOKIE];
  return verifySessionToken(token);
}

export function buildSessionCookie(user, ttlSeconds = ONE_DAY_SECONDS) {
  const token = createSessionToken(user, ttlSeconds);
  return `${SESSION_COOKIE}=${encodeURIComponent(token)}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${ttlSeconds}`;
}

export function buildClearSessionCookie() {
  return `${SESSION_COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`;
}

export function json(statusCode, data, headers = {}) {
  return {
    statusCode,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
      ...headers,
    },
    body: JSON.stringify(data),
  };
}

export function redirect(location, headers = {}) {
  return {
    statusCode: 302,
    headers: {
      Location: location,
      ...headers,
    },
    body: "",
  };
}
