import { json, guard, HOME_TZ } from "../lib/server.js";

// Verse of the day: a reference picked by date from a fixed list, with the ESV text from api.esv.org (free key: ESV_API_KEY).
// Without the key you still get the reference and a link to read it.
const REFS = [
  "Psalm 23:1-3", "John 3:16", "Romans 8:28", "Philippians 4:6-7", "Proverbs 3:5-6", "Isaiah 41:10", "Joshua 1:9", "Jeremiah 29:11",
  "Matthew 11:28-30", "Psalm 46:1-3", "2 Corinthians 5:17", "Galatians 2:20", "Ephesians 2:8-9", "Romans 12:1-2", "Hebrews 11:1", "James 1:2-4",
  "1 John 4:18-19", "Psalm 121:1-2", "Isaiah 40:30-31", "Matthew 6:33-34", "Colossians 3:23-24", "1 Corinthians 13:4-7", "Psalm 119:105", "Lamentations 3:22-23",
  "Micah 6:8", "Philippians 4:13", "Romans 5:8", "2 Timothy 1:7", "Psalm 27:1", "Proverbs 16:3", "John 14:27", "John 15:5",
  "Psalm 34:8", "Psalm 37:4-5", "Matthew 5:14-16", "Romans 15:13", "Ephesians 4:31-32", "1 Peter 5:6-7", "Zephaniah 3:17", "Deuteronomy 31:6",
  "Psalm 139:13-14", "Hebrews 12:1-2", "John 1:1-5", "Galatians 5:22-23", "Colossians 3:12-14", "Psalm 91:1-2", "Isaiah 26:3", "Proverbs 22:6",
  "Joshua 24:15", "1 Thessalonians 5:16-18", "Psalm 100:1-5", "Matthew 28:19-20", "Acts 1:8", "Romans 10:9-10", "1 John 1:9", "Psalm 51:10-12",
  "Psalm 103:1-5", "John 10:10", "Philippians 2:3-4", "2 Chronicles 7:14", "Isaiah 53:5", "Psalm 16:11", "Proverbs 18:10", "John 16:33",
  "Hebrews 4:15-16", "Titus 3:4-5", "Psalm 62:1-2", "Isaiah 43:1-2", "Romans 8:38-39", "1 Corinthians 10:13", "Ephesians 6:10-11", "James 4:7-8",
  "Psalm 19:1-2", "Genesis 1:1", "Exodus 14:14", "Numbers 6:24-26", "Ruth 1:16", "1 Samuel 16:7", "Psalm 56:3-4", "Psalm 90:12",
  "Ecclesiastes 3:1", "Isaiah 9:6", "Matthew 7:7-8", "Luke 1:37", "John 8:12", "Colossians 1:16-17", "1 Peter 2:9", "Revelation 21:4",
];

const cache = new Map();

export async function GET(request) {
  const denied = guard(request);
  if (denied) return denied;
  const day = new Intl.DateTimeFormat("en-CA", { timeZone: HOME_TZ }).format(new Date()); // YYYY-MM-DD
  const [y, m, d] = day.split("-").map(Number);
  const n = Math.floor(Date.UTC(y, m - 1, d) / 864e5);
  const ref = REFS[((n % REFS.length) + REFS.length) % REFS.length];
  const link = `https://www.esv.org/${encodeURIComponent(ref.replace(/\s+/g, "+"))}/`;
  const base = { day, ref, link };
  const key = process.env.ESV_API_KEY;
  if (!key) return json({ ...base, needsKey: true });
  if (cache.get(day)) return json(cache.get(day));
  try {
    const url = "https://api.esv.org/v3/passage/text/?" + new URLSearchParams({
      q: ref, "include-headings": "false", "include-footnotes": "false", "include-verse-numbers": "false",
      "include-short-copyright": "false", "include-passage-references": "false", "include-first-verse-numbers": "false",
    });
    const res = await fetch(url, { headers: { authorization: `Token ${key}` }, signal: AbortSignal.timeout(8000) });
    if (!res.ok) return json({ ...base, error: "The ESV service didn't answer. Check ESV_API_KEY." });
    const j = await res.json();
    const text = String((j.passages || [])[0] || "").replace(/\s+/g, " ").trim();
    if (!text) return json({ ...base, error: "No verse text came back." });
    const body = { ...base, text };
    cache.clear(); cache.set(day, body);
    return json(body);
  } catch {
    return json({ ...base, error: "Couldn't reach the ESV service." });
  }
}
