import { json, fail, redis, keys, HOME_TZ } from "../server.js";
import { notify, quiet } from "../push.js";
import { remOccurs } from "../recurrence.js";

const parse = (v) => (typeof v === "string" ? JSON.parse(v) : v);
// Called once a morning by Vercel Cron (see vercel.json). Needs CRON_SECRET set in Vercel; Vercel then sends it as a Bearer token.
export async function GET(request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) return fail(401, "Not allowed.");
  try {
    const day = new Intl.DateTimeFormat("en-CA", { timeZone: HOME_TZ }).format(new Date());
    if (!(await quiet(`cron:${day}`, 20 * 3600))) return json({ ok: true, already: true });
    const all = (await redis().hgetall(keys.coll("reminders"))) || {};
    const due = Object.values(all).map(parse).filter((r) => r && r.push && r.title && r.doneOn !== day && remOccurs(r, day));
    if (due.length) await notify("reminders", { title: due.length === 1 ? "Reminder for today" : "Reminders for today", body: due.map((r) => r.title).join(" · ").slice(0, 160), url: "/", tag: "reminders" });
    return json({ ok: true, day, sent: due.length });
  } catch (e) { return fail(500, e.message || "Couldn't run reminders."); }
}
