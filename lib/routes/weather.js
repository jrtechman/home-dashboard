import { json, fail, guard } from "../server.js";

// Weather for the place you choose (Open-Meteo: free, no key). ?q=City searches places; ?lat=&lon= gives the forecast.
const cache = new Map();
const FRESH_MS = 15 * 60 * 1000;
const num = (v) => (v == null || v === "" ? NaN : Number(v));

export async function GET(request) {
  const denied = guard(request);
  if (denied) return denied;
  const u = new URL(request.url);
  const q = (u.searchParams.get("q") || "").trim();
  try {
    if (q) {
      const name = q.split(",")[0].trim();
      const hint = q.split(",").slice(1).join(" ").trim().toLowerCase();
      const res = await fetch(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(name)}&count=8&language=en&format=json`, { signal: AbortSignal.timeout(8000) });
      if (!res.ok) return fail(502, "Couldn't search for that place right now.");
      const j = await res.json();
      let places = (j.results || []).map((r) => ({ name: [r.name, r.admin1, r.country_code === "US" ? "" : r.country].filter(Boolean).join(", "), lat: r.latitude, lon: r.longitude }));
      if (hint) { const m = places.filter((p) => p.name.toLowerCase().includes(hint)); if (m.length) places = m; }
      return json({ places: places.slice(0, 5) });
    }
    const lat = num(u.searchParams.get("lat")), lon = num(u.searchParams.get("lon"));
    if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) return fail(400, "Choose a place for the weather first.");
    const key = `${lat.toFixed(2)},${lon.toFixed(2)}`;
    const hit = cache.get(key);
    if (hit && Date.now() - hit.at < FRESH_MS) return json(hit.body);
    const api = `https://api.open-meteo.com/v1/forecast?latitude=${lat.toFixed(4)}&longitude=${lon.toFixed(4)}`
      + "&current=temperature_2m,apparent_temperature,relative_humidity_2m,weather_code,wind_speed_10m,is_day,precipitation"
      + "&hourly=temperature_2m,precipitation_probability,weather_code,precipitation,snowfall"
      + "&daily=weather_code,temperature_2m_max,temperature_2m_min,apparent_temperature_max,apparent_temperature_min,precipitation_probability_max,wind_speed_10m_max,sunrise,sunset,uv_index_max,precipitation_sum,snowfall_sum,precipitation_hours"
      + "&temperature_unit=fahrenheit&wind_speed_unit=mph&precipitation_unit=inch&timezone=auto&forecast_days=7";
    const res = await fetch(api, { signal: AbortSignal.timeout(8000) });
    if (!res.ok) return fail(502, "Couldn't get the weather right now. It will try again shortly.");
    const w = await res.json();
    const d = w.daily || {}, c = w.current || {}, hr = w.hourly || {};
    // Next 12 hours, starting with the current hour (times are local to the place).
    const nowHour = String(c.time || "").slice(0, 13);
    const start = Math.max(0, (hr.time || []).findIndex((t) => String(t).slice(0, 13) >= nowHour));
    const hourly = (hr.time || []).slice(start, start + 12).map((t, i) => ({ time: t, temp: hr.temperature_2m?.[start + i], rain: hr.precipitation_probability?.[start + i] ?? 0, code: hr.weather_code?.[start + i], amt: hr.precipitation?.[start + i] ?? 0, snow: hr.snowfall?.[start + i] ?? 0 }));
    const days = (d.time || []).map((t, i) => ({ date: t, code: d.weather_code?.[i], hi: d.temperature_2m_max?.[i], lo: d.temperature_2m_min?.[i], rain: d.precipitation_probability_max?.[i] ?? 0, wind: d.wind_speed_10m_max?.[i], uv: d.uv_index_max?.[i], sunrise: d.sunrise?.[i], sunset: d.sunset?.[i], amt: d.precipitation_sum?.[i] ?? 0, snow: d.snowfall_sum?.[i] ?? 0, hours: d.precipitation_hours?.[i] ?? 0 }));
    const body = {
      fetchedAt: new Date().toISOString(),
      now: { temp: c.temperature_2m, feels: c.apparent_temperature, humidity: c.relative_humidity_2m, code: c.weather_code, wind: c.wind_speed_10m, day: c.is_day !== 0, precip: c.precipitation ?? 0 },
      today: { code: d.weather_code?.[0], hi: d.temperature_2m_max?.[0], lo: d.temperature_2m_min?.[0], feelsHi: d.apparent_temperature_max?.[0], feelsLo: d.apparent_temperature_min?.[0], rain: d.precipitation_probability_max?.[0] ?? 0, wind: d.wind_speed_10m_max?.[0], uv: d.uv_index_max?.[0], sunrise: d.sunrise?.[0], sunset: d.sunset?.[0], amt: d.precipitation_sum?.[0] ?? 0, snow: d.snowfall_sum?.[0] ?? 0, hours: d.precipitation_hours?.[0] ?? 0 },
      tomorrow: { code: d.weather_code?.[1], hi: d.temperature_2m_max?.[1], lo: d.temperature_2m_min?.[1], rain: d.precipitation_probability_max?.[1] ?? 0 },
      hourly, days,
      // Every hour of the 7-day forecast as [local time, temp, rain chance, weather code], so events can show the forecast for their own start time.
      hourAll: (hr.time || []).map((t, i) => [t, Math.round(hr.temperature_2m?.[i] ?? 0), hr.precipitation_probability?.[i] ?? 0, hr.weather_code?.[i]]),
    };
    cache.set(key, { at: Date.now(), body });
    if (cache.size > 50) cache.delete(cache.keys().next().value);
    return json(body);
  } catch {
    return fail(502, "Couldn't reach the weather service. It will try again shortly.");
  }
}
