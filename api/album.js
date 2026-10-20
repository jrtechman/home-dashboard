import { json, fail, guard } from "../lib/server.js";
import { albumPhotos } from "../lib/icloud-album.js";

let cache = { at: 0, body: null };
const FRESH_MS = 15 * 60 * 1000; // photo addresses from iCloud expire after a few hours

// GET -> { name, photos: [{ id, url, date }], fetchedAt }
export async function GET(request) {
  const denied = guard(request);
  if (denied) return denied;
  if (!process.env.PHOTO_ALBUM) return fail(404, "No shared album set. Add PHOTO_ALBUM in Vercel.");
  if (cache.body && Date.now() - cache.at < FRESH_MS) return json(cache.body);
  try {
    const { name, photos } = await albumPhotos(process.env.PHOTO_ALBUM);
    const body = { name, photos, fetchedAt: new Date().toISOString() };
    cache = { at: Date.now(), body };
    return json(body);
  } catch (e) {
    if (cache.body && Date.now() - cache.at < 3 * 60 * 60 * 1000) return json(cache.body); // keep showing the last good list
    return fail(e.status || 502, e.message || "Couldn't read the shared album.");
  }
}
