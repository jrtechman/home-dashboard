// Fetches a public web address the family pasted in, refusing local or private network addresses.
import dns from "node:dns/promises";
import net from "node:net";

function privateIp(ip) {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split(".").map(Number);
    return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127);
  }
  const s = ip.toLowerCase();
  return s === "::1" || s === "::" || s.startsWith("fc") || s.startsWith("fd") || s.startsWith("fe80") || s.startsWith("::ffff:");
}

export async function checkPublicUrl(raw) {
  let u;
  try { u = new URL(String(raw).trim()); } catch { throw Object.assign(new Error("That doesn't look like a web address."), { status: 400 }); }
  if (!/^https?:$/.test(u.protocol)) throw Object.assign(new Error("Use a link that starts with https://"), { status: 400 });
  const host = u.hostname.replace(/^\[|\]$/g, "");
  if (host === "localhost" || host.endsWith(".local") || host.endsWith(".internal")) throw Object.assign(new Error("That address isn't a public website."), { status: 400 });
  const addrs = net.isIP(host) ? [host] : (await dns.lookup(host, { all: true }).catch(() => [])).map((a) => a.address);
  if (!addrs.length) throw Object.assign(new Error("Couldn't find that website."), { status: 400 });
  if (addrs.some(privateIp)) throw Object.assign(new Error("That address isn't a public website."), { status: 400 });
  return u;
}

/** Follows up to 4 redirects, checking each hop. Returns { res, url }. */
export async function safeFetch(raw, { accept, maxBytes, timeoutMs = 12_000 }) {
  let url = await checkPublicUrl(raw);
  for (let hop = 0; hop < 5; hop++) {
    const res = await fetch(url, {
      redirect: "manual",
      signal: AbortSignal.timeout(timeoutMs),
      headers: { accept, "user-agent": "Mozilla/5.0 (compatible; HomeDashboard/1.0; recipe import)" },
    });
    if (res.status >= 300 && res.status < 400 && res.headers.get("location")) {
      url = await checkPublicUrl(new URL(res.headers.get("location"), url));
      continue;
    }
    const len = Number(res.headers.get("content-length") || 0);
    if (len && len > maxBytes) throw Object.assign(new Error("That page is too large."), { status: 413 });
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length > maxBytes) throw Object.assign(new Error("That page is too large."), { status: 413 });
    return { res, url, buf };
  }
  throw Object.assign(new Error("That link redirects too many times."), { status: 400 });
}
