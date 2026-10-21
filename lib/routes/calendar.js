import { json, fail, guard, HOME_TZ } from "../server.js";
import { eventsFromIcs } from "../ics.js";

// CALENDARS = "Family|webcal://p140-caldav.icloud.com/published/2/...; Jason|webcal://..."
function calendars() {
  return (process.env.CALENDARS || "")
    .split(/[;\n]+/).map((s) => s.trim()).filter(Boolean)
    .map((entry, i) => {
      const bar = entry.indexOf("|");
      const name = bar > 0 ? entry.slice(0, bar).trim() : `Calendar ${i + 1}`;
      const url = (bar > 0 ? entry.slice(bar + 1) : entry).trim().replace(/^webcals?:\/\//i, "https://");
      return { name, url };
    });
}

let cache = { at: 0, body: null };
const FRESH_MS = 5 * 60 * 1000;

// GET -> { events: [...], errors: [calendar names that failed], fetchedAt }
export async function GET(request) {
  const denied = guard(request);
  if (denied) return denied;
  const list = calendars();
  if (!list.length) return fail(404, "No calendars set. Add CALENDARS in Vercel.");
  if (cache.body && Date.now() - cache.at < FRESH_MS) return json(cache.body);

  const from = new Date(Date.now() - 2 * 864e5);
  const to = new Date(Date.now() + 45 * 864e5);
  const events = [], errors = [];
  await Promise.all(list.map(async (c) => {
    try {
      const res = await fetch(c.url, { signal: AbortSignal.timeout(10_000), headers: { accept: "text/calendar" } });
      if (!res.ok) throw new Error(String(res.status));
      events.push(...(await eventsFromIcs(await res.text(), { cal: c.name, tz: HOME_TZ, from, to })));
    } catch {
      errors.push(c.name);
    }
  }));
  events.sort((a, b) => (a.date + (a.time || "")).localeCompare(b.date + (b.time || "")));
  const body = { events, errors, names: list.map((c) => c.name), fetchedAt: new Date().toISOString() };
  if (!errors.length) cache = { at: Date.now(), body };
  return json(body);
}
