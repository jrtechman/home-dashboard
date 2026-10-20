import { json, fail, guard } from "../lib/server.js";
import { appleConfigured, appleCalendars, appleMessage } from "../lib/caldav.js";

// GET -> { calendars: ["Family", ...], default: "Family" }  (the iCloud calendars events can be saved into)
export async function GET(request) {
  const denied = guard(request);
  if (denied) return denied;
  if (!appleConfigured()) return fail(404, "Apple Calendar saving isn't set up.");
  try {
    const names = (await appleCalendars({ fresh: new URL(request.url).searchParams.has("fresh") })).map((c) => c.name);
    const want = String(process.env.ICLOUD_CALENDAR || "").trim().toLowerCase();
    const def = names.find((n) => n.toLowerCase() === want) || names[0];
    return json({ calendars: names, default: def });
  } catch (e) {
    return fail(502, appleMessage(e));
  }
}
