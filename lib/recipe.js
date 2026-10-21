// Pulls a recipe out of a web page using the schema.org "Recipe" data most recipe sites embed.

const ENT = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", frac12: "½", frac14: "¼", frac34: "¾", deg: "°", ndash: "–", mdash: "—", rsquo: "’", lsquo: "‘", rdquo: "”", ldquo: "“", hellip: "…" };
export function clean(s) {
  return String(s ?? "")
    .replace(/<[^>]*>/g, " ")
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&([a-z]+);/gi, (m, n) => ENT[n.toLowerCase()] ?? m)
    .replace(/\s+/g, " ")
    .replace(/\s+([.,;:!?)])/g, "$1")
    .trim();
}

// ISO 8601 duration like PT1H15M -> 75
export function minutesOf(d) {
  const m = /^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:\d+S)?)?$/i.exec(String(d || "").trim());
  if (!m) return 0;
  return (Number(m[1] || 0) * 1440) + (Number(m[2] || 0) * 60) + Number(m[3] || 0);
}

const isRecipe = (n) => {
  const t = n && n["@type"];
  return Array.isArray(t) ? t.some((x) => String(x).toLowerCase() === "recipe") : String(t || "").toLowerCase() === "recipe";
};
function findRecipe(node, depth = 0) {
  if (!node || typeof node !== "object" || depth > 6) return null;
  if (Array.isArray(node)) { for (const n of node) { const r = findRecipe(n, depth + 1); if (r) return r; } return null; }
  if (isRecipe(node)) return node;
  for (const k of ["@graph", "mainEntity", "mainEntityOfPage", "itemListElement", "item"]) {
    const r = findRecipe(node[k], depth + 1); if (r) return r;
  }
  return null;
}

function steps(ins) {
  if (!ins) return [];
  if (typeof ins === "string") return ins.split(/\n+|(?<=\.)\s+(?=[A-Z])/).map(clean).filter(Boolean);
  if (Array.isArray(ins)) return ins.flatMap(steps);
  if (typeof ins === "object") {
    if (ins.itemListElement) return steps(ins.itemListElement); // HowToSection
    return [clean(ins.text || ins.name || "")].filter(Boolean); // HowToStep
  }
  return [];
}
function image(img) {
  if (!img) return "";
  if (typeof img === "string") return img;
  if (Array.isArray(img)) return image(img[0]);
  return img.url || img.contentUrl || "";
}

export function recipeFromHtml(html, pageUrl) {
  const blocks = [...html.matchAll(/<script[^>]*type=["']?application\/ld\+json["']?[^>]*>([\s\S]*?)<\/script>/gi)].map((m) => m[1]);
  let rec = null;
  for (const b of blocks) {
    try { rec = findRecipe(JSON.parse(b.trim())); } catch { /* skip broken blocks */ }
    if (rec) break;
  }
  if (!rec) return null;
  const minutes = minutesOf(rec.totalTime) || (minutesOf(rec.prepTime) + minutesOf(rec.cookTime));
  let photo = image(rec.image);
  try { if (photo) photo = new URL(photo, pageUrl).toString(); } catch { photo = ""; }
  const ingredients = (Array.isArray(rec.recipeIngredient) ? rec.recipeIngredient : Array.isArray(rec.ingredients) ? rec.ingredients : [])
    .map(clean).map(tidyIngredient).filter(Boolean).slice(0, 60);
  return {
    title: clean(rec.name).slice(0, 120),
    minutes,
    ingredients,
    steps: steps(rec.recipeInstructions).map(tidyStep).filter(Boolean).slice(0, 40),
    photo: /^https?:\/\//.test(photo) ? photo : "",
  };
}

/**
 * Keeps just the measurement and the ingredient:
 *   "1 tsp ginger (, finely grated)"                 -> "1 tsp ginger"
 *   "1 - 4 cups oil, for frying ((peanut; Note 4))"  -> "1 - 4 cups oil"
 *   "2 (14 oz) cans diced tomatoes, drained"         -> "2 (14 oz) cans diced tomatoes"
 */
export function tidyIngredient(raw) {
  let s = String(raw ?? "").replace(/\s+/g, " ").trim();
  // A size right after the count ("2 (14 oz) cans ...") is part of the measurement; keep it.
  let lead = "";
  const m = /^([\d\s½¼¾⅓⅔/.\-–]+?)\s*\(([^()]{1,25})\)\s*(.*)$/.exec(s);
  if (m && /\d/.test(m[2]) && /\b(oz|ounces?|g|grams?|kg|ml|l|lbs?|pounds?|fl)\b/i.test(m[2])) {
    lead = `${m[1].trim()} (${m[2].trim()}) `;
    s = m[3];
  }
  let prev;
  do { prev = s; s = s.replace(/\([^()]*\)/g, " "); } while (s !== prev); // nested notes, innermost first
  s = s.replace(/[()]/g, " ");                                            // stray brackets
  s = s.replace(/,(?!\d).*$/, "");                                        // "…, finely chopped" -> drop the prep note
  s = s.replace(/\s*[-–—]\s*(?:see\s+)?notes?\b.*$/i, "").replace(/\b(?:see\s+)?notes?\s*\d+\b/gi, "");
  s = s.replace(/\s+/g, " ").replace(/[\s,;:/\-–]+$/, "").trim();
  return (lead + s).trim();
}
/** Recipe steps: drop "(see Note 2)" style references. */
export function tidyStep(raw) {
  return String(raw ?? "").replace(/\s*\((?:see\s+)?notes?\s*\d*[^)]*\)/gi, "").replace(/\s+([.,;:!?])/g, "$1").replace(/\s+/g, " ").trim();
}
