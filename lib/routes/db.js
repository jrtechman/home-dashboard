import { json, fail, guard, readJson, redis, keys, COLLECTIONS, HOME_TZ } from "../server.js";
import { appleConfigured, putEvent, deleteEvent, appleMessage } from "../caldav.js";

const ID = /^[a-z0-9]{6,40}$/i;

function clean(data) {
  if (!data || typeof data !== "object" || Array.isArray(data)) return null;
  const out = {};
  for (const [k, v] of Object.entries(data)) {
    if (k === "id" || k.startsWith("__")) continue;
    out[k] = v;
  }
  return out;
}

// POST { op: "add"|"update"|"delete", coll, id, data }  or  { op: "settings", data }
export async function POST(request) {
  const denied = guard(request);
  if (denied) return denied;
  let body;
  try { body = await readJson(request); } catch (e) { return fail(e.status || 400, "That change couldn't be read."); }
  const { op, coll, id } = body;
  let appleError = "";
  const apple = appleConfigured() && coll === "events";
  try {
    const r = redis();
    if (op === "settings") {
      const data = clean(body.data);
      if (!data) return fail(400, "Settings must be an object.");
      await r.set(keys.settings, data);
    } else {
      if (!COLLECTIONS.includes(coll)) return fail(400, "Unknown list.");
      if (!ID.test(String(id || ""))) return fail(400, "Bad item id.");
      const k = keys.coll(coll);
      if (op === "add") {
        const data = clean(body.data);
        if (!data) return fail(400, "Item must be an object.");
        if (apple) appleError = await syncApple(null, data, id);
        if (appleError) data.appleCal = "";
        await r.hset(k, { [id]: data });
      } else if (op === "update") {
        const patch = clean(body.data);
        if (!patch) return fail(400, "Change must be an object.");
        const cur = await r.hget(k, id);
        if (!cur) return fail(404, "That item was already removed.");
        const base = typeof cur === "string" ? JSON.parse(cur) : cur;
        const next = { ...base, ...patch };
        if (apple && ["title", "date", "time", "who", "appleCal"].some((f) => f in patch)) {
          appleError = await syncApple(base, next, id);
          if (appleError) next.appleCal = patch.appleCal ? "" : next.appleCal; // couldn't add it; don't claim it's there
        }
        await r.hset(k, { [id]: next });
      } else if (op === "delete") {
        if (apple) {
          const cur = await r.hget(k, id);
          const base = cur && (typeof cur === "string" ? JSON.parse(cur) : cur);
          if (base && base.appleCal) appleError = await syncApple(base, null, id);
        }
        await r.hdel(k, id);
      } else {
        return fail(400, "Unknown change.");
      }
    }
    const version = await r.incr(keys.version);
    return json({ ok: true, version, ...(appleError ? { appleError } : {}) });
  } catch (e) {
    return fail(500, e.message || "Couldn't save.");
  }
}

// Mirrors a dashboard event into iCloud. Returns "" on success, or a message the screen shows.
// prev/next are the event before and after the change (null for none).
async function syncApple(prev, next, id) {
  try {
    const was = prev && prev.appleCal, now = next && next.appleCal;
    if (was && was !== now) await deleteEvent(was, id).catch((e) => { if (!now) throw e; });
    if (now && next.date) await putEvent(now, id, next, HOME_TZ);
    return "";
  } catch (e) {
    return "Saved here, but not in Apple Calendar: " + appleMessage(e);
  }
}
