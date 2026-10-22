import { json, fail, guard, readJson } from "../server.js";

// Home Assistant bridge. HA_URL is where this server can reach Home Assistant (for example the Nabu Casa remote address or a
// Tailscale Funnel address, https), HA_TOKEN is a long-lived access token made in Home Assistant under your profile.
// GET  -> { configured, entities: [...] }       (lights, thermostats, switches, scenes, scripts, covers, fans)
// POST { domain, service, entity_id, data? }    (only a short list of safe services)

const DOMAINS = ["light", "climate", "switch", "scene", "script", "cover", "fan", "input_boolean"];
const ALLOWED = {
  light: ["turn_on", "turn_off", "toggle"],
  climate: ["set_temperature", "set_hvac_mode"],
  switch: ["turn_on", "turn_off", "toggle"],
  input_boolean: ["turn_on", "turn_off", "toggle"],
  fan: ["turn_on", "turn_off", "toggle"],
  scene: ["turn_on"],
  script: ["turn_on"],
  cover: ["open_cover", "close_cover", "stop_cover"],
};
const DATA_KEYS = ["brightness_pct", "color_temp_kelvin", "temperature", "target_temp_high", "target_temp_low", "hvac_mode", "percentage"];

function cfg() {
  const base = String(process.env.HA_URL || "").trim().replace(/\/+$/, "");
  const token = String(process.env.HA_TOKEN || "").trim();
  if (!/^https?:\/\//i.test(base) || !token) return null;
  return { base, token };
}

async function ha(c, path, init = {}) {
  const res = await fetch(c.base + path, { ...init, headers: { authorization: "Bearer " + c.token, "content-type": "application/json", ...(init.headers || {}) }, signal: AbortSignal.timeout(9000) });
  if (res.status === 401 || res.status === 403) throw Object.assign(new Error("Home Assistant refused the token. Make a new long-lived token and update HA_TOKEN."), { status: 502 });
  if (!res.ok) throw Object.assign(new Error("Home Assistant answered with an error (" + res.status + ")."), { status: 502 });
  return res;
}

export function slim(s) {
  const a = s.attributes || {};
  const [domain] = String(s.entity_id).split(".");
  const out = { id: s.entity_id, domain, name: a.friendly_name || s.entity_id, state: s.state };
  if (domain === "light") Object.assign(out, { brightness: a.brightness ?? null, modes: a.supported_color_modes || [], group: !!(a.is_hue_group || a.is_deconz_group || Array.isArray(a.entity_id)) });
  if (domain === "climate") Object.assign(out, { current: a.current_temperature ?? null, target: a.temperature ?? null, low: a.target_temp_low ?? null, high: a.target_temp_high ?? null, hvacModes: a.hvac_modes || [], action: a.hvac_action || "", min: a.min_temp ?? null, max: a.max_temp ?? null, step: a.target_temp_step || a.target_temperature_step || null });
  if (domain === "fan") out.percentage = a.percentage ?? null;
  return out;
}

export async function GET(request) {
  const denied = guard(request);
  if (denied) return denied;
  const c = cfg();
  if (!c) return json({ configured: false, entities: [] });
  try {
    const res = await ha(c, "/api/states");
    const all = await res.json();
    const entities = all.filter((s) => DOMAINS.includes(String(s.entity_id).split(".")[0]) && s.state !== "unavailable" ).map(slim);
    return json({ configured: true, entities });
  } catch (e) {
    return fail(e.status || 502, e.status ? e.message : "Couldn't reach Home Assistant. Check HA_URL.");
  }
}

export async function POST(request) {
  const denied = guard(request);
  if (denied) return denied;
  const c = cfg();
  if (!c) return fail(404, "Home Assistant isn't connected yet.");
  let b;
  try { b = await readJson(request, 3000); } catch { return fail(400, "That request couldn't be read."); }
  const id = String(b.entity_id || ""), domain = String(b.domain || ""), service = String(b.service || "");
  if (!/^[a-z_]+\.[a-z0-9_]+$/.test(id) || id.split(".")[0] !== domain || !(ALLOWED[domain] || []).includes(service)) return fail(400, "That action isn't allowed.");
  const data = {};
  for (const k of DATA_KEYS) if (b.data && b.data[k] !== undefined) { const v = b.data[k]; if (typeof v === "number" || (k === "hvac_mode" && /^[a-z_]+$/.test(String(v)))) data[k] = v; }
  try {
    await ha(c, `/api/services/${domain}/${service}`, { method: "POST", body: JSON.stringify({ entity_id: id, ...data }) });
    return json({ ok: true });
  } catch (e) {
    return fail(e.status || 502, e.status ? e.message : "Couldn't reach Home Assistant. Check HA_URL.");
  }
}
