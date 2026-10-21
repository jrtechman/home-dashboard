import { json, fail, guard, redis, keys, COLLECTIONS, features } from "../server.js";

// GET ?since=<version> returns everything, or { unchanged: true } when nothing changed.
export async function GET(request) {
  const denied = guard(request);
  if (denied) return denied;
  try {
    const r = redis();
    const since = Number(new URL(request.url).searchParams.get("since"));
    const version = Number(await r.get(keys.version)) || 0;
    if (Number.isFinite(since) && since === version) return json({ version, unchanged: true, features: features() });

    const p = r.pipeline();
    COLLECTIONS.forEach((c) => p.hgetall(keys.coll(c)));
    p.get(keys.settings);
    const out = await p.exec();
    const data = {};
    COLLECTIONS.forEach((c, i) => {
      const hash = out[i] || {};
      data[c] = Object.entries(hash).map(([id, v]) => ({ ...(typeof v === "string" ? JSON.parse(v) : v), id }));
    });
    data.settings = out[COLLECTIONS.length] || null;
    return json({ version, data, features: features() });
  } catch (e) {
    return fail(500, e.message || "Couldn't read your data.");
  }
}
