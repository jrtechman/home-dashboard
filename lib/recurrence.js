// Does a repeating reminder fall on this day? Dates are YYYY-MM-DD. repeat: none | day | week | month | year, every N.
const parseKey = (k) => { const [y, m, d] = String(k).split("-").map(Number); return new Date(y, m - 1, d); };
export function remOccurs(r, k) {
  const a = r && r.date; if (!a || k < a) return false;
  const rep = r.repeat || "none"; if (rep === "none") return k === a;
  const n = Math.max(1, Math.floor(Number(r.every)) || 1);
  const A = parseKey(a), D = parseKey(k);
  const days = Math.round((D - A) / 864e5);
  if (rep === "day") return days % n === 0;
  if (rep === "week") return days % (7 * n) === 0;
  const months = (D.getFullYear() - A.getFullYear()) * 12 + D.getMonth() - A.getMonth();
  if (months % (rep === "year" ? 12 * n : n)) return false;
  if (rep !== "month" && rep !== "year") return false;
  const last = new Date(D.getFullYear(), D.getMonth() + 1, 0).getDate();
  return D.getDate() === Math.min(A.getDate(), last);
}
