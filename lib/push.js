// Web push (the notifications that appear on phones and tablets). Keys are made once and kept in Redis.
import webpush from "web-push";
import crypto from "node:crypto";
import { redis } from "./server.js";

export const hooks = { send: (sub, payload, opts) => webpush.sendNotification(sub, payload, opts) };
const SUBS = "hd:push", KEYS = "hd:vapid";
export const idOf = (endpoint) => crypto.createHash("sha256").update(String(endpoint)).digest("hex").slice(0, 24);
const parse = (v) => (typeof v === "string" ? JSON.parse(v) : v);

let keys = null;
export async function vapid() {
  if (keys) return keys;
  const r = redis();
  let k = await r.get(KEYS);
  k = k && parse(k);
  if (!k || !k.publicKey) {
    k = webpush.generateVAPIDKeys();
    // If two requests race, the first one saved wins.
    const won = await r.set(KEYS, k, { nx: true });
    if (!won) k = parse(await r.get(KEYS));
  }
  keys = k;
  return k;
}
const options = async () => {
  const k = await vapid();
  return { vapidDetails: { subject: process.env.PUSH_SUBJECT || "mailto:home-dashboard@users.noreply.github.com", publicKey: k.publicKey, privateKey: k.privateKey }, TTL: 3600, urgency: "normal" };
};

/** Once per `seconds` for a key; true if allowed. Keeps a burst of changes from buzzing everyone repeatedly. */
export async function quiet(key, seconds) {
  try { return !!(await redis().set(`hd:push:t:${key}`, 1, { nx: true, ex: seconds })); } catch { return true; }
}

/** Sends to every enrolled device that wants this kind, except the sender's own device. Never throws. */
export async function notify(kind, { title, body, url = "/", ep = "", tag }) {
  try {
    const r = redis();
    const all = (await r.hgetall(SUBS)) || {};
    const opts = await options();
    const payload = JSON.stringify({ title, body, url, tag: tag || kind });
    const jobs = Object.entries(all).filter(([id, v]) => id !== ep && parse(v).prefs?.[kind] !== false).map(async ([id, v]) => {
      try { await hooks.send(parse(v).sub, payload, opts); }
      catch (e) { if (e && (e.statusCode === 404 || e.statusCode === 410)) await r.hdel(SUBS, id); }
    });
    await Promise.race([Promise.allSettled(jobs), new Promise((res) => setTimeout(res, 4000))]);
  } catch { /* notifications are best-effort */ }
}
export async function sendOne(id, message) {
  const r = redis(); const v = await r.hget(SUBS, id); if (!v) return false;
  try { await hooks.send(parse(v).sub, JSON.stringify(message), await options()); return true; }
  catch (e) { if (e && (e.statusCode === 404 || e.statusCode === 410)) await r.hdel(SUBS, id); return false; }
}
export { SUBS };
