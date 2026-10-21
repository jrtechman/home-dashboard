import { put, del } from "@vercel/blob";
import { json, fail, guard, readJson } from "../server.js";
import { safeFetch } from "../safe-fetch.js";

const TYPES = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "image/gif": "gif" };
const MAX = 4 * 1024 * 1024; // the page shrinks photos to well under this before sending

// POST raw image bytes -> { url }
export async function POST(request) {
  const denied = guard(request);
  if (denied) return denied;
  if (!process.env.BLOB_READ_WRITE_TOKEN) return fail(500, "Photo storage isn't connected. Add a Blob store from the Vercel Storage tab.");
  let type = (request.headers.get("content-type") || "").split(";")[0].trim();
  let buf;
  if (type === "application/json") {
    // { fromUrl } saves a copy of an imported recipe's photo.
    let body;
    try { body = await readJson(request, 4000); } catch { return fail(400, "Send a photo address."); }
    try {
      const got = await safeFetch(body.fromUrl, { accept: "image/*", maxBytes: MAX });
      if (!got.res.ok) return fail(502, "Couldn't download that photo.");
      type = (got.res.headers.get("content-type") || "").split(";")[0].trim();
      buf = got.buf;
    } catch (e) {
      return fail(e.status || 502, e.status ? e.message : "Couldn't download that photo.");
    }
  } else {
    buf = Buffer.from(await request.arrayBuffer());
  }
  if (!TYPES[type]) return fail(415, "Send a JPEG, PNG, WebP or GIF image.");
  if (!buf.length) return fail(400, "The photo was empty.");
  if (buf.length > MAX) return fail(413, "That photo is too large.");
  try {
    const blob = await put(`photos/${Date.now()}.${TYPES[type]}`, buf, { access: "public", contentType: type, addRandomSuffix: true });
    return json({ url: blob.url });
  } catch (e) {
    return fail(500, "The photo didn't save. Try again.");
  }
}

// DELETE { url } removes a stored photo.
export async function DELETE(request) {
  const denied = guard(request);
  if (denied) return denied;
  let body;
  try { body = await readJson(request, 4000); } catch { return fail(400, "Send the photo address."); }
  let u;
  try { u = new URL(body.url); } catch { return fail(400, "That isn't a photo address."); }
  if (!u.hostname.endsWith(".blob.vercel-storage.com")) return fail(400, "That photo isn't stored here.");
  try { await del(u.toString()); } catch { /* already gone */ }
  return json({ ok: true });
}
