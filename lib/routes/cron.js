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
    const tk = (await redis().hgetall(keys.coll("todos"))) || {};
    const tdue = Object.values(tk).map(parse).filter((x) => x && x.notify && !x.done && x.text && x.date === day)
      .sort((a, b) => String(a.time || "99").localeCompare(String(b.time || "99")));
    const when = (h) => { const [H, M] = h.split(":").map(Number); return `${H % 12 || 12}${M ? ":" + String(M).padStart(2, "0") : ""} ${H >= 12 ? "PM" : "AM"}`; };
    if (tdue.length) await notify("tasks", { title: tdue.length === 1 ? "Task due today" : "Tasks due today", body: tdue.map((x) => x.text + (x.time ? " at " + when(x.time) : "")).join(" · ").slice(0, 160), url: "/", tag: "tasks" });
    const dc = (await redis().hgetall(keys.coll("dogcare"))) || {};
    const ddue = Object.values(dc).map(parse).filter((x) => x && x.notify && !x.done && x.name && x.due === day);
    if (ddue.length) await notify("dog", { title: ddue.length === 1 ? "Dog care due today" : "Dog care due today", body: ddue.map((x) => x.name).join(" · ").slice(0, 160), url: "/", tag: "dog" });
    return json({ ok: true, day, sent: due.length, tasks: tdue.length, dog: ddue.length });
  } catch (e) { return fail(500, e.message || "Couldn't run reminders."); }
}
