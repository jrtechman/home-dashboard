import crypto from "node:crypto";
import { json, fail, guard, readJson, redis, keys, isAdmin, adminCookie, clearAdminCookie } from "../server.js";

// Admin sign-in for the dashboard: its own passcode, separate from the household one.
// The passcode comes from the ADMIN_PASSCODE variable if set, otherwise from one chosen in the app (kept hashed in Redis).
const KEY = "hd:admin";
const parse = (v) => (typeof v === "string" ? JSON.parse(v) : v);
const hash = (pass, salt) => crypto.scryptSync(String(pass), salt, 32).toString("hex");
const same = (a, b) => { const x = Buffer.from(String(a)), y = Buffer.from(String(b)); return x.length === y.length && crypto.timingSafeEqual(x, y); };

async function stored() { try { const v = await redis().get(KEY); return v ? parse(v) : null; } catch { return null; } }
async function check(pass) {
  const env = process.env.ADMIN_PASSCODE;
  if (env) return same(crypto.createHash("sha256").update(String(pass)).digest("hex"), crypto.createHash("sha256").update(env).digest("hex"));
  const s = await stored();
  return !!s && same(hash(pass, s.salt), s.hash);
}
async function save(pass) {
  const salt = crypto.randomBytes(16).toString("hex");
  await redis().set(KEY, { salt, hash: hash(pass, salt), at: Date.now() });
}
async function throttle(request) {
  const ip = (request.headers.get("x-forwarded-for") || "unknown").split(",")[0].trim();
  try { const k = keys.login("admin:" + ip), n = await redis().incr(k); if (n === 1) await redis().expire(k, 900); return n > 8; } catch { return false; }
}

export async function GET(request) {
  const denied = guard(request); if (denied) return denied;
  return json({ admin: isAdmin(request), hasPasscode: !!process.env.ADMIN_PASSCODE || !!(await stored()), fromEnv: !!process.env.ADMIN_PASSCODE });
}
export async function POST(request) {
  const denied = guard(request); if (denied) return denied;
  let b; try { b = await readJson(request, 2000); } catch { return fail(400, "That request couldn't be read."); }
  try {
    const env = !!process.env.ADMIN_PASSCODE, has = env || !!(await stored());
    if (b.op === "lock") return json({ ok: true }, 200, { "set-cookie": clearAdminCookie });
    if (b.op === "setup") {
      if (has) return fail(409, "An admin passcode is already set.");
      if (String(b.passcode || "").length < 6) return fail(400, "Use at least 6 characters.");
      await save(b.passcode);
      return json({ ok: true }, 200, { "set-cookie": adminCookie() });
    }
    if (b.op === "unlock") {
      if (!has) return fail(404, "No admin passcode is set yet.");
      if (await throttle(request)) return fail(429, "Too many tries. Wait 15 minutes and try again.");
      if (!(await check(b.passcode || ""))) return fail(401, "That admin passcode isn't right.");
      return json({ ok: true }, 200, { "set-cookie": adminCookie() });
    }
    if (b.op === "change") {
      if (env) return fail(409, "The admin passcode is set in Vercel (ADMIN_PASSCODE). Change it there.");
      if (!isAdmin(request)) return fail(403, "Unlock admin first.");
      if (!(await check(b.passcode || ""))) return fail(401, "The current admin passcode isn't right.");
      if (String(b.newPasscode || "").length < 6) return fail(400, "Use at least 6 characters.");
      await save(b.newPasscode);
      return json({ ok: true });
    }
    return fail(400, "Unknown request.");
  } catch (e) { return fail(500, e.message || "Couldn't update admin."); }
}
