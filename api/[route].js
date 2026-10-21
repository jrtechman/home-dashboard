// The one serverless function. Vercel's free plan allows only 12, so every endpoint lives in lib/routes/
// and this file hands each request to the matching one (/api/state -> lib/routes/state.js, and so on).
import * as album from "../lib/routes/album.js";
import * as apple from "../lib/routes/apple.js";
import * as budget from "../lib/routes/budget.js";
import * as calendar from "../lib/routes/calendar.js";
import * as db from "../lib/routes/db.js";
import * as draftRecipe from "../lib/routes/draft-recipe.js";
import * as importRecipe from "../lib/routes/import-recipe.js";
import * as login from "../lib/routes/login.js";
import * as passkey from "../lib/routes/passkey.js";
import * as state from "../lib/routes/state.js";
import * as upload from "../lib/routes/upload.js";
import * as weather from "../lib/routes/weather.js";
import * as verse from "../lib/routes/verse.js";
import * as push from "../lib/routes/push.js";
import * as admin from "../lib/routes/admin.js";
import * as cron from "../lib/routes/cron.js";

const ROUTES = { album, apple, budget, calendar, db, "draft-recipe": draftRecipe, "import-recipe": importRecipe, login, passkey, state, upload, weather, verse, push, admin, cron };

async function handle(request) {
  const url = new URL(request.url);
  const name = url.pathname.replace(/\/+$/, "").split("/").pop() || url.searchParams.get("route") || "";
  const fn = Object.hasOwn(ROUTES, name) ? ROUTES[name][request.method] : null;
  if (!fn) return new Response(JSON.stringify({ error: "Not found." }), { status: 404, headers: { "content-type": "application/json" } });
  return fn(request);
}
export { handle as GET, handle as POST, handle as PUT, handle as DELETE };
