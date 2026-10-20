import { json, fail, guard, readJson, redis, keys, COLLECTIONS } from "../lib/server.js";

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
        await r.hset(k, { [id]: data });
      } else if (op === "update") {
        const patch = clean(body.data);
        if (!patch) return fail(400, "Change must be an object.");
        const cur = await r.hget(k, id);
        if (!cur) return fail(404, "That item was already removed.");
        const base = typeof cur === "string" ? JSON.parse(cur) : cur;
        await r.hset(k, { [id]: { ...base, ...patch } });
      } else if (op === "delete") {
        await r.hdel(k, id);
      } else {
        return fail(400, "Unknown change.");
      }
    }
    const version = await r.incr(keys.version);
    return json({ ok: true, version });
  } catch (e) {
    return fail(500, e.message || "Couldn't save.");
  }
}
