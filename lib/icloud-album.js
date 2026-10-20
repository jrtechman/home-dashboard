// Reads a public iCloud Shared Album (Photos → shared album → Public Website).
// Apple has no official API for this; these are the same requests the album's public web page makes.

const B62 = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
const b62 = (s) => [...s].reduce((n, c) => n * 62 + B62.indexOf(c), 0);

export function albumToken(link) {
  const s = String(link || "").trim();
  const token = s.includes("#") ? s.slice(s.indexOf("#") + 1) : s;
  if (/photos\.icloud\.com\/shared\/album/i.test(s)) throw new Error("This is one of Apple's newer shared albums, which can't be read from outside Apple yet. Use a classic shared album link (icloud.com/sharedalbum/#…), or add photos on the Photos tab.");
  // Older links use letters and digits; newer ones are longer and also use - and _.
  if (!/^[A-Za-z0-9_-]{10,}$/.test(token)) throw new Error("PHOTO_ALBUM should be the album's Public Website link, like https://www.icloud.com/sharedalbum/#B0aB…");
  return token;
}
const FALLBACK_HOST = "p01-sharedstreams.icloud.com"; // iCloud redirects to the right server from here
function firstHost(token) {
  const slice = token[0] === "A" ? token.slice(1, 2) : token.slice(1, 3);
  if (/[^0-9A-Za-z]/.test(slice)) return FALLBACK_HOST;
  return `p${String(b62(slice)).padStart(2, "0")}-sharedstreams.icloud.com`;
}

async function post(host, token, path, body) {
  const res = await fetch(`https://${host}/${token}/sharedstreams/${path}`, {
    method: "POST",
    headers: { "content-type": "text/plain", origin: "https://www.icloud.com" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(12_000),
  });
  const data = await res.json().catch(() => null);
  return { status: res.status, data };
}

/** Returns newest-first [{ id, url, date, width, height }]; photo addresses expire after a few hours. */
export async function albumPhotos(link, { max = 300 } = {}) {
  const token = albumToken(link);
  let host = firstHost(token);
  let r;
  try { r = await post(host, token, "webstream", { streamCtag: null }); }
  catch { host = FALLBACK_HOST; r = await post(host, token, "webstream", { streamCtag: null }); } // server name didn't resolve
  if (r.status === 330 && r.data && r.data["X-Apple-MMe-Host"]) {
    host = r.data["X-Apple-MMe-Host"];
    r = await post(host, token, "webstream", { streamCtag: null });
  }
  if (r.status === 404) throw Object.assign(new Error("That album link no longer works. Check that Public Website is still on."), { status: 404 });
  if (r.status !== 200 || !r.data || !Array.isArray(r.data.photos)) throw new Error("iCloud didn't return the album.");

  const items = r.data.photos
    .filter((p) => p.mediaAssetType !== "video" && p.derivatives)
    .map((p) => {
      // Pick the biggest still image up to 2048px wide.
      const ds = Object.entries(p.derivatives)
        .filter(([k]) => k !== "PosterFrame")
        .map(([, d]) => ({ ...d, w: Number(d.width) || 0 }))
        .sort((a, b) => b.w - a.w);
      const d = ds.find((x) => x.w <= 2048) || ds[ds.length - 1];
      return d && { id: p.photoGuid, checksum: d.checksum, date: p.dateCreated || p.batchDateCreated || "", width: d.w, height: Number(d.height) || 0 };
    })
    .filter(Boolean)
    .sort((a, b) => String(b.date).localeCompare(String(a.date)))
    .slice(0, max);

  const urls = {};
  const guids = [...new Set(items.map((i) => i.id))];
  for (let i = 0; i < guids.length; i += 25) {
    const u = await post(host, token, "webasseturls", { photoGuids: guids.slice(i, i + 25) });
    for (const [checksum, v] of Object.entries((u.data && u.data.items) || {})) {
      if (v && v.url_location && v.url_path) urls[checksum] = `https://${v.url_location}${v.url_path}`;
    }
  }
  return {
    name: r.data.streamName || "Shared album",
    photos: items.filter((i) => urls[i.checksum]).map((i) => ({ id: i.id, url: urls[i.checksum], date: i.date, width: i.width, height: i.height })),
  };
}
