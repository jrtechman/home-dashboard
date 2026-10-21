import { json, fail, guard, readJson } from "../server.js";
import { safeFetch } from "../safe-fetch.js";
import { recipeFromHtml } from "../recipe.js";

// POST { url } -> { title, minutes, ingredients, steps, photo, source }
export async function POST(request) {
  const denied = guard(request);
  if (denied) return denied;
  let body;
  try { body = await readJson(request, 4000); } catch { return fail(400, "Send a recipe link."); }
  try {
    const { res, url, buf } = await safeFetch(body.url, { accept: "text/html,application/xhtml+xml", maxBytes: 4_000_000 });
    if (res.status === 403 || res.status === 429) return fail(502, "That site blocked the import. Try the Paste option instead.");
    if (!res.ok) return fail(502, "Couldn't open that page. Check the link.");
    const recipe = recipeFromHtml(buf.toString("utf8"), url);
    if (!recipe || (!recipe.ingredients.length && !recipe.steps.length)) {
      return fail(422, "No recipe found on that page. Copy the recipe text and use Paste instead.");
    }
    return json({ ...recipe, source: url.toString() });
  } catch (e) {
    return fail(e.status || 502, e.status ? e.message : "Couldn't open that page. Check the link.");
  }
}
