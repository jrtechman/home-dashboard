import { json, fail, readJson, passcodeMatches, sessionCookie, clearCookie, redis, keys } from "../server.js";

// POST { passcode } signs this device in for a year.
export async function POST(request) {
  if (!process.env.HOUSEHOLD_PASSCODE) return fail(500, "Set HOUSEHOLD_PASSCODE in your Vercel project settings, then redeploy.");
  const ip = (request.headers.get("x-forwarded-for") || "unknown").split(",")[0].trim();

  // Slow down guessing: 10 tries per 15 minutes per network address.
  try {
    const k = keys.login(ip);
    const n = await redis().incr(k);
    if (n === 1) await redis().expire(k, 900);
    if (n > 10) return fail(429, "Too many tries. Wait 15 minutes and try again.");
  } catch { /* storage not set up yet; still allow sign-in */ }

  let body;
  try { body = await readJson(request, 2000); } catch { return fail(400, "Send the passcode."); }
  if (!passcodeMatches(body.passcode || "")) return fail(401, "That passcode isn't right.");
  return json({ ok: true }, 200, { "set-cookie": sessionCookie() });
}

// DELETE signs this device out.
export async function DELETE() {
  return json({ ok: true }, 200, { "set-cookie": clearCookie });
}
