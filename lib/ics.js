// Turns iCalendar (.ics) text into simple day-by-day events in the household's time zone.
import ical from "node-ical";

function parts(date, tz) {
  const f = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).formatToParts(date);
  const g = (t) => f.find((p) => p.type === t)?.value;
  return { date: `${g("year")}-${g("month")}-${g("day")}`, time: `${g("hour")}:${g("minute")}` };
}
function dayKeyUTC(d) { return d.toISOString().slice(0, 10); }
function addDayKey(key, n) {
  const d = new Date(key + "T12:00:00Z"); d.setUTCDate(d.getUTCDate() + n); return dayKeyUTC(d);
}
const text = (v) => (v == null ? "" : typeof v === "object" ? String(v.val ?? "") : String(v)).trim();

/**
 * @param {string} icsText
 * @param {{cal:string, tz:string, from:Date, to:Date}} opts
 */
export async function eventsFromIcs(icsText, { cal, tz, from, to }) {
  const data = await ical.async.parseICS(icsText);
  const out = [];
  for (const ev of Object.values(data)) {
    if (!ev || ev.type !== "VEVENT" || !ev.start) continue;
    if (String(ev.status || "").toUpperCase() === "CANCELLED") continue;
    let instances;
    try {
      instances = ical.expandRecurringEvent(ev, { from, to, expandOngoing: true });
    } catch {
      instances = [{ start: ev.start, end: ev.end, summary: ev.summary, isFullDay: ev.datetype === "date" || ev.start.dateOnly, event: ev }];
    }
    for (const inst of instances) {
      const src = inst.event || ev;
      const title = text(inst.summary ?? src.summary) || "Busy";
      const location = text(src.location);
      const notes = text(src.description).replace(/\r/g, "").slice(0, 1500);
      const link = text(src.url);
      const who = (Array.isArray(src.attendee) ? src.attendee : src.attendee ? [src.attendee] : [])
        .map((a) => text(a?.params?.CN) || text(a).replace(/^mailto:/i, "")).filter(Boolean).slice(0, 12);
      const more = { notes, link, people: who };
      const start = new Date(inst.start);
      const end = inst.end ? new Date(inst.end) : null;
      const allDay = !!(inst.isFullDay || inst.start?.dateOnly);
      if (allDay) {
        // All-day dates are calendar days, not instants; read them in their own zone.
        const ztz = inst.start?.tz || src.start?.tz || "UTC";
        let first = parts(start, ztz).date;
        let last = end ? addDayKey(parts(end, inst.end?.tz || ztz).date, -1) : first;
        if (last < first) last = first;
        for (let k = first, i = 0; k <= last && i < 62; k = addDayKey(k, 1), i++) {
          out.push({ id: `${src.uid || title}|${k}`, title, date: k, time: "", end: "", allDay: true, cal, location, ...more, uid: String(src.uid || "") });
        }
      } else {
        const s = parts(start, tz);
        const e = end ? parts(end, tz) : null;
        out.push({
          id: `${src.uid || title}|${start.toISOString()}`, title, date: s.date, time: s.time,
          end: e && e.date === s.date ? e.time : "", allDay: false, cal, location, ...more, uid: String(src.uid || ""),
        });
      }
    }
  }
  return out;
}
