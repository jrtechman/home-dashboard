import crypto from "node:crypto";
import { json, fail, guard, readJson, redis, keys, passcodeMatches } from "../server.js";

// The 4-digit PIN that turns "Guests are here" mode off. Kept hashed in Redis (hd:guestpin).
// The household passcode can always be used instead (forgotten PIN) and is needed to change a PIN you do not know.
const KEY = "hd:guestpin";
const parse = (v) => (typeof v === "string" ? JSON.parse(v) : v);
const hash = (pin, salt) => crypto.scryptSync(String(pin), salt, 32).toString("hex");
const same = (a, b) => { const x = Buffer.from(String(a)), y = Buffer.from(String(b)); return x.length === y.length && crypto.timingSafeEqual(x, y); };
const ip = (request) => (request.headers.get("x-forwarded-for") || "unknown").split(",")[0].trim();

async function stored() { try { const v = await redis().get(KEY); return v ? parse(v) : null; } catch { return null; } }
const pinOk = (s, pin) => !!s && /^\d{4}$/.test(String(pin || "")) && same(hash(pin, s.salt), s.hash);
async function locked(request) { try { return Number(await redis().get(keys.login("guest:" + ip(request)))) >= 8; } catch { return false; } }
async function miss(request) { try { const k = keys.login("guest:" + ip(request)), n = await redis().incr(k); if (n === 1) await redis().expire(k, 900); } catch { /* ignore */ } }

export async function GET(request) {
  const denied = guard(request); if (denied) return denied;
  return json({ hasPin: !!(await stored()) });
}
export async function POST(request) {
  const denied = guard(request); if (denied) return denied;
  let b; try { b = await readJson(request, 2000); } catch { return fail(400, "That request couldn't be read."); }
  try {
    const s = await stored();
    if (b.op === "verify") {
      if (!s && !b.passcode) return json({ ok: true });
      if (await locked(request)) return fail(429, "Too many tries. Wait 15 minutes and try again.");
      if (b.passcode ? passcodeMatches(String(b.passcode)) : pinOk(s, b.pin)) return json({ ok: true });
      await miss(request);
      return fail(403, b.passcode ? "That passcode isn't right." : "That PIN isn't right.");
    }
    if (b.op === "set") {
      if (!/^\d{4}$/.test(String(b.pin || ""))) return fail(400, "Use exactly 4 digits.");
      if (s) {
        if (await locked(request)) return fail(429, "Too many tries. Wait 15 minutes and try again.");
        if (!(b.passcode ? passcodeMatches(String(b.passcode)) : pinOk(s, b.current))) { await miss(request); return fail(403, "The current PIN isn't right."); }
      }
      const salt = crypto.randomBytes(16).toString("hex");
      await redis().set(KEY, { salt, hash: hash(b.pin, salt), at: Date.now() });
      return json({ ok: true });
    }
    return fail(400, "Unknown request.");
  } catch (e) { return fail(500, e.message || "Couldn't update the PIN."); }
}
