import { json, fail, guard, readJson, redis } from "../server.js";
import { vapid, idOf, notify, quiet, sendOne, SUBS } from "../push.js";

const KINDS = ["shopping", "help", "reminders"];
const cleanPrefs = (p) => Object.fromEntries(KINDS.map((k) => [k, !p || p[k] !== false]));
const name = (s) => String(s || "").slice(0, 40).trim();
const parse = (v) => (typeof v === "string" ? JSON.parse(v) : v);

// GET: the public key the browser needs. POST: subscribe / prefs / unsubscribe / test / help (ask for dinner-menu help).
export async function GET(request) {
  const denied = guard(request); if (denied) return denied;
  try { return json({ publicKey: (await vapid()).publicKey }); } catch (e) { return fail(500, e.message || "Notifications aren't available."); }
}
export async function POST(request) {
  const denied = guard(request); if (denied) return denied;
  let b; try { b = await readJson(request, 20_000); } catch (e) { return fail(e.status || 400, "That request couldn't be read."); }
  try {
    const r = redis();
    if (b.op === "subscribe") {
      const sub = b.sub;
      if (!sub || typeof sub.endpoint !== "string" || !/^https:\/\//.test(sub.endpoint) || !sub.keys?.p256dh || !sub.keys?.auth) return fail(400, "That device can't receive notifications.");
      const id = idOf(sub.endpoint);
      await r.hset(SUBS, { [id]: { sub: { endpoint: sub.endpoint, keys: { p256dh: sub.keys.p256dh, auth: sub.keys.auth } }, who: name(b.who), prefs: cleanPrefs(b.prefs), at: Date.now() } });
      return json({ ok: true, id });
    }
    if (b.op === "prefs" || b.op === "unsubscribe" || b.op === "test") {
      const id = String(b.id || ""); const cur = await r.hget(SUBS, id);
      if (!cur) return fail(404, "This device isn't signed up for notifications.");
      if (b.op === "unsubscribe") { await r.hdel(SUBS, id); return json({ ok: true }); }
      if (b.op === "prefs") { const v = parse(cur); await r.hset(SUBS, { [id]: { ...v, prefs: cleanPrefs(b.prefs) } }); return json({ ok: true }); }
      const ok = await sendOne(id, { title: "Home", body: "Notifications are working on this device.", url: "/", tag: "test" });
      return ok ? json({ ok: true }) : fail(502, "The test notification couldn't be delivered.");
    }
    if (b.op === "help") {
      const by = name(b.by) || "Someone";
      if (!(await quiet(`help:${by}`, 300))) return json({ ok: true, already: true });
      await notify("help", { title: "Dinner help", body: `${by} could use help building the dinner menu.`, url: "/#meals", ep: String(b.ep || ""), tag: "help" });
      return json({ ok: true });
    }
    return fail(400, "Unknown request.");
  } catch (e) { return fail(500, e.message || "Couldn't update notifications."); }
}
