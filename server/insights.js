// Station-level features: journey planner, crowd heatmap, station weather. All numbers are assumed estimates.
import { readFileSync } from "node:fs";
import { eventWindows, stationsFor } from "./rules.js";

const read = () => JSON.parse(readFileSync(new URL("./data/stations.json", import.meta.url), "utf8"));
export const network = read;
export const HOURS = Array.from({ length: 18 }, (_, i) => i + 6);

const km = (a, b) => {
  const r = Math.PI / 180, dLat = (b.lat - a.lat) * r, dLon = (b.lon - a.lon) * r;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin(dLon / 2) ** 2;
  return 12742 * Math.asin(Math.sqrt(h));
};
// Assumed fare slabs (INR) by distance — replace with the official table before production.
const fareFor = (d) => (d <= 2 ? 5 : d <= 4 ? 10 : d <= 6 ? 15 : d <= 10 ? 20 : 25);
const fail = (message, status) => Object.assign(new Error(message), { status });

// Dijkstra over (station, line) states; changing line costs 6 minutes. `exclude` = closed station ids (disruption mode).
export function journey(from, to, time = "09:00", exclude = new Set()) {
  const net = read();
  const st = new Map(net.stations.map((s) => [s.id, s]));
  if (!st.has(from) || !st.has(to)) throw fail("unknown station", 400);
  if (from === to) throw fail("choose two different stations", 400);
  if (exclude.has(from) || exclude.has(to)) throw fail("station is closed", 400);
  const edges = new Map();
  const add = (a, b, line) => { const k = `${a}|${line}`; if (!edges.has(k)) edges.set(k, []); edges.get(k).push(b); };
  for (const l of net.lines) l.stations.forEach((id, i) => { const n = l.stations[i + 1]; if (n) { add(id, n, l.id); add(n, id, l.id); } });
  const cost = (a, b) => (km(st.get(a), st.get(b)) / 33) * 60 + 0.7;
  const dist = new Map(), prev = new Map(), queue = [];
  for (const l of st.get(from).lines) { dist.set(`${from}|${l}`, 0); queue.push([0, from, l]); }
  while (queue.length) {
    queue.sort((x, y) => x[0] - y[0]);
    const [d, id, line] = queue.shift();
    if (d > (dist.get(`${id}|${line}`) ?? Infinity)) continue;
    const next = (edges.get(`${id}|${line}`) ?? []).map((n) => [n, line, d + cost(id, n)]);
    for (const l of st.get(id).lines) if (l !== line) next.push([id, l, d + 6]);
    for (const [n, ln, nd] of next) {
      if (exclude.has(n)) continue;
      if (nd < (dist.get(`${n}|${ln}`) ?? Infinity)) { dist.set(`${n}|${ln}`, nd); prev.set(`${n}|${ln}`, `${id}|${line}`); queue.push([nd, n, ln]); }
    }
  }
  const end = st.get(to).lines.map((l) => `${to}|${l}`).filter((k) => dist.has(k)).sort((a, b) => dist.get(a) - dist.get(b))[0];
  if (!end) throw fail("no route between these stations", 404);
  const path = [];
  for (let k = end; k; k = prev.get(k)) path.unshift(k.split("|"));
  const legs = [];
  for (const [id, line] of path) {
    const last = legs.at(-1);
    if (last?.line === line) { if (last.stationIds.at(-1) !== id) last.stationIds.push(id); } else legs.push({ line, stationIds: [id] });
  }
  let distanceKm = 0, stops = 0;
  const outLegs = legs.filter((l) => l.stationIds.length > 1).map((l) => {
    for (let i = 1; i < l.stationIds.length; i++) distanceKm += km(st.get(l.stationIds[i - 1]), st.get(l.stationIds[i]));
    stops += l.stationIds.length - 1;
    const line = net.lines.find((x) => x.id === l.line);
    return { line: l.line, lineName: line.name, color: line.color, from: st.get(l.stationIds[0]).name, to: st.get(l.stationIds.at(-1)).name, stops: l.stationIds.length - 1, stationIds: l.stationIds };
  });
  const hour = Number(time.split(":")[0]);
  return {
    from, to, stops, distanceKm: +distanceKm.toFixed(1), minutes: Math.round(dist.get(end)), fare: fareFor(distanceKm),
    peak: (hour >= 8 && hour < 10) || (hour >= 17 && hour < 21), legs: outLegs, interchanges: outLegs.slice(1).map((l) => l.from),
    note: "Fare, distance and times are assumed estimates from approximate station coordinates, not the official fare table.",
  };
}

// Crowd index 0-100 per station and hour: commute shape x station weight, plus event surges that bleed to neighbouring stops.
export function heatmap({ city, events, weather, dayType }) {
  const net = read();
  const shape = (h) => (h >= 8 && h < 10 ? 62 : h >= 17 && h < 20 ? 70 : h >= 10 && h < 17 ? 36 : h >= 6 && h < 8 ? 30 : 22);
  const off = dayType === "sunday" || dayType === "holiday" ? 0.7 : 1;
  const rain = weather.precipSum >= 15 ? 0.85 : 1;
  const names = new Map(net.stations.map((s) => [s.name.toLowerCase(), s]));
  const surge = new Map();
  const bump = (id, i, v) => surge.set(`${id}|${i}`, (surge.get(`${id}|${i}`) ?? 0) + v);
  for (const ev of events) {
    for (const name of stationsFor(ev)) {
      const home = names.get(name.toLowerCase());
      if (!home) continue;
      for (const w of eventWindows(ev)) {
        const add = -w.delta * 16;
        const hit = (id, f) => HOURS.forEach((h, i) => { if (h + 1 > w.from && h < w.to) bump(id, i, add * f); });
        hit(home.id, 1);
        for (const l of net.lines) {
          const i = l.stations.indexOf(home.id);
          if (i >= 0) [l.stations[i - 1], l.stations[i + 1]].filter(Boolean).forEach((n) => hit(n, 0.4));
        }
      }
    }
  }
  const stations = net.stations.filter((s) => s.city === city || s.interchange).map((s) => ({
    id: s.id, name: s.name,
    values: HOURS.map((h, i) => Math.round(Math.min(100, Math.max(0, shape(h) * off * rain * (s.interchange ? 1.25 : 1) + (surge.get(`${s.id}|${i}`) ?? 0))))),
  }));
  const peak = stations.flatMap((s) => s.values.map((v, i) => ({ station: s.name, hour: HOURS[i], value: v }))).sort((a, b) => b.value - a.value)[0];
  return { hours: HOURS, stations, peak };
}

// Station-wise weather from WeatherAPI.com (cached 10 min).
const wcache = new Map();
export async function stationWeather(city) {
  const key = process.env.WEATHER_API_KEY;
  if (!key) throw fail("WEATHER_API_KEY not set", 503);
  const hit = wcache.get(city);
  if (hit && Date.now() - hit.t < 600000) return hit.v;
  const list = read().stations.filter((s) => s.city === city);
  const one = async (s) => {
    for (let i = 0; i < 3; i++) {
      try {
        const r = await fetch(`https://api.weatherapi.com/v1/forecast.json?key=${key}&q=${s.lat},${s.lon}&days=1&aqi=no&alerts=no`, { signal: AbortSignal.timeout(7000) });
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const j = await r.json(), c = j.current;
        return { id: s.id, name: s.name, city, temp_c: c.temp_c, feelslike_c: c.feelslike_c, humidity: c.humidity, wind_kph: c.wind_kph, precip_mm: c.precip_mm, uv: c.uv, condition: c.condition.text, chance_of_rain: j.forecast.forecastday[0].day.daily_chance_of_rain };
      } catch { await new Promise((r) => setTimeout(r, 400)); }
    }
    return { id: s.id, name: s.name, city, error: "unavailable" };
  };
  const out = [];
  for (let i = 0; i < list.length; i += 8) out.push(...(await Promise.all(list.slice(i, i + 8).map(one))));
  const v = { updated: new Date().toISOString(), source: "weatherapi", stations: out };
  if (out.some((x) => !x.error)) wcache.set(city, { t: Date.now(), v });
  return v;
}
