// Saves dashboard events into a real iCloud calendar over CalDAV (the protocol Apple Calendar itself uses).
// Sign-in is your Apple ID plus an app-specific password, never your normal Apple password.
import { XMLParser } from "fast-xml-parser";
import { redis } from "./server.js";

const BASE = (process.env.ICLOUD_CALDAV_URL || "https://caldav.icloud.com/").replace(/\/?$/, "/");
const xml = new XMLParser({ removeNSPrefix: true, ignoreAttributes: false, attributeNamePrefix: "@_" });
const arr = (v) => (v == null ? [] : Array.isArray(v) ? v : [v]);

export const appleConfigured = () => !!(process.env.ICLOUD_ID && process.env.ICLOUD_APP_PASSWORD);

class AppleError extends Error {}

async function dav(method, url, { depth, body, headers = {} } = {}) {
  const auth = Buffer.from(`${process.env.ICLOUD_ID}:${process.env.ICLOUD_APP_PASSWORD}`).toString("base64");
  let res;
  try {
    res = await fetch(url, {
      method,
      redirect: "manual",
      headers: { authorization: `Basic ${auth}`, ...(depth != null ? { depth: String(depth) } : {}), ...(body ? { "content-type": "application/xml; charset=utf-8" } : {}), ...headers },
      body,
      signal: AbortSignal.timeout(12_000),
    });
  } catch {
    throw new AppleError("Couldn't reach iCloud.");
  }
  if (res.status === 401 || res.status === 403) throw new AppleError("Apple didn't accept the Apple ID or app-specific password. Check ICLOUD_ID and ICLOUD_APP_PASSWORD in Vercel.");
  return res;
}

const abs = (href, from) => new URL(href, from).toString();
const propfind = (url, depth, props) =>
  dav("PROPFIND", url, {
    depth,
    body: `<?xml version="1.0" encoding="utf-8"?><d:propfind xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav" xmlns:cs="http://calendarserver.org/ns/"><d:prop>${props}</d:prop></d:propfind>`,
  });
async function multistatus(res) {
  if (res.status !== 207) throw new AppleError(`iCloud answered ${res.status} when looking for your calendars.`);
  return arr(xml.parse(await res.text())?.multistatus?.response);
}
const okProp = (r) => {
  const ps = arr(r.propstat).find((p) => String(p.status || "").includes(" 200")) || arr(r.propstat)[0];
  return (ps && ps.prop) || {};
};
const text = (v) => (v == null ? "" : typeof v === "object" ? String(v["#text"] ?? "") : String(v)).trim();

let mem = null;
/** Your writable calendars: [{ name, url }]. Remembered for a day so saving an event stays quick. */
export async function appleCalendars({ fresh = false } = {}) {
  if (!fresh && mem && Date.now() - mem.at < 3600e3) return mem.list;
  const key = "hd:apple:cals";
  if (!fresh) {
    try {
      const c = await redis().get(key);
      const v = typeof c === "string" ? JSON.parse(c) : c;
      if (v && v.id === process.env.ICLOUD_ID && Array.isArray(v.list) && v.list.length) { mem = { at: Date.now(), list: v.list }; return v.list; }
    } catch { /* look it up */ }
  }
  const p = await multistatus(await propfind(BASE, 0, "<d:current-user-principal/>"));
  const principalHref = text(okProp(p[0])["current-user-principal"]?.href);
  if (!principalHref) throw new AppleError("iCloud didn't say which account this is.");
  const principal = abs(principalHref, BASE);
  const h = await multistatus(await propfind(principal, 0, "<c:calendar-home-set/>"));
  const homeHref = text(okProp(h[0])["calendar-home-set"]?.href);
  if (!homeHref) throw new AppleError("iCloud didn't return your calendar folder.");
  const home = abs(homeHref, principal);
  const rows = await multistatus(await propfind(home, 1, "<d:displayname/><d:resourcetype/><c:supported-calendar-component-set/>"));
  const list = [];
  for (const r of rows) {
    const pr = okProp(r);
    const rt = pr.resourcetype || {};
    if (!("calendar" in (typeof rt === "object" ? rt : {}))) continue;
    const comps = arr(pr["supported-calendar-component-set"]?.comp).map((c) => c["@_name"]);
    if (comps.length && !comps.includes("VEVENT")) continue; // reminders lists etc.
    const name = text(pr.displayname);
    if (!name) continue;
    let url = abs(text(r.href), home);
    if (!url.endsWith("/")) url += "/";
    list.push({ name, url });
  }
  if (!list.length) throw new AppleError("No calendars were found in that iCloud account.");
  mem = { at: Date.now(), list };
  try { await redis().set(key, { id: process.env.ICLOUD_ID, list }, { ex: 86400 }); } catch { /* fine */ }
  return list;
}

async function calendarUrl(name) {
  let list = await appleCalendars();
  let c = list.find((x) => x.name.toLowerCase() === String(name).toLowerCase());
  if (!c) { list = await appleCalendars({ fresh: true }); c = list.find((x) => x.name.toLowerCase() === String(name).toLowerCase()); }
  if (!c) throw new AppleError(`There's no iCloud calendar called "${name}".`);
  return c.url;
}

/* ---- .ics ---- */
const esc = (s) => String(s ?? "").replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");
const fold = (line) => { const out = []; let l = line; while (Buffer.byteLength(l) > 74) { let n = 74; while (Buffer.byteLength(l.slice(0, n)) > 74) n--; out.push(l.slice(0, n)); l = " " + l.slice(n); } out.push(l); return out.join("\r\n"); };
const stamp = (d) => d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
const dateOnly = (k) => k.replace(/-/g, "");
function addDay(k, n) { const d = new Date(k + "T12:00:00Z"); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); }
function offsetMs(date, tz) {
  const f = new Intl.DateTimeFormat("en-US", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" }).formatToParts(date);
  const g = (t) => Number(f.find((p) => p.type === t).value);
  return Date.UTC(g("year"), g("month") - 1, g("day"), g("hour"), g("minute"), g("second")) - Math.floor(date.getTime() / 1000) * 1000;
}
/** "2026-10-20" + "18:30" in a time zone -> the exact moment. */
export function zonedToUtc(day, time, tz) {
  const [y, m, d] = day.split("-").map(Number), [hh, mm] = time.split(":").map(Number);
  const wall = Date.UTC(y, m - 1, d, hh, mm);
  let t = wall;
  for (let i = 0; i < 3; i++) t = wall - offsetMs(new Date(t), tz);
  return new Date(t);
}
export const eventUid = (id) => `hd-${id}@home-dashboard`;

export function buildIcs(ev, id, tz) {
  const lines = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Home Dashboard//EN", "CALSCALE:GREGORIAN", "BEGIN:VEVENT", `UID:${eventUid(id)}`, `DTSTAMP:${stamp(new Date())}`];
  if (ev.time) {
    const start = zonedToUtc(ev.date, ev.time, tz);
    lines.push(`DTSTART:${stamp(start)}`, `DTEND:${stamp(new Date(start.getTime() + 3600e3))}`);
  } else {
    lines.push(`DTSTART;VALUE=DATE:${dateOnly(ev.date)}`, `DTEND;VALUE=DATE:${dateOnly(addDay(ev.date, 1))}`);
  }
  lines.push(`SUMMARY:${esc(ev.title)}`);
  if (ev.who) lines.push(`DESCRIPTION:${esc("For " + ev.who + " · added from the home dashboard")}`);
  lines.push("END:VEVENT", "END:VCALENDAR");
  return lines.map(fold).join("\r\n") + "\r\n";
}

export async function putEvent(calName, id, ev, tz) {
  const url = (await calendarUrl(calName)) + encodeURIComponent(eventUid(id)) + ".ics";
  const res = await dav("PUT", url, { body: buildIcs(ev, id, tz), headers: { "content-type": "text/calendar; charset=utf-8" } });
  if (![200, 201, 204].includes(res.status)) throw new AppleError(`iCloud wouldn't save the event (${res.status}).`);
}
export async function deleteEvent(calName, id) {
  const url = (await calendarUrl(calName)) + encodeURIComponent(eventUid(id)) + ".ics";
  const res = await dav("DELETE", url);
  if (![200, 204, 404].includes(res.status)) throw new AppleError(`iCloud wouldn't remove the event (${res.status}).`);
}
export const appleMessage = (e) => (e instanceof AppleError ? e.message : "Couldn't reach Apple Calendar.");
