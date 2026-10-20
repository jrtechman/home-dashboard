import { json, fail, guard } from "../lib/server.js";

// Reads YNAB (read-only) and returns only the categories you chose in YNAB_CATEGORIES.
let cache = { at: 0, body: null };
const FRESH_MS = 5 * 60 * 1000;
const norm = (s) => String(s || "").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();

export async function GET(request) {
  const denied = guard(request);
  if (denied) return denied;
  const token = process.env.YNAB_TOKEN;
  if (!token) return fail(404, "YNAB isn't connected. Add YNAB_TOKEN in Vercel.");
  if (cache.body && Date.now() - cache.at < FRESH_MS) return json(cache.body);

  const budget = encodeURIComponent(process.env.YNAB_BUDGET_ID || "last-used");
  try {
    const res = await fetch(`https://api.ynab.com/v1/budgets/${budget}/months/current`, {
      headers: { authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(10_000),
    });
    if (res.status === 401) return fail(502, "YNAB rejected the token. Make a new one in YNAB and update YNAB_TOKEN.");
    if (res.status === 429) return fail(503, "YNAB says too many requests. It will refresh shortly.");
    if (!res.ok) return fail(502, "YNAB didn't answer. It will try again shortly.");
    const { data } = await res.json();
    const cats = (data.month.categories || []).filter((c) => !c.hidden && !c.deleted && c.name !== "Inflow: Ready to Assign");
    const wanted = (process.env.YNAB_CATEGORIES || "").split(",").map(norm).filter(Boolean);
    const overspent = cats.filter((c) => c.balance < 0).length;
    const body = {
      month: data.month.month,
      overspent,
      fetchedAt: new Date().toISOString(),
      currency: process.env.CURRENCY || "USD",
    };
    if (!wanted.length) {
      // Names only, no amounts, so you can pick which ones to show.
      body.needsSetup = true;
      body.available = cats.map((c) => c.name);
      body.categories = [];
    } else {
      body.categories = wanted
        .map((w) => cats.find((c) => norm(c.name) === w))
        .filter(Boolean)
        .map((c) => ({ name: c.name, balance: c.balance / 1000, assigned: c.budgeted / 1000, spent: -c.activity / 1000 }));
    }
    cache = { at: Date.now(), body };
    return json(body);
  } catch {
    return fail(502, "Couldn't reach YNAB. It will try again shortly.");
  }
}
