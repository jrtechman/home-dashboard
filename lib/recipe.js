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
    .map(clean).filter(Boolean).slice(0, 60);
  return {
    title: clean(rec.name).slice(0, 120),
    minutes,
    ingredients,
    steps: steps(rec.recipeInstructions).slice(0, 40),
    photo: /^https?:\/\//.test(photo) ? photo : "",
  };
}
