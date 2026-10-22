import { json, fail, guard, readJson } from "../server.js";

// POST { q } -> { results: [{ title, url, site, snippet }], via }
// Uses the Brave Search API when BRAVE_SEARCH_KEY is set (free tier is plenty for a household);
// otherwise falls back to DuckDuckGo's plain HTML results, which works without any key but may be blocked now and then.

const SKIP = /(^|\.)(youtube\.com|youtu\.be|pinterest\.[a-z.]+|facebook\.com|instagram\.com|tiktok\.com|reddit\.com|x\.com|twitter\.com|amazon\.[a-z.]+|wikipedia\.org)$/i;

const decode = (s) => String(s || "")
  .replace(/<[^>]*>/g, "")
  .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#x27;|&#39;/g, "'").replace(/&nbsp;/g, " ")
  .replace(/\s+/g, " ").trim();

function tidy(list) {
  const seen = new Set(), out = [];
  for (const r of list) {
    let u; try { u = new URL(r.url); } catch { continue; }
    if (!/^https?:$/.test(u.protocol) || SKIP.test(u.hostname)) continue;
    const key = u.hostname + u.pathname.replace(/\/+$/, "");
    if (seen.has(key)) continue; seen.add(key);
    out.push({ title: decode(r.title).slice(0, 140), url: u.toString(), site: u.hostname.replace(/^www\./, ""), snippet: decode(r.snippet).slice(0, 220) });
    if (out.length >= 8) break;
  }
  return out;
}

async function brave(q, key) {
  const res = await fetch("https://api.search.brave.com/res/v1/web/search?count=15&safesearch=moderate&q=" + encodeURIComponent(q + " recipe"), {
    headers: { accept: "application/json", "x-subscription-token": key }, signal: AbortSignal.timeout(9000),
  });
  if (!res.ok) throw new Error("brave " + res.status);
  const d = await res.json();
  return tidy((d.web?.results || []).map((r) => ({ title: r.title, url: r.url, snippet: r.description })));
}

export function parseDuck(html) {
  const out = [];
  const re = /<a[^>]+class="[^"]*result__a[^"]*"[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>([\s\S]*?)(?=<a[^>]+class="[^"]*result__a|$)/g;
  let m;
  while ((m = re.exec(html))) {
    let href = m[1].replace(/&amp;/g, "&");
    if (href.startsWith("//")) href = "https:" + href;
    try { const u = new URL(href); if (u.hostname.endsWith("duckduckgo.com") && u.searchParams.get("uddg")) href = u.searchParams.get("uddg"); } catch { continue; }
    const sn = /class="[^"]*result__snippet[^"]*"[^>]*>([\s\S]*?)<\/(?:a|div|td)>/.exec(m[3]);
    out.push({ title: m[2], url: href, snippet: sn ? sn[1] : "" });
  }
  return tidy(out);
}

async function duck(q) {
  const res = await fetch("https://html.duckduckgo.com/html/?q=" + encodeURIComponent(q + " recipe"), {
    headers: { "user-agent": "Mozilla/5.0 (compatible; HomeDashboard/1.0)", accept: "text/html" }, signal: AbortSignal.timeout(9000),
  });
  if (!res.ok) throw new Error("duck " + res.status);
  const html = await res.text();
  const r = parseDuck(html);
  if (!r.length && /anomaly|captcha|unusual traffic/i.test(html)) throw new Error("duck blocked");
  return r;
}

export async function POST(request) {
  const denied = guard(request);
  if (denied) return denied;
  let body;
  try { body = await readJson(request, 2000); } catch { return fail(400, "Type what you want to search for."); }
  const q = String(body.q || "").trim().slice(0, 120);
  if (q.length < 2) return fail(400, "Type what you want to search for.");
  try {
    const key = process.env.BRAVE_SEARCH_KEY;
    const results = key ? await brave(q, key) : await duck(q);
    return json({ results, via: key ? "brave" : "duckduckgo" });
  } catch (e) {
    return fail(502, process.env.BRAVE_SEARCH_KEY ? "The recipe search didn't answer. Try again in a moment." : "Recipe search is busy or blocked right now. Add a free BRAVE_SEARCH_KEY in Vercel for steady results.");
  }
}
