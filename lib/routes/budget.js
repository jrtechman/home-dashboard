import { json, fail, guard } from "../server.js";

// Reads YNAB (read-only). Returns the current month's categories (for the Main card and the Budget tab) plus,
// for the Budget tab, accounts, recent transactions, upcoming scheduled bills and a six-month trend.
let cache = { at: 0, body: null };
const FRESH_MS = 5 * 60 * 1000;
const norm = (s) => String(s || "").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
const mu = (n) => (typeof n === "number" ? Math.round(n) / 1000 : 0);
const day = (d) => d.toISOString().slice(0, 10);

export async function GET(request) {
  const denied = guard(request);
  if (denied) return denied;
  const token = process.env.YNAB_TOKEN;
  if (!token) return fail(404, "YNAB isn't connected. Add YNAB_TOKEN in Vercel.");
  if (cache.body && Date.now() - cache.at < FRESH_MS) return json(cache.body);

  const budget = encodeURIComponent(process.env.YNAB_BUDGET_ID || "last-used");
  const base = `https://api.ynab.com/v1/budgets/${budget}`;
  const get = (path) => fetch(base + path, { headers: { authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(10_000) });
  try {
    const since = day(new Date(Date.now() - 30 * 864e5));
    // The month is required; the rest are extras, so one failing does not break the page.
    const [monthRes, ...extras] = await Promise.allSettled([
      get("/months/current"), get("/accounts"), get(`/transactions?since_date=${since}`), get("/scheduled_transactions"), get("/months"),
    ]);
    if (monthRes.status !== "fulfilled") return fail(502, "Couldn't reach YNAB. It will try again shortly.");
    const res = monthRes.value;
    if (res.status === 401) return fail(502, "YNAB rejected the token. Make a new one in YNAB and update YNAB_TOKEN.");
    if (res.status === 429) return fail(503, "YNAB says too many requests. It will refresh shortly.");
    if (!res.ok) return fail(502, "YNAB didn't answer. It will try again shortly.");
    const { data } = await res.json();
    const data2 = async (r) => (r && r.status === "fulfilled" && r.value.ok ? (await r.value.json()).data : null);
    const [acc, txn, sch, mon] = await Promise.all(extras.map(data2));

    const cats = (data.month.categories || []).filter((c) => !c.hidden && !c.deleted && c.name !== "Inflow: Ready to Assign");
    const wanted = (process.env.YNAB_CATEGORIES || "").split(",").map(norm).filter(Boolean);
    const overspent = cats.filter((c) => c.balance < 0).length;
    const body = {
      month: data.month.month,
      overspent,
      fetchedAt: new Date().toISOString(),
      currency: process.env.CURRENCY || "USD",
      summary: {
        income: mu(data.month.income), assigned: mu(data.month.budgeted), spent: -mu(data.month.activity),
        toBeBudgeted: mu(data.month.to_be_budgeted), ageOfMoney: data.month.age_of_money ?? null,
      },
    };
    const row = (c) => ({
      name: c.name, group: c.category_group_name || "", balance: c.balance / 1000, assigned: c.budgeted / 1000, spent: -c.activity / 1000,
      ...(c.goal_type ? { goal: { type: c.goal_type, target: mu(c.goal_target), pct: c.goal_percentage_complete ?? null, under: mu(c.goal_under_funded) } } : {}),
    });
    // Every category (so the screen can offer a picker), plus the ones named in YNAB_CATEGORIES as the default for Main.
    body.all = cats.map(row);
    body.categories = wanted.map((w) => cats.find((c) => norm(c.name) === w)).filter(Boolean).map(row);

    if (acc) {
      body.accounts = (acc.accounts || []).filter((a) => !a.closed && !a.deleted)
        .map((a) => ({ name: a.name, type: a.type, balance: mu(a.balance), onBudget: !!a.on_budget }));
    }
    if (txn) {
      body.recent = (txn.transactions || []).filter((t) => !t.deleted && !t.transfer_account_id)
        .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0)).slice(0, 40)
        .map((t) => ({ date: t.date, payee: t.payee_name || "", category: t.category_name || "", account: t.account_name || "", amount: mu(t.amount), memo: t.memo || "" }));
    }
    if (sch) {
      const limit = day(new Date(Date.now() + 30 * 864e5));
      body.upcoming = (sch.scheduled_transactions || []).filter((t) => !t.deleted && t.date_next <= limit)
        .sort((a, b) => (a.date_next < b.date_next ? -1 : 1)).slice(0, 25)
        .map((t) => ({ date: t.date_next, payee: t.payee_name || "", category: t.category_name || "", amount: mu(t.amount), repeat: t.frequency || "never" }));
    }
    if (mon) {
      const cur = data.month.month;
      body.months = (mon.months || []).filter((m) => !m.deleted && m.month <= cur).slice(0, 6).reverse()
        .map((m) => ({ month: m.month, income: mu(m.income), spent: -mu(m.activity), assigned: mu(m.budgeted) }));
    }
    cache = { at: Date.now(), body };
    return json(body);
  } catch {
    return fail(502, "Couldn't reach YNAB. It will try again shortly.");
  }
}
