import crypto from "node:crypto";
import { json, fail, guard, readJson, redis } from "../server.js";

// Spotify "now playing" and controls for the Home page.
// Needs SPOTIFY_CLIENT_ID and SPOTIFY_CLIENT_SECRET (a free app at developer.spotify.com). Controls need a Spotify Premium account.
// One person connects once (Connect Spotify on the Home page); the refresh token is kept in Redis (hd:spotify). Nothing secret reaches the browser.
// SPOTIFY_REDIRECT_URI is optional: it must match the Redirect URI added in the Spotify app (default https://<your site>/api/spotify).
const KEY = "hd:spotify", STATE = "hd:spotify:state";
const API = process.env.SPOTIFY_API_BASE || "https://api.spotify.com/v1";
const ACCOUNTS = process.env.SPOTIFY_ACCOUNTS_BASE || "https://accounts.spotify.com";
const SCOPES = "user-read-playback-state user-modify-playback-state user-read-currently-playing";
const parse = (v) => (typeof v === "string" ? JSON.parse(v) : v);
const creds = () => { const id = process.env.SPOTIFY_CLIENT_ID, secret = process.env.SPOTIFY_CLIENT_SECRET; return id && secret ? { id, secret } : null; };
const basic = (c) => "Basic " + Buffer.from(c.id + ":" + c.secret).toString("base64");

function redirectUri(request) {
  if (process.env.SPOTIFY_REDIRECT_URI) return process.env.SPOTIFY_REDIRECT_URI;
  const u = new URL(request.url);
  const host = request.headers.get("x-forwarded-host") || request.headers.get("host") || u.host;
  const proto = request.headers.get("x-forwarded-proto") || (host.startsWith("localhost") ? "http" : "https");
  return `${proto}://${host}/api/spotify`;
}
async function tokenCall(c, body) {
  const res = await fetch(ACCOUNTS + "/api/token", { method: "POST", headers: { authorization: basic(c), "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams(body), signal: AbortSignal.timeout(9000) });
  const j = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(j.error === "invalid_grant" ? "Spotify needs to be connected again." : "Spotify didn't accept the connection."), { status: 502, reauth: j.error === "invalid_grant" });
  return j;
}
async function accessToken(c) {
  const saved = (await redis().get(KEY)); const s = saved ? parse(saved) : null;
  if (!s || !s.refresh) return null;
  if (s.access && s.exp > Date.now() + 30_000) return s.access;
  try {
    const j = await tokenCall(c, { grant_type: "refresh_token", refresh_token: s.refresh });
    await redis().set(KEY, { refresh: j.refresh_token || s.refresh, access: j.access_token, exp: Date.now() + (j.expires_in || 3600) * 1000 });
    return j.access_token;
  } catch (e) { if (e.reauth) await redis().del(KEY); throw e; }
}
async function sp(token, path, init = {}) {
  const res = await fetch(API + path, { ...init, headers: { authorization: "Bearer " + token, "content-type": "application/json", ...(init.headers || {}) }, signal: AbortSignal.timeout(9000) });
  return res;
}
const out = (res, text) => Object.assign(new Error(text), { status: res.status === 429 ? 429 : 502 });
function explain(res) {
  if (res.status === 404) return "Open Spotify on a phone, speaker or computer first, then pick it as the device here.";
  if (res.status === 403) return "Spotify says this needs a Premium account.";
  if (res.status === 429) return "Spotify is busy. Try again in a moment.";
  return "Spotify didn't answer. Try again.";
}

export function slimPlayer(j) {
  if (!j || !j.item) return { active: !!(j && j.device), playing: false, device: j && j.device ? dev(j.device) : null };
  const it = j.item, imgs = (it.album && it.album.images) || [];
  return {
    active: true, playing: !!j.is_playing, progress: j.progress_ms || 0, duration: it.duration_ms || 0, at: Date.now(),
    track: { name: it.name, artists: (it.artists || []).map((a) => a.name).join(", "), album: it.album ? it.album.name : "", image: (imgs[1] || imgs[0] || {}).url || "" },
    device: j.device ? dev(j.device) : null, shuffle: !!j.shuffle_state, repeat: j.repeat_state || "off",
  };
}
const dev = (d) => ({ id: d.id, name: d.name, type: d.type, volume: d.volume_percent ?? null, active: !!d.is_active });

export async function GET(request) {
  const denied = guard(request);
  if (denied) return denied;
  const u = new URL(request.url), op = u.searchParams.get("op") || "";
  const c = creds();
  try {
    if (op === "login") {
      if (!c) return fail(404, "Spotify isn't set up yet.");
      const state = crypto.randomBytes(16).toString("hex");
      await redis().set(STATE, state, { ex: 600 });
      const q = new URLSearchParams({ response_type: "code", client_id: c.id, scope: SCOPES, redirect_uri: redirectUri(request), state });
      return new Response(null, { status: 302, headers: { location: ACCOUNTS + "/authorize?" + q, "cache-control": "no-store" } });
    }
    if (u.searchParams.get("code") || u.searchParams.get("error")) { // Spotify sends the person back here
      if (!c) return fail(404, "Spotify isn't set up yet.");
      const want = await redis().get(STATE); await redis().del(STATE);
      if (u.searchParams.get("error") || !want || want !== u.searchParams.get("state")) return new Response(null, { status: 302, headers: { location: "/?spotify=declined#house" } });
      const j = await tokenCall(c, { grant_type: "authorization_code", code: u.searchParams.get("code"), redirect_uri: redirectUri(request) });
      await redis().set(KEY, { refresh: j.refresh_token, access: j.access_token, exp: Date.now() + (j.expires_in || 3600) * 1000 });
      return new Response(null, { status: 302, headers: { location: "/#house", "cache-control": "no-store" } });
    }
    if (!c) return json({ configured: false, connected: false });
    const saved = await redis().get(KEY);
    if (!saved || !parse(saved).refresh) return json({ configured: true, connected: false });
    const token = await accessToken(c); if (!token) return json({ configured: true, connected: false });
    if (op === "devices") {
      const res = await sp(token, "/me/player/devices"); if (!res.ok) throw out(res, explain(res));
      return json({ configured: true, connected: true, devices: ((await res.json()).devices || []).map(dev) });
    }
    const res = await sp(token, "/me/player");
    if (res.status === 204) return json({ configured: true, connected: true, player: { active: false, playing: false } });
    if (!res.ok) throw out(res, explain(res));
    return json({ configured: true, connected: true, player: slimPlayer(await res.json()) });
  } catch (e) {
    return fail(e.status || 502, e.status ? e.message : "Couldn't reach Spotify.");
  }
}

const PUT = (path, body) => ({ method: "PUT", body: body ? JSON.stringify(body) : undefined });
export async function POST(request) {
  const denied = guard(request);
  if (denied) return denied;
  let b; try { b = await readJson(request, 2000); } catch { return fail(400, "That request couldn't be read."); }
  const c = creds(); if (!c) return fail(404, "Spotify isn't set up yet.");
  try {
    if (b.op === "disconnect") { await redis().del(KEY); return json({ ok: true }); }
    const token = await accessToken(c); if (!token) return fail(409, "Connect Spotify first.");
    const id = typeof b.device_id === "string" && /^[A-Za-z0-9]{10,64}$/.test(b.device_id) ? "?device_id=" + b.device_id : "";
    let res;
    if (b.op === "play") res = await sp(token, "/me/player/play" + id, PUT());
    else if (b.op === "pause") res = await sp(token, "/me/player/pause" + id, PUT());
    else if (b.op === "next") res = await sp(token, "/me/player/next" + id, { method: "POST" });
    else if (b.op === "previous") res = await sp(token, "/me/player/previous" + id, { method: "POST" });
    else if (b.op === "volume") { const v = Math.max(0, Math.min(100, Math.round(Number(b.percent)))); if (!Number.isFinite(v)) return fail(400, "Pick a volume."); res = await sp(token, "/me/player/volume?volume_percent=" + v + (id ? "&" + id.slice(1) : ""), PUT()); }
    else if (b.op === "shuffle") res = await sp(token, "/me/player/shuffle?state=" + (b.state ? "true" : "false") + (id ? "&" + id.slice(1) : ""), PUT());
    else if (b.op === "transfer") { if (!id) return fail(400, "Pick a device."); res = await sp(token, "/me/player", PUT("", { device_ids: [id.slice(11)], play: !!b.play })); }
    else return fail(400, "That action isn't allowed.");
    if (!res.ok && res.status !== 202) throw out(res, explain(res));
    return json({ ok: true });
  } catch (e) {
    return fail(e.status || 502, e.status ? e.message : "Couldn't reach Spotify.");
  }
}
