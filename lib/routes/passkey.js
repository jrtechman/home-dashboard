// Face ID / Touch ID sign-in (passkeys). A phone is enrolled while signed in with the passcode;
// after that, signing in is just a biometric prompt. Public keys live in Redis; nothing secret is stored.
import { generateRegistrationOptions, verifyRegistrationResponse, generateAuthenticationOptions, verifyAuthenticationResponse } from "@simplewebauthn/server";
import crypto from "node:crypto";
import { json, fail, readJson, guard, sessionCookie, redis, keys } from "../server.js";

const HASH = "hd:passkeys";
const RP_NAME = "Home Dashboard";
const b64u = (buf) => Buffer.from(buf).toString("base64url");
const fromB64u = (s) => new Uint8Array(Buffer.from(String(s), "base64url"));

function where(request) {
  const host = (request.headers.get("x-forwarded-host") || request.headers.get("host") || new URL(request.url).host).split(",")[0].trim();
  const local = /^(localhost|127\.0\.0\.1)(:|$)/.test(host);
  const proto = (request.headers.get("x-forwarded-proto") || (local ? "http" : "https")).split(",")[0].trim();
  return { rpID: host.replace(/:\d+$/, ""), origin: `${proto}://${host}` };
}
const ipOf = (request) => (request.headers.get("x-forwarded-for") || "unknown").split(",")[0].trim();

async function all() {
  const raw = (await redis().hgetall(HASH)) || {};
  return Object.values(raw).map((v) => (typeof v === "string" ? JSON.parse(v) : v));
}
async function saveChallenge(challenge, extra = {}) {
  const nonce = crypto.randomBytes(16).toString("base64url");
  await redis().set(`hd:wa:${nonce}`, { challenge, ...extra }, { ex: 300 });
  return nonce;
}
async function takeChallenge(nonce) {
  const k = `hd:wa:${String(nonce || "")}`;
  const v = await redis().get(k);
  if (!v) return null;
  await redis().del(k); // one use
  return typeof v === "string" ? JSON.parse(v) : v;
}
async function throttle(request) {
  const k = keys.login(ipOf(request));
  const n = await redis().incr(k);
  if (n === 1) await redis().expire(k, 900);
  return n > 10;
}

// GET (public) -> { any: true } when at least one phone has Face ID set up, so the sign-in screen can offer it.
// GET (signed in) ?list -> { devices: [{ id, name, createdAt }] }
export async function GET(request) {
  try {
    const list = await all();
    if (new URL(request.url).searchParams.has("list")) {
      const denied = guard(request);
      if (denied) return denied;
      return json({ devices: list.map((c) => ({ id: c.id, name: c.name, createdAt: c.createdAt })) });
    }
    return json({ any: list.length > 0 });
  } catch {
    return json({ any: false });
  }
}

// POST { step: "register-options" | "register-verify" | "login-options" | "login-verify", ... }
export async function POST(request) {
  let body;
  try { body = await readJson(request, 20_000); } catch { return fail(400, "That couldn't be read."); }
  const { rpID, origin } = where(request);
  try {
    switch (body.step) {
      case "register-options": {
        const denied = guard(request);
        if (denied) return denied;
        const existing = await all();
        const options = await generateRegistrationOptions({
          rpName: RP_NAME, rpID,
          userName: "household", userDisplayName: "Home Dashboard",
          userID: new TextEncoder().encode("household"),
          attestationType: "none",
          excludeCredentials: existing.map((c) => ({ id: c.id, transports: c.transports })),
          authenticatorSelection: { residentKey: "required", userVerification: "required" },
        });
        return json({ options, nonce: await saveChallenge(options.challenge) });
      }
      case "register-verify": {
        const denied = guard(request);
        if (denied) return denied;
        const saved = await takeChallenge(body.nonce);
        if (!saved) return fail(400, "That took too long. Try again.");
        const v = await verifyRegistrationResponse({ response: body.response, expectedChallenge: saved.challenge, expectedOrigin: origin, expectedRPID: rpID, requireUserVerification: true });
        if (!v.verified || !v.registrationInfo) return fail(400, "Face ID couldn't be verified.");
        const c = v.registrationInfo.credential;
        const name = String(body.name || "This device").slice(0, 40);
        await redis().hset(HASH, { [c.id]: { id: c.id, publicKey: b64u(c.publicKey), counter: c.counter, transports: c.transports || body.response?.response?.transports || [], name, createdAt: Date.now() } });
        return json({ ok: true });
      }
      case "login-options": {
        if (await throttle(request)) return fail(429, "Too many tries. Wait 15 minutes and try again.");
        if (!(await all()).length) return fail(404, "Face ID isn't set up yet. Sign in with the passcode first.");
        const options = await generateAuthenticationOptions({ rpID, userVerification: "required" });
        return json({ options, nonce: await saveChallenge(options.challenge) });
      }
      case "login-verify": {
        if (await throttle(request)) return fail(429, "Too many tries. Wait 15 minutes and try again.");
        const saved = await takeChallenge(body.nonce);
        if (!saved) return fail(400, "That took too long. Try again.");
        const cred = (await all()).find((c) => c.id === body.response?.id);
        if (!cred) return fail(401, "This phone isn't set up for Face ID any more. Use the passcode.");
        const v = await verifyAuthenticationResponse({
          response: body.response, expectedChallenge: saved.challenge, expectedOrigin: origin, expectedRPID: rpID, requireUserVerification: true,
          credential: { id: cred.id, publicKey: fromB64u(cred.publicKey), counter: cred.counter || 0, transports: cred.transports },
        });
        if (!v.verified) return fail(401, "Face ID didn't match.");
        await redis().hset(HASH, { [cred.id]: { ...cred, counter: v.authenticationInfo.newCounter, lastUsed: Date.now() } });
        return json({ ok: true }, 200, { "set-cookie": sessionCookie() });
      }
      default:
        return fail(400, "Unknown step.");
    }
  } catch (e) {
    return fail(400, "Face ID didn't work: " + (e && e.message ? String(e.message).slice(0, 160) : "try again."));
  }
}

// DELETE { id } (signed in) removes one phone.
export async function DELETE(request) {
  const denied = guard(request);
  if (denied) return denied;
  try {
    const { id } = await readJson(request, 2000);
    await redis().hdel(HASH, String(id || ""));
    return json({ ok: true });
  } catch (e) {
    return fail(500, "Couldn't remove it.");
  }
}
