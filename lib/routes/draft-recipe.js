import { json, fail, guard, readJson } from "../server.js";

const PROMPT = (hint) =>
  "You help a family keep a recipe box. The attached photo is either (A) a written or printed recipe (a cookbook page, recipe card, handwritten note, or screenshot) or (B) a dish someone made or ate. " +
  "If it is (A), copy the recipe exactly as written: its title, total time in minutes if given, every ingredient with its amount, and every step in order. Do not add, change or invent anything. Leave out notes, tips and alternatives. " +
  "If it is (B), identify the most likely dish and write a simple home-cook version for about 4 servings." +
  (hint ? ` The family calls this dish ${JSON.stringify(hint)}.` : "") +
  ' Reply with JSON only, shaped exactly like: {"title": string, "minutes": number, "ingredients": [string], "steps": [string]}. ' +
  'Give every ingredient an amount and name only (e.g. "1 lb ground beef"). Keep steps short and imperative.';

// POST { image: base64 JPEG } or { url: stored photo address }, optional hint -> { title, minutes, ingredients, steps }
export async function POST(request) {
  const denied = guard(request);
  if (denied) return denied;
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return fail(404, "Add ANTHROPIC_API_KEY in Vercel to fill recipes from photos.");

  let body;
  try { body = await readJson(request, 7_000_000); } catch (e) { return fail(e.status || 400, "That photo is too large."); }

  let b64 = body.image, mediaType = "image/jpeg";
  if (!b64 && body.url) {
    let u;
    try { u = new URL(body.url); } catch { return fail(400, "Bad photo address."); }
    if (!u.hostname.endsWith(".blob.vercel-storage.com")) return fail(400, "That photo isn't stored here.");
    const r = await fetch(u, { signal: AbortSignal.timeout(10_000) });
    if (!r.ok) return fail(502, "Couldn't open the saved photo.");
    mediaType = (r.headers.get("content-type") || "image/jpeg").split(";")[0];
    b64 = Buffer.from(await r.arrayBuffer()).toString("base64");
  }
  if (!b64) return fail(400, "Send a photo.");

  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      signal: AbortSignal.timeout(45_000),
      headers: { "content-type": "application/json", "x-api-key": key, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({
        model: process.env.CLAUDE_MODEL || "claude-sonnet-5-5",
        max_tokens: 3000,
        messages: [{
          role: "user",
          content: [
            { type: "image", source: { type: "base64", media_type: mediaType, data: b64 } },
            { type: "text", text: PROMPT(String(body.hint || "").slice(0, 120)) },
          ],
        }],
      }),
    });
    if (res.status === 429) return fail(503, "Too many requests right now. Try again in a minute.");
    if (!res.ok) return fail(502, "Claude couldn't read the photo. Fill it in by hand.");
    const out = await res.json();
    const text = (out.content || []).filter((b) => b.type === "text").map((b) => b.text).join("");
    const m = text.match(/\{[\s\S]*\}/);
    if (!m) return fail(502, "Claude couldn't read the photo. Fill it in by hand.");
    const r = JSON.parse(m[0]);
    return json({
      title: String(r.title || "").slice(0, 120),
      minutes: Number(r.minutes) || 0,
      ingredients: Array.isArray(r.ingredients) ? r.ingredients.map(String).slice(0, 60) : [],
      steps: Array.isArray(r.steps) ? r.steps.map(String).slice(0, 30) : [],
    });
  } catch {
    return fail(502, "Claude couldn't read the photo. Fill it in by hand.");
  }
}
