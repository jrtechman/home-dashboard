import crypto from "node:crypto";
import { json, fail, guard, readJson, redis, keys, HOME_TZ, isSignedIn } from "../server.js";
import { remOccurs } from "../recurrence.js";
import { loadCalendar } from "./calendar.js";
import { verseOfDay } from "./verse.js";

// Morning briefing as plain text, meant for an iPhone Shortcut that texts it to you.
// GET /api/briefing?key=<link key>[&who=Name][&format=json]   (the key can be replaced by being signed in, for the preview)
// POST { op: "key" | "reset" }  (signed in) -> { key }   The key lives in Redis (hd:briefing). Anyone with the link can read the briefing.
const KEY = "hd:briefing";
const parse = (v) => (typeof v === "string" ? JSON.parse(v) : v);
const same = (a, b) => { const x = Buffer.from(String(a)), y = Buffer.from(String(b)); return x.length === y.length && crypto.timingSafeEqual(x, y); };
const when = (h) => { const [H, M] = String(h).split(":").map(Number); return `${H % 12 || 12}${M ? ":" + String(M).padStart(2, "0") : ""} ${H >= 12 ? "PM" : "AM"}`; };
const WX = { 0: "clear", 1: "mostly clear", 2: "partly cloudy", 3: "cloudy", 45: "foggy", 48: "foggy", 51: "light drizzle", 53: "drizzle", 55: "heavy drizzle", 61: "light rain", 63: "rain", 65: "heavy rain", 71: "light snow", 73: "snow", 75: "heavy snow", 77: "snow grains", 80: "rain showers", 81: "rain showers", 82: "heavy showers", 85: "snow showers", 86: "snow showers", 95: "thunderstorms", 96: "thunderstorms with hail", 99: "thunderstorms with hail" };

async function hash(coll) { try { return Object.entries((await redis().hgetall(keys.coll(coll))) || {}).map(([id, v]) => { const x = parse(v); return x && typeof x === "object" ? { ...x, id } : null; }).filter(Boolean); } catch { return []; } }

async function weatherLine(place) {
  if (!place || !Number.isFinite(place.lat) || !Number.isFinite(place.lon)) return "";
  try {
    const u = `https://api.open-meteo.com/v1/forecast?latitude=${Number(place.lat).toFixed(4)}&longitude=${Number(place.lon).toFixed(4)}&current=temperature_2m,apparent_temperature,weather_code&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max,snowfall_sum&temperature_unit=fahrenheit&precipitation_unit=inch&timezone=auto&forecast_days=1`;
    const res = await fetch(u, { signal: AbortSignal.timeout(8000) }); if (!res.ok) return "";
    const w = await res.json(), c = w.current || {}, d = w.daily || {};
    const r = (n) => Math.round(n);
    let t = `${r(c.temperature_2m)}° now`; if (Math.abs(c.apparent_temperature - c.temperature_2m) >= 4) t += ` (feels like ${r(c.apparent_temperature)}°)`;
    t += `, ${WX[d.weather_code?.[0]] || WX[c.weather_code] || "mixed"}. High ${r(d.temperature_2m_max?.[0])}°, low ${r(d.temperature_2m_min?.[0])}°.`;
    const p = d.precipitation_probability_max?.[0]; if (p >= 30) t += ` ${p}% chance of ${d.snowfall_sum?.[0] > 0 ? "snow" : "rain"}.`;
    return t;
  } catch { return ""; }
}

export async function buildBriefing(who = "") {
  const day = new Intl.DateTimeFormat("en-CA", { timeZone: HOME_TZ }).format(new Date());
  const [y, m, d] = day.split("-").map(Number);
  const dateText = new Intl.DateTimeFormat("en-US", { timeZone: HOME_TZ, weekday: "long", month: "long", day: "numeric" }).format(new Date(Date.UTC(y, m - 1, d, 12)));
  let settings = {}; try { const s = await redis().get(keys.settings); settings = s ? parse(s) : {}; } catch { /* ignore */ }
  const mine = (x) => !who || !x.who || x.who === who;
  const [events, todos, reminders, dinner, recipes, cal, verse, wx] = await Promise.all([
    hash("events"), hash("todos"), hash("reminders"), hash("dinnerlist"), hash("recipes"),
    loadCalendar().catch(() => null), verseOfDay().catch(() => null), weatherLine(settings.place),
  ]);
  const evs = [...events.filter((e) => e.date === day), ...((cal && cal.events) || []).filter((e) => e.date === day && !String(e.uid || "").startsWith("hd-"))]
    .filter(mine).sort((a, b) => String(a.time || "").localeCompare(String(b.time || "")));
  const seen = new Set(), evLines = [];
  for (const e of evs) { const k = e.title + "|" + (e.time || ""); if (seen.has(k)) continue; seen.add(k); evLines.push(`• ${e.time ? when(e.time) + " " : ""}${e.title}${e.location ? " @ " + String(e.location).split("\n")[0] : ""}`); }
  const tasks = todos.filter((t) => t.text && !t.done && t.date && t.date <= day && mine(t)).sort((a, b) => (a.date + (a.time || "99")).localeCompare(b.date + (b.time || "99")));
  const rems = reminders.filter((r) => r.title && r.doneOn !== day && remOccurs(r, day));
  const kindText = (x) => (x.kind === "out" ? "Eating out" : "On your own") + (x.note ? ": " + x.note : "");
  const forMe = (x) => !who || !Array.isArray(x.for) || !x.for.length || x.for.includes(who);
  const todays = dinner.filter((x) => x.date === day && forMe(x));
  const dinners = todays.filter((x) => x.meal !== "lunch"), lunches = todays.filter((x) => x.meal === "lunch");
  const label = (x) => (x.kind ? kindText(x) : (recipes.find((r) => r.id === x.recipeId) || {}).title || "") + (!who && Array.isArray(x.for) && x.for.length ? " (for " + x.for.join(" and ") + ")" : "");
  let tonight = ""; const tn = settings.tonight;
  const tnRecipe = tn && tn.date === day && recipes.find((r) => r.id === tn.id);
  tonight = tnRecipe ? tnRecipe.title : dinners.map(label).filter(Boolean).join(", ");
  const lunch = lunches.map(label).filter(Boolean).join(", ");
  const out = [`Good morning${who ? ", " + who : ""}! ${dateText}`];
  if (wx) out.push("", "Weather: " + wx);
  out.push("", "Today:", ...(evLines.length ? evLines : ["• Nothing on the calendar"]));
  if (tasks.length) out.push("", "Tasks due:", ...tasks.map((t) => `• ${t.text}${t.date === day ? (t.time ? " at " + when(t.time) : "") : " (overdue)"}`));
  if (rems.length) out.push("", "Reminders:", ...rems.map((r) => "• " + r.title));
  if (lunch) out.push("", "Lunch: " + lunch);
  if (tonight) out.push("", "Dinner tonight: " + tonight);
  if (verse && verse.ref) out.push("", verse.text ? `"${verse.text}" (${verse.ref}, ESV)` : `Verse of the day: ${verse.ref}`);
  return out.join("\n");
}

async function savedKey() { try { const v = await redis().get(KEY); return v ? String(parse(v).key || parse(v)) : ""; } catch { return ""; } }
async function ensureKey(reset) {
  let k = reset ? "" : await savedKey();
  if (!k) { k = crypto.randomBytes(18).toString("base64url"); await redis().set(KEY, { key: k }); }
  return k;
}

export async function GET(request) {
  const u = new URL(request.url), given = u.searchParams.get("key") || "";
  let ok = false;
  if (given) { const k = await savedKey(); ok = !!k && same(given, k); if (!ok) return fail(401, "That link isn't valid. Make a new one in Settings."); }
  else ok = isSignedIn(request);
  if (!ok) { const denied = guard(request); if (denied) return denied; }
  try {
    const who = (u.searchParams.get("who") || "").trim().slice(0, 40);
    const text = await buildBriefing(who);
    if (u.searchParams.get("format") === "json") return json({ text });
    return new Response(text, { status: 200, headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" } });
  } catch (e) { return fail(500, "Couldn't put the briefing together."); }
}

export async function POST(request) {
  const denied = guard(request); if (denied) return denied;
  let b; try { b = await readJson(request, 500); } catch { return fail(400, "That request couldn't be read."); }
  if (!["key", "reset", "status"].includes(b.op)) return fail(400, "That action isn't allowed.");
  if (b.op === "status") return json({ exists: !!(await savedKey()) });
  try { return json({ key: await ensureKey(b.op === "reset") }); } catch (e) { return fail(500, e.message || "Couldn't make the link."); }
}
