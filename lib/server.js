// Shared helpers for the API functions: storage, sign-in cookie, JSON responses.
import { Redis } from "@upstash/redis";
import crypto from "node:crypto";

export const COLLECTIONS = ["events", "todos", "shopping", "recipes", "photos", "dinnerlist"];
const PREFIX = "hd:";

let _redis = null;
export function redis() {
  if (_redis) return _redis;
  const url = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) throw new Error("Storage is not connected. Add an Upstash Redis database from the Vercel Storage tab.");
  _redis = new Redis({ url, token });
  return _redis;
}
export const keys = {
  coll: (c) => `${PREFIX}c:${c}`,
  settings: `${PREFIX}settings`,
  version: `${PREFIX}ver`,
  login: (ip) => `${PREFIX}login:${ip}`,
};

export function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store", ...headers },
  });
}
export const fail = (status, error) => json({ error }, status);

/* ---------- sign-in ---------- */
const COOKIE = "hd_session";
const YEAR = 60 * 60 * 24 * 365;

function secret() {
  const s = process.env.SESSION_SECRET;
  if (s && s.length >= 16) return s;
  // Falls back to the passcode, so changing the passcode signs every screen out.
  const p = process.env.HOUSEHOLD_PASSCODE || "";
  return crypto.createHash("sha256").update("hd-session:" + p).digest("hex");
}
function sign(value) {
  return crypto.createHmac("sha256", secret()).update(value).digest("base64url");
}
export function sessionCookie() {
  const issued = String(Date.now());
  const token = `${issued}.${sign(issued)}`;
  return `${COOKIE}=${token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${YEAR}`;
}
export const clearCookie = `${COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`;

export function isSignedIn(request) {
  if (!process.env.HOUSEHOLD_PASSCODE) return false;
  const raw = request.headers.get("cookie") || "";
  const m = raw.match(new RegExp(`(?:^|;\\s*)${COOKIE}=([^;]+)`));
  if (!m) return false;
  const [issued, mac] = m[1].split(".");
  if (!issued || !mac) return false;
  const expect = sign(issued);
  const a = Buffer.from(mac), b = Buffer.from(expect);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
export function passcodeMatches(given) {
  const real = process.env.HOUSEHOLD_PASSCODE || "";
  if (!real) return false;
  const a = crypto.createHash("sha256").update(String(given)).digest();
  const b = crypto.createHash("sha256").update(real).digest();
  return crypto.timingSafeEqual(a, b);
}
export function guard(request) {
  if (!process.env.HOUSEHOLD_PASSCODE) return fail(500, "Set HOUSEHOLD_PASSCODE in your Vercel project settings, then redeploy.");
  if (!isSignedIn(request)) return fail(401, "Sign in required.");
  return null;
}

export async function readJson(request, maxBytes = 200_000) {
  const text = await request.text();
  if (text.length > maxBytes) throw Object.assign(new Error("too large"), { status: 413 });
  try { return JSON.parse(text || "{}"); } catch { throw Object.assign(new Error("bad json"), { status: 400 }); }
}

export function features() {
  return {
    photos: !!process.env.BLOB_READ_WRITE_TOKEN,
    claude: !!process.env.ANTHROPIC_API_KEY,
    calendar: !!process.env.CALENDARS,
    budget: !!process.env.YNAB_TOKEN,
    album: !!process.env.PHOTO_ALBUM,
    apple: !!(process.env.ICLOUD_ID && process.env.ICLOUD_APP_PASSWORD),
    build: process.env.VERCEL_GIT_COMMIT_SHA || process.env.VERCEL_DEPLOYMENT_ID || "dev",
  };
}

export const HOME_TZ = process.env.HOME_TIMEZONE || "America/New_York";
