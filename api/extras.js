import { GET as weather } from "../lib/weather.js";
import { GET as verse } from "../lib/verse.js";

// Weather and verse of the day share one function (the free Vercel plan allows only 12).
// /api/extras?what=verse | /api/extras?lat=..&lon=.. | /api/extras?q=City
export async function GET(request) {
  return new URL(request.url).searchParams.get("what") === "verse" ? verse(request) : weather(request);
}
