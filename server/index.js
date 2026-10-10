import express from "express";
import { MongoClient } from "mongodb";
import { readFileSync } from "node:fs";
import nodemailer from "nodemailer";
import { recommend, templateJustification, stationSurges, bands, DEFAULT_CONFIG } from "./rules.js";
import { hashPassword, checkPassword, issueToken, readToken, DEMO_USERS } from "./auth.js";
import { network, journey, heatmap, stationWeather } from "./insights.js";

const load = (f) => JSON.parse(readFileSync(new URL(`./data/${f}`, import.meta.url), "utf8"));
const SEED = { events: load("events.json"), holidays: load("holidays.json") };
const FIXTURE_WEATHER = load("sample_weather.json");
const CITIES = { ahmedabad: [23.0225, 72.5714], gandhinagar: [23.2156, 72.6369] };

// --- MongoDB (optional at runtime: falls back to the JSON seed so the demo never hard-fails) ---
let db = null;
try {
  const client = new MongoClient(process.env.MONGODB_URI ?? "mongodb://127.0.0.1:27017/metro", { serverSelectionTimeoutMS: 8000 });
  await client.connect();
  db = client.db();
  for (const [name, docs] of Object.entries(SEED)) {
    if ((await db.collection(name).countDocuments()) === 0) await db.collection(name).insertMany(docs.map((d) => ({ ...d })));
  }
  console.log("MongoDB connected:", db.databaseName);
} catch (e) {
  console.warn("MongoDB unavailable — using JSON seed data, history disabled:", e.message);
}
const find = async (name) => (db ? db.collection(name).find({}, { projection: { _id: 0 } }).toArray() : SEED[name]);

// --- Live holidays (Calendarific, Gujarat) and live events (PredictHQ); both fall back silently ---
const cache = new Map();
const memo = async (key, fn, ttl = 600000) => {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.t < ttl) return hit.v;
  const v = await fn();
  cache.set(key, { t: Date.now(), v });
  return v;
};
async function getHolidays(year) {
  if (!process.env.CALENDARIFIC_API_KEY) return find("holidays");
  try {
    return await memo(`hol-${year}`, async () => {
      const r = await fetch(`https://calendarific.com/api/v2/holidays?api_key=${process.env.CALENDARIFIC_API_KEY}&country=IN&year=${year}&location=in-gj`, { signal: AbortSignal.timeout(5000) });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const list = (await r.json()).response.holidays.filter((h) => /national|gazetted/i.test(h.primary_type)).map((h) => ({ date: h.date.iso.slice(0, 10), name: h.name, live: true }));
      if (!list.length) throw new Error("no holidays");
      return list;
    }, 864e5);
  } catch (e) {
    console.warn("Holiday fallback:", e.message);
    return find("holidays");
  }
}
const IST = (iso) => { const d = new Date(new Date(iso).getTime() + 19800000); return d.getUTCHours() + d.getUTCMinutes() / 60; };
async function getLiveEvents(date, city) {
  if (!process.env.PREDICTHQ_TOKEN) return [];
  try {
    return await memo(`ev-${city}-${date}`, async () => {
      const [lat, lon] = CITIES[city];
      const q = new URLSearchParams({ within: `${city === "gandhinagar" ? 12 : 20}km@${lat},${lon}`, "active.gte": date, "active.lte": date, category: "sports,concerts,festivals,conferences,expos,performing-arts", limit: "8", sort: "-phq_attendance" });
      const r = await fetch(`https://api.predicthq.com/v1/events/?${q}`, { headers: { authorization: `Bearer ${process.env.PREDICTHQ_TOKEN}` }, signal: AbortSignal.timeout(5000) });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return (await r.json()).results.map((e) => {
        const startHour = e.start.slice(0, 10) === date ? IST(e.start) : 9;
        const endHour = Math.max(startHour + 1, e.end.slice(0, 10) === date ? IST(e.end) : e.category === "sports" ? 17.5 : 21);
        return { id: `phq-${e.id}`, name: e.title, type: e.category === "sports" || e.category === "concerts" ? "stadium" : "market", venue: e.entities?.[0]?.name ?? "Ahmedabad area", date, startHour, endHour, attendance: e.phq_attendance ?? 5000, stations: [], city, live: true };
      });
    });
  } catch (e) {
    console.warn("Live events unavailable:", e.message);
    return [];
  }
}

// --- Weather: live Open-Meteo, fixture on failure ---
async function getWeather(date, city) {
  try {
    const q = new URLSearchParams({
      latitude: CITIES[city][0], longitude: CITIES[city][1], timezone: "Asia/Kolkata", start_date: date, end_date: date,
      daily: "precipitation_sum,precipitation_probability_max,temperature_2m_max",
    });
    const r = await fetch(`https://api.open-meteo.com/v1/forecast?${q}`, { signal: AbortSignal.timeout(4000) });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const d = (await r.json()).daily;
    return { precipSum: d.precipitation_sum[0] ?? 0, precipProb: d.precipitation_probability_max[0] ?? 0, tempMax: d.temperature_2m_max[0], source: "live" };
  } catch (e) {
    console.warn("Weather fallback:", e.message);
    return { ...FIXTURE_WEATHER, source: "fallback" };
  }
}

async function getWeatherRange(from, days, city) {
  const end = new Date(Date.parse(from) + (days - 1) * 864e5).toISOString().slice(0, 10);
  try {
    const q = new URLSearchParams({ latitude: CITIES[city][0], longitude: CITIES[city][1], timezone: "Asia/Kolkata", start_date: from, end_date: end, daily: "precipitation_sum,precipitation_probability_max,temperature_2m_max" });
    const r = await fetch(`https://api.open-meteo.com/v1/forecast?${q}`, { signal: AbortSignal.timeout(6000) });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const d = (await r.json()).daily;
    return Object.fromEntries(d.time.map((t, i) => [t, { precipSum: d.precipitation_sum[i] ?? 0, precipProb: d.precipitation_probability_max[i] ?? 0, tempMax: d.temperature_2m_max[i], source: "live" }]));
  } catch (e) {
    console.warn("Plan weather fallback:", e.message);
    return new Proxy({}, { get: () => ({ ...FIXTURE_WEATHER, source: "fallback" }) });
  }
}

// --- Rule config (what-if tool): saved in Mongo, memory when no DB ---
let memConfig = null;
const getConfig = async () => (db ? (await db.collection("config").findOne({ _id: "rules" }))?.value : memConfig) ?? DEFAULT_CONFIG;
const saveConfig = async (value) => (db ? db.collection("config").replaceOne({ _id: "rules" }, { _id: "rules", value }, { upsert: true }) : (memConfig = value));

// --- Groq LLM: returns null on any failure so callers fall back to templates ---
async function groq(content, maxTokens = 300) {
  if (!process.env.GROQ_API_KEY) return null;
  try {
    const r = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      signal: AbortSignal.timeout(15000),
      headers: { authorization: `Bearer ${process.env.GROQ_API_KEY}`, "content-type": "application/json" },
      body: JSON.stringify({ model: process.env.GROQ_MODEL ?? "openai/gpt-oss-120b", reasoning_effort: "low", max_tokens: maxTokens, messages: [{ role: "user", content }] }),
    });
    const text = (await r.json()).choices?.[0]?.message?.content?.trim();
    if (!text) console.warn("Groq empty response");
    return text || null;
  } catch (e) {
    console.warn("Groq fallback:", e.message);
    return null;
  }
}
const justify = async (row) => (await groq(`Metro control room advisory. Write ONE plain sentence (max 25 words) justifying this to an operator. Use ONLY the signals listed; do not invent causes.
Band: ${row.band} ${row.time}
Action: ${row.action} (${row.base} -> ${row.headway} min)
Stations: ${row.stations.join(", ") || "all"}
Signals: ${row.reasons.map((x) => x.text).join("; ")}`)) ?? templateJustification(row);

const SIM = { rain: { precipSum: 32, precipProb: 95, tempMax: 27, source: "simulated" }, clear: { precipSum: 0, precipProb: 5, tempMax: 33, source: "simulated" } };
const isDate = (s) => /^\d{4}-\d{2}-\d{2}$/.test(s ?? "") && !Number.isNaN(Date.parse(s));

const app = express();
app.use(express.json());

app.get("/api/meta", async (_req, res) => res.json({ events: await find("events"), holidays: [], keys: { holidays: !!process.env.CALENDARIFIC_API_KEY, events: !!process.env.PREDICTHQ_TOKEN, weather: !!process.env.WEATHER_API_KEY, email: !!(process.env.SMTP_HOST && process.env.SMTP_USER && recipients().length) }, recipients: recipients(), db: !!db, llm: !!process.env.GROQ_API_KEY }));

app.get("/api/live-events", async (req, res) => res.json(isDate(req.query.date) && CITIES[req.query.city] ? await getLiveEvents(req.query.date, req.query.city) : []));

const bad = (message, status = 400) => Object.assign(new Error(message), { status });
// Shared input resolution for recommend / heatmap / report.
async function resolveDay(body = {}) {
  const { date, eventIds = [], weatherMode = "live", city = "ahmedabad" } = body;
  if (!CITIES[city]) throw bad("city must be ahmedabad or gandhinagar");
  if (!isDate(date)) throw bad("date must be YYYY-MM-DD");
  const [allEvents, holidays, liveWeather] = await Promise.all([find("events").then(async (e) => [...e, ...(await getLiveEvents(date, city))]), getHolidays(date.slice(0, 4)), weatherMode === "live" ? getWeather(date, city) : null]);
  const weather = SIM[weatherMode] ?? liveWeather ?? (await getWeather(date, city));
  // No eventIds given = automatic mode: every known event on that date for the city (sample + live).
  const events = body.eventIds === undefined ? allEvents.filter((e) => e.date === date && (e.live || e.city === city)) : allEvents.filter((e) => eventIds.includes(e.id));
  return { date, city, weather, events, holiday: holidays.find((h) => h.date === date) ?? null };
}
async function buildAdvisory(body, { fast = false } = {}) {
  const day = await resolveDay(body);
  const result = recommend(day, body.config ?? (await getConfig()));
  await Promise.all(result.rows.map(async (r) => (r.justification = fast ? templateJustification(r) : await justify(r))));
  return { ...day, events: day.events.map((e) => e.name), rawEvents: day.events, ...result, stations: stationSurges(day.events), createdAt: new Date() };
}
const route = (fn) => async (req, res) => {
  try { res.json(await fn(req)); } catch (e) { if (!e.status) console.error(e); res.status(e.status ?? 500).json({ error: e.status ? e.message : "internal error" }); }
};

app.post("/api/recommend", route(async (req) => {
  const { rawEvents, ...advisory } = await buildAdvisory(req.body ?? {}, { fast: !!req.body?.fast });
  if (db && !req.body.fast) db.collection("advisories").insertOne({ ...advisory }).catch((e) => console.warn("save failed:", e.message));
  return advisory;
}));

// --- Station network, journey planner, crowd heatmap, station weather ---
app.get("/api/stations", route(async () => { const { lines, stations } = network(); return { lines, stations }; }));
app.get("/api/journey", route(async (req) => journey(String(req.query.from ?? ""), String(req.query.to ?? ""), /^\d{1,2}:\d{2}$/.test(req.query.time ?? "") ? req.query.time : "09:00")));
app.get("/api/stations/weather", route(async (req) => { if (!CITIES[req.query.city]) throw bad("city must be ahmedabad or gandhinagar"); return stationWeather(req.query.city); }));
app.post("/api/heatmap", route(async (req) => {
  const day = await resolveDay(req.body);
  return heatmap({ ...day, dayType: recommend(day).dayType });
}));

// --- AI copilot, grounded in the advisory the operator is looking at ---
app.post("/api/ask", route(async (req) => {
  const { question, advisory } = req.body ?? {};
  if (typeof question !== "string" || !question.trim() || question.length > 500) throw bad("question must be 1-500 characters");
  if (!advisory?.rows) throw bad("generate an advisory first");
  const facts = JSON.stringify({ date: advisory.date, city: advisory.city, weather: advisory.weather, holiday: advisory.holiday, events: advisory.events, alert: advisory.alert, fleet: advisory.fleet, rows: advisory.rows.map(({ band, time, base, headway, action, stations, reasons }) => ({ band, time, base, headway, action, stations, reasons: reasons.map((r) => r.text) })), stations: advisory.stations }).slice(0, 6000);
  const answer = await groq(`You are a metro control-room copilot for Ahmedabad/Gandhinagar. Answer the operator in at most 4 short sentences using ONLY these advisory facts; if the facts don't cover it, say so.\nFACTS: ${facts}\nQUESTION: ${question}`, 500);
  return { answer: answer ?? "AI is unavailable right now — use the 'why' details on each row." };
}));

// --- AI-written full report, previewed in the UI and emailed only to authorised recipients ---
const recipients = () => (process.env.REPORT_RECIPIENTS ?? "").split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
async function buildReport(body) {
  const a = await buildAdvisory(body);
  const cityName = a.city === "gandhinagar" ? "Gandhinagar" : "Ahmedabad";
  const facts = a.rows.map((r) => `${r.band} ${r.time}: ${r.action}, ${r.base}->${r.headway} min, stations ${r.stations.join("/") || "all"}; signals: ${r.reasons.map((x) => x.text).join("; ")}`).join("\n");
  const narrative = (await groq(`Write a concise operations report (max 220 words) for the ${cityName} Metro control room for ${a.date}. Sections with these exact headings on their own lines: Summary, Key risks, Actions for tomorrow, Station notes. Plain text, no markdown symbols. Use ONLY these facts.\nAlert level: ${a.alert}. Day: ${a.dayType}${a.holiday ? ` (${a.holiday.name})` : ""}. Weather: ${a.weather.precipSum} mm rain, ${a.weather.precipProb}% chance, max ${a.weather.tempMax}C (${a.weather.source}). Events: ${a.events.join(", ") || "none"}. Fleet: ${a.fleet.trainsPeak} trains at peak (${a.fleet.extraTrains >= 0 ? "+" : ""}${a.fleet.extraTrains} vs plan), crew ${a.fleet.crewPeak}.\n${facts}`, 900))
    ?? `Summary\nAlert level ${a.alert}. ${a.rows.map((r) => `${r.band}: ${r.action}`).join(". ")}.\nActions for tomorrow\n${a.rows.map((r) => r.justification).join("\n")}`;
  const subject = `[${a.alert.toUpperCase()}] ${cityName} Metro headway report — ${a.date}`;
  const html = `<!doctype html><html><body style="font-family:Georgia,serif;color:#161616;background:#f6f4ef;margin:0;padding:24px"><div style="max-width:640px;margin:auto">
<p style="font:12px monospace;letter-spacing:.1em;text-transform:uppercase;color:#666;margin:0">Gujarat Metro · Control room report</p>
<h1 style="font-weight:normal;margin:6px 0 4px">${esc(cityName)} — ${esc(a.date)}</h1>
<p style="margin:0 0 16px;color:#444">Alert: <b>${esc(a.alert)}</b> · ${esc(a.dayType)}${a.holiday ? ` · ${esc(a.holiday.name)}` : ""} · ${esc(a.weather.precipSum)} mm, ${esc(a.weather.tempMax)}°C · Peak fleet ${esc(a.fleet.trainsPeak)} trains</p>
${narrative.split("\n").filter((l) => l.trim()).map((l) => /^(Summary|Key risks|Actions for tomorrow|Station notes)\s*:?$/i.test(l.trim()) ? `<h3 style="font:600 13px sans-serif;text-transform:uppercase;letter-spacing:.08em;border-top:1px solid #ccc;padding-top:12px;margin:16px 0 6px">${esc(l.replace(/:$/, ""))}</h3>` : `<p style="margin:0 0 8px;line-height:1.5">${esc(l)}</p>`).join("\n")}
<table style="width:100%;border-collapse:collapse;font:14px sans-serif;margin-top:16px">
<tr style="text-align:left;border-bottom:1px solid #161616"><th>Band</th><th>Headway</th><th>Change</th><th>Stations</th></tr>
${a.rows.map((r) => `<tr style="border-bottom:1px solid #ddd"><td>${esc(r.band)}<br><small>${esc(r.time)}</small></td><td>${esc(r.headway)} min</td><td>${esc(r.action)}</td><td>${esc(r.stations.join(", ") || "All")}</td></tr>`).join("\n")}
</table><p style="font:12px sans-serif;color:#777;margin-top:20px">Generated automatically from live weather, holiday and event signals. Baselines and fleet figures are assumptions; verify before acting.</p></div></body></html>`;
  return { subject, html, text: `${subject}\n\n${narrative}\n\n${a.rows.map((r) => `${r.band} ${r.time}: ${r.headway} min (${r.action})`).join("\n")}` };
}
app.post("/api/report/preview", route(async (req) => buildReport(req.body ?? {})));
app.post("/api/report/send", route(async (req) => {
  const to = String(req.body?.to ?? "").trim().toLowerCase();
  if (!recipients().includes(to)) throw bad("recipient is not on the authorised list", 403);
  if (!process.env.SMTP_HOST || !process.env.SMTP_USER) throw bad("email is not configured on the server", 503);
  const report = await buildReport(req.body);
  const mailer = nodemailer.createTransport({ host: process.env.SMTP_HOST, port: Number(process.env.SMTP_PORT ?? 587), auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS } });
  await mailer.sendMail({ from: `"Metro Ops Advisor" <${process.env.SMTP_USER}>`, to, subject: report.subject, text: report.text, html: report.html });
  if (db) db.collection("reports").insertOne({ to, subject: report.subject, sentAt: new Date() }).catch(() => {});
  return { ok: true, sentTo: to };
}));

app.get("/api/config", async (_req, res) => res.json({ config: await getConfig(), defaults: DEFAULT_CONFIG }));
app.put("/api/config", async (req, res) => {
  const c = req.body;
  const nums = [...Object.values(c?.base ?? {}), ...Object.values(c?.tier ?? {}), c?.heavyRain, c?.moderateRain, c?.heat, c?.holidayWiden, c?.saturdayWiden, c?.min, c?.max];
  if (!nums.every((n) => Number.isFinite(n) && n >= 0 && n <= 30)) return res.status(400).json({ error: "all rule values must be numbers between 0 and 30" });
  if (![...Object.values(c.costs ?? {}), ...Object.values(c.routeKm ?? {})].every((n) => Number.isFinite(n) && n > 0 && n <= 500)) return res.status(400).json({ error: "costs and routeKm values must be numbers above 0 and at most 500" });
  await saveConfig(c);
  res.json({ ok: true });
});

// Multi-day planner: weather + holidays + events for each day, template reasons only (no LLM) to stay fast.
app.post("/api/plan", async (req, res) => {
  const { from, days = 7, city = "ahmedabad" } = req.body ?? {};
  if (!CITIES[city]) return res.status(400).json({ error: "city must be ahmedabad or gandhinagar" });
  if (!isDate(from)) return res.status(400).json({ error: "from must be YYYY-MM-DD" });
  const n = Math.min(14, Math.max(1, Number(days) || 7));
  const dates = Array.from({ length: n }, (_, i) => new Date(Date.parse(from) + i * 864e5).toISOString().slice(0, 10));
  const [catalog, weather, holidays, live, cfg] = await Promise.all([find("events"), getWeatherRange(from, n, city), getHolidays(from.slice(0, 4)), Promise.all(dates.map((d) => getLiveEvents(d, city))), getConfig()]);
  const plan = dates.map((date, i) => {
    const events = [...catalog.filter((e) => e.city === city && e.date === date), ...live[i]];
    const holiday = holidays.find((h) => h.date === date) ?? null;
    const r = recommend({ date, city, weather: weather[date], holiday, events }, cfg);
    return { date, holiday, weather: weather[date], events: events.map((e) => ({ name: e.name, live: !!e.live })), ...r, rows: r.rows.map((x) => ({ band: x.band, base: x.base, headway: x.headway, delta: x.delta })), stations: stationSurges(events, cfg) };
  });
  res.json({ city, plan });
});

app.get("/api/history", async (_req, res) => {
  if (!db) return res.json([]);
  res.json(await db.collection("advisories").find({}, { projection: { _id: 0, date: 1, events: 1, createdAt: 1, "weather.source": 1 } }).sort({ createdAt: -1 }).limit(8).toArray());
});

// --- Autopilot: daily at AUTO_TIME (IST, default 18:00) build tomorrow's advisory for both cities with all known
// events, save it, and email the AI report to authorised recipients. Also runs once at startup (no email).
const latestAuto = {};
const istNow = () => new Date(Date.now() + 19800000);
const istTomorrow = () => new Date(istNow().getTime() + 864e5).toISOString().slice(0, 10);
async function autoRun({ email = false } = {}) {
  const date = istTomorrow();
  const done = [];
  for (const city of Object.keys(CITIES)) {
    try {
      const { rawEvents, ...a } = await buildAdvisory({ date, city, weatherMode: "live" });
      latestAuto[city] = { ...a, auto: true };
      done.push(city);
      if (db) await db.collection("advisories").insertOne({ ...a, auto: true });
      if (email && process.env.SMTP_HOST && recipients().length) {
        const report = await buildReport({ date, city, weatherMode: "live" });
        const mailer = nodemailer.createTransport({ host: process.env.SMTP_HOST, port: Number(process.env.SMTP_PORT ?? 587), auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS } });
        await mailer.sendMail({ from: `"Metro Ops Advisor" <${process.env.SMTP_USER}>`, to: recipients().join(","), subject: report.subject, text: report.text, html: report.html });
        console.log(`Autopilot emailed ${city} report for ${date}`);
      }
    } catch (e) {
      console.warn(`Autopilot failed for ${city}:`, e.message);
    }
  }
  console.log(`Autopilot built advisories for ${date}: ${done.join(", ")}`);
  return { date, cities: done };
}
function scheduleAuto() {
  const [h, m] = (process.env.AUTO_TIME ?? "18:00").split(":").map(Number);
  const now = istNow(), next = new Date(now);
  next.setUTCHours(h, m, 0, 0);
  if (next <= now) next.setUTCDate(next.getUTCDate() + 1);
  setTimeout(async () => { await autoRun({ email: true }); scheduleAuto(); }, next - now);
  console.log(`Autopilot next run ${next.toISOString().slice(0, 16).replace("T", " ")} IST`);
}
app.get("/api/auto", route(async (req) => latestAuto[req.query.city] ?? null));
app.post("/api/auto/run", route(async () => autoRun()));

// --- Disruption mode: closed stations -> neighbour load, headway rows with closure pseudo-events, reroutes ---
const hhmm = (h) => `${Math.floor(h)}:${String(Math.round((h % 1) * 60)).padStart(2, "0")}`;
app.post("/api/disruption", route(async (req) => {
  const { closed, fromHour, toHour } = req.body ?? {};
  const net = network();
  const st = new Map(net.stations.map((s) => [s.id, s]));
  if (!Array.isArray(closed) || !closed.length || !closed.every((id) => st.has(id))) throw bad("closed must be a non-empty list of station ids");
  if (![fromHour, toHour].every((h) => Number.isFinite(h) && h >= 0 && h <= 24) || fromHour >= toHour) throw bad("fromHour and toHour must be hours 0-24 with fromHour < toHour");
  const shut = new Set(closed);
  // Neighbours: next open station each way on every line through a closed station.
  const near = new Map(), pairs = new Map();
  for (const l of net.lines) l.stations.forEach((id, i) => {
    if (!shut.has(id)) return;
    const side = (step) => { let j = i + step; while (shut.has(l.stations[j])) j += step; return l.stations[j]; };
    const [a, b] = [side(-1), side(1)];
    [l.stations[i - 1], l.stations[i + 1]].filter((n) => n && !shut.has(n)).forEach((n) => near.set(n, [...new Set([...(near.get(n) ?? []), id])]));
    if (a && b) pairs.set([a, b].sort().join("|"), [a, b]);
  });
  // extraLoad heuristic: 40 per adjacent closure, +20 at an interchange, capped at 100.
  const neighbours = [...near].map(([id, by]) => ({ id, name: st.get(id).name, extraLoad: Math.min(100, 40 * by.length + (st.get(id).interchange ? 20 : 0)), by }));
  const day = await resolveDay({ date: req.body.date, city: req.body.city, weatherMode: req.body.weatherMode });
  const pseudo = closed.map((id) => ({ type: "stadium", name: `Closure of ${st.get(id).name}`, venue: st.get(id).name, startHour: fromHour, endHour: toHour, attendance: 15000, stations: neighbours.filter((n) => n.by.includes(id)).map((n) => n.name) }));
  const { rows } = recommend({ ...day, events: [...day.events, ...pseudo] }, await getConfig());
  rows.forEach((r) => (r.justification = templateJustification(r)));
  const reroutes = [...pairs.values()].map(([a, b]) => {
    try {
      const j = journey(a, b, `${String(Math.floor(fromHour)).padStart(2, "0")}:00`, shut);
      return { from: st.get(a).name, to: st.get(b).name, minutes: j.minutes, legs: j.legs, ok: true };
    } catch { return { from: st.get(a).name, to: st.get(b).name, ok: false, note: "no route — bus bridge needed" }; }
  });
  const names = closed.map((id) => st.get(id).name).join(", ");
  const bridges = reroutes.filter((r) => !r.ok).length;
  const justification = (await groq(`Metro control room. Write ONE plain sentence (max 30 words) telling the operator how to handle this closure. Use ONLY these facts.
Closed: ${names}, ${hhmm(fromHour)}-${hhmm(toHour)}. Busier neighbours: ${neighbours.map((n) => `${n.name} +${n.extraLoad}`).join(", ") || "none"}. Reroutes: ${reroutes.map((r) => r.ok ? `${r.from}-${r.to} ${r.minutes} min` : `${r.from}-${r.to} bus bridge`).join("; ") || "none"}. Headways: ${rows.map((r) => `${r.band} ${r.headway} min`).join(", ")}.`))
    ?? `${names} closed ${hhmm(fromHour)}–${hhmm(toHour)}: expect extra load at ${neighbours.map((n) => n.name).join(", ") || "no adjacent stations"}${bridges ? `; ${bridges} gap(s) need a bus bridge` : ""}.`;
  return { closed: closed.map((id) => ({ id, name: st.get(id).name })), rows, neighbours: neighbours.map(({ by, ...n }) => n), reroutes, justification };
}));

// --- Drift: has tonight's autopilot plan gone stale against a fresh live build? ---
app.get("/api/drift", route(async (req) => {
  const city = req.query.city;
  if (!CITIES[city]) throw bad("city must be ahmedabad or gandhinagar");
  const p = latestAuto[city];
  const now = await buildAdvisory({ date: p?.date ?? istTomorrow(), city, weatherMode: "live" }, { fast: true });
  const bandsChanged = p ? now.rows.map((r) => ({ band: r.band, planned: p.rows.find((x) => x.band === r.band)?.headway ?? null, now: r.headway })).filter((b) => b.planned !== b.now) : [];
  return {
    planned: p ? { date: p.date, weather: p.weather, alert: p.alert, createdAt: p.createdAt } : null,
    now: { weather: now.weather, alert: now.alert },
    changed: !!p && (p.alert !== now.alert || bandsChanged.length > 0),
    bandsChanged,
  };
}));

// --- Decision / audit log: what the operator actually ran vs what was recommended ---
const memDecisions = [];
// --- Operator login: control room decides; station operators see their station's updates ---
const memUsers = [];
const userColl = () => (db ? db.collection("users") : null);
const findUser = async (username) => (userColl() ? userColl().findOne({ username }, { projection: { _id: 0 } }) : memUsers.find((u) => u.username === username));
async function seedUsers() {
  const pw = process.env.DEMO_PASSWORD;
  if (!pw) return console.warn("DEMO_PASSWORD not set — no operator accounts seeded");
  for (const u of DEMO_USERS) {
    if (await findUser(u.username)) continue;
    const doc = { ...u, ...hashPassword(pw), createdAt: new Date() };
    if (userColl()) await userColl().insertOne(doc); else memUsers.push(doc);
  }
}
const needUser = (req, role) => {
  const u = readToken(req.headers.authorization);
  if (!u) throw bad("please log in", 401);
  if (role && u.role !== role && u.role !== "admin") throw bad("not allowed for your role", 403); // master admin can do everything
  return u;
};
const loginTries = new Map(); // shortcut: in-memory brute-force limit per username, fine for one server
app.post("/api/auth/login", route(async (req) => {
  const { username, password } = req.body ?? {};
  if (typeof username !== "string" || typeof password !== "string" || !username || username.length > 40 || password.length > 200) throw bad("username and password are required");
  const key = username.toLowerCase(), tries = loginTries.get(key) ?? { n: 0, t: Date.now() };
  if (tries.n >= 5 && Date.now() - tries.t < 600000) throw bad("too many attempts — try again in 10 minutes", 429);
  const user = await findUser(key);
  if (!user || !checkPassword(password, user)) { loginTries.set(key, { n: tries.n + 1, t: Date.now() }); throw bad("wrong username or password", 401); }
  loginTries.delete(key);
  const { hash, salt, ...pub } = user;
  return { token: issueToken(user), user: pub };
}));
app.get("/api/auth/me", route(async (req) => needUser(req)));
app.get("/api/auth/accounts", route(async () => DEMO_USERS.map(({ username, name, role, station }) => ({ username, name, role, station }))));

// --- Master admin: create / reassign / remove operators; the operator is notified in-app and by email ---
const pubUser = ({ hash, salt, _id, ...u }) => u;
const listUsers = async () => (userColl() ? userColl().find({}, { projection: { _id: 0, hash: 0, salt: 0 } }).toArray() : memUsers.map(pubUser));
const saveUser = async (u) => (userColl() ? userColl().replaceOne({ username: u.username }, u, { upsert: true }) : (memUsers.splice(memUsers.findIndex((x) => x.username === u.username) >>> 0, 1), memUsers.push(u)));
const stationById = (id) => network().stations.find((s) => s.id === id);
async function notifyAssignment(u, by) {
  const st = stationById(u.station);
  const text = st ? `${u.name} is now the operator for ${st.name}.` : `${u.name} now has ${u.role} access.`;
  const doc = { station: u.station ?? "all", text, from: by, at: new Date(), kind: "assignment" };
  if (db) await db.collection("notices").insertOne({ ...doc }); else memNotices.unshift(doc);
  if (u.email && process.env.SMTP_HOST && process.env.SMTP_USER) {
    const mailer = nodemailer.createTransport({ host: process.env.SMTP_HOST, port: Number(process.env.SMTP_PORT ?? 587), auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS } });
    await mailer.sendMail({ from: `"Metro Ops Advisor" <${process.env.SMTP_USER}>`, to: u.email, subject: `You have been assigned: ${st?.name ?? u.role}`, text: `Hello ${u.name},

${text}
Log in with username "${u.username}". Your password is shared by the admin separately.

Metro Ops Advisor` })
      .then(() => (doc.emailed = true)).catch((e) => console.warn("assignment email failed:", e.message));
  }
  return doc;
}
const validUserBody = (b, creating) => {
  const username = String(b.username ?? "").trim().toLowerCase();
  if (creating && !/^[a-z0-9._-]{3,30}$/.test(username)) throw bad("username: 3-30 letters, numbers, dot, dash or underscore");
  if (b.role !== undefined && !["station", "control", "admin"].includes(b.role)) throw bad("role must be station, control or admin");
  if (b.name !== undefined && (typeof b.name !== "string" || !b.name.trim() || b.name.length > 60)) throw bad("name must be 1-60 characters");
  if (b.email && !/^[^s@]+@[^s@]+.[^s@]+$/.test(b.email)) throw bad("email looks wrong");
  if (b.station && !stationById(b.station)) throw bad("unknown station");
  if (b.password !== undefined && (typeof b.password !== "string" || b.password.length < 8 || b.password.length > 100)) throw bad("password must be 8-100 characters");
  return username;
};
app.get("/api/admin/operators", route(async (req) => { needUser(req, "admin"); return listUsers(); }));
app.post("/api/admin/operators", route(async (req) => {
  const admin = needUser(req, "admin");
  const b = req.body ?? {};
  const username = validUserBody(b, true);
  if (!b.password || !b.name) throw bad("name and password are required");
  if (await findUser(username)) throw bad("that username is taken", 409);
  const role = b.role ?? "station";
  if (role === "station" && !b.station) throw bad("choose a station for a station operator");
  const u = { username, name: b.name.trim(), email: b.email || null, role, station: role === "station" ? b.station : null, ...hashPassword(b.password), createdAt: new Date(), createdBy: admin.name };
  await saveUser(u);
  return { user: pubUser(u), notified: await notifyAssignment(u, admin.name) };
}));
app.patch("/api/admin/operators/:username", route(async (req) => {
  const admin = needUser(req, "admin");
  const b = req.body ?? {};
  validUserBody(b, false);
  const u = await findUser(String(req.params.username).toLowerCase());
  if (!u) throw bad("no such operator", 404);
  const next = { ...u, ...(b.name && { name: b.name.trim() }), ...(b.email !== undefined && { email: b.email || null }), ...(b.role && { role: b.role }), ...(b.station !== undefined && { station: b.station || null }), ...(b.password && hashPassword(b.password)) };
  if (next.role === "station" && !next.station) throw bad("a station operator needs a station");
  if (next.role !== "station") next.station = null;
  await saveUser(next);
  const moved = next.station !== u.station || next.role !== u.role;
  return { user: pubUser(next), notified: moved ? await notifyAssignment(next, admin.name) : null };
}));
app.delete("/api/admin/operators/:username", route(async (req) => {
  const admin = needUser(req, "admin");
  const name = String(req.params.username).toLowerCase();
  if (name === admin.username) throw bad("you cannot remove your own account");
  if (userColl()) await userColl().deleteOne({ username: name }); else { const i = memUsers.findIndex((x) => x.username === name); if (i >= 0) memUsers.splice(i, 1); }
  return { ok: true };
}));

// Notices from the control room to a station, and station acknowledgements.
const memNotices = [], memAcks = [];
app.post("/api/notices", route(async (req) => {
  const u = needUser(req, "control");
  const { station, text } = req.body ?? {};
  if (!network().stations.some((s) => s.id === station)) throw bad("unknown station");
  if (typeof text !== "string" || !text.trim() || text.length > 500) throw bad("message must be 1-500 characters");
  const doc = { station, text: text.trim(), from: u.name, at: new Date() };
  if (db) await db.collection("notices").insertOne({ ...doc }); else memNotices.unshift(doc);
  return { ok: true };
}));
app.post("/api/station-feed/ack", route(async (req) => {
  const u = needUser(req, "station");
  const { date } = req.body ?? {};
  if (!isDate(date)) throw bad("date must be YYYY-MM-DD");
  const doc = { station: u.station, date, by: u.name, at: new Date() };
  if (db) await db.collection("acks").insertOne({ ...doc }); else memAcks.unshift(doc);
  return { ok: true };
}));
// One station's view: today's plan rows that touch it, surges there, control-room decisions, notices, acks.
app.get("/api/station-feed", route(async (req) => {
  const u = needUser(req);
  const stationId = u.role === "station" ? ((await findUser(u.username))?.station ?? u.station) /* reassignment applies without re-login */ : String(req.query.station ?? "");
  const st = network().stations.find((s) => s.id === stationId);
  if (!st) throw bad("unknown station");
  const city = st.city;
  const plan = latestAuto[city] ?? null;
  const date = plan?.date ?? istTomorrow();
  const list = async (coll, mem, q) => (db ? db.collection(coll).find(q, { projection: { _id: 0 } }).sort({ at: -1 }).limit(50).toArray() : mem.filter((d) => Object.entries(q).every(([k, v]) => d[k] === v)).slice(0, 50));
  const [decisions, notices, acks] = await Promise.all([list("decisions", memDecisions, { date, city }), list("notices", memNotices, { station: st.id }), list("acks", memAcks, { station: st.id, date })]);
  return {
    station: st, date, city, alert: plan?.alert ?? null, createdAt: plan?.createdAt ?? null,
    rows: (plan?.rows ?? []).map(({ band, time, base, headway, delta, action, justification, stations }) => ({ band, time, base, headway, delta, action, justification, trainsPerHour: Math.round(60 / headway), affectsThisStation: stations.includes(st.name) })),
    surges: plan?.stations?.find((x) => x.station === st.name)?.surges ?? [],
    decisions, notices, acks,
  };
}));

app.post("/api/decisions", route(async (req) => {
  const user = needUser(req, "control");
  const { date, city, band, recommended, final, reason } = req.body ?? {};
  const operator = user.name; // from the login, not self-declared
  const cfg = { ...DEFAULT_CONFIG, ...(await getConfig()) };
  if (!CITIES[city]) throw bad("city must be ahmedabad or gandhinagar");
  if (!isDate(date)) throw bad("date must be YYYY-MM-DD");
  if (!bands().some((b) => b.label === band)) throw bad("band must be one of the band labels");
  if (!Number.isFinite(recommended) || !Number.isFinite(final)) throw bad("recommended and final must be numbers");
  if (final < cfg.min || final > cfg.max) throw bad(`final must be between ${cfg.min} and ${cfg.max} min`);
  if (typeof operator !== "string" || !operator.trim() || operator.trim().length > 60) throw bad("operator must be 1-60 characters");
  const why = typeof reason === "string" ? reason.trim() : "";
  if (why.length > 300 || (final !== recommended && !why)) throw bad("reason (1-300 characters) is required when final differs from recommended");
  const doc = { date, city, band, recommended, final, operator: operator.trim(), reason: why, at: new Date() };
  if (db) await db.collection("decisions").insertOne({ ...doc }); else memDecisions.unshift(doc);
  return { ok: true };
}));
app.get("/api/decisions", route(async (req) => {
  const { date, city } = req.query;
  if (date !== undefined && !isDate(date)) throw bad("date must be YYYY-MM-DD");
  if (city !== undefined && !CITIES[city]) throw bad("city must be ahmedabad or gandhinagar");
  const q = { ...(date && { date }), ...(city && { city }) };
  if (db) return db.collection("decisions").find(q, { projection: { _id: 0 } }).sort({ at: -1 }).limit(200).toArray();
  return memDecisions.filter((d) => (!date || d.date === date) && (!city || d.city === city)).slice(0, 200);
}));

// --- Staff shift brief (WhatsApp length) in English, Gujarati or Hindi ---
const LANGS = { en: "English", gu: "Gujarati (Gujarati script)", hi: "Hindi (Devanagari script)" };
app.post("/api/brief", route(async (req) => {
  const lang = req.body?.lang ?? "en";
  if (!LANGS[lang]) throw bad("lang must be en, gu or hi");
  const a = await buildAdvisory(req.body, { fast: true });
  const cityName = a.city === "gandhinagar" ? "Gandhinagar" : "Ahmedabad";
  const facts = `${cityName} Metro, ${a.date}. Alert: ${a.alert}. Day: ${a.dayType}${a.holiday ? ` (${a.holiday.name})` : ""}. Weather: ${a.weather.precipSum} mm rain, max ${a.weather.tempMax}C. Events: ${a.events.join(", ") || "none"}. Headways: ${a.rows.map((r) => `${r.band} ${r.time} every ${r.headway} min (${r.action})${r.stations.length ? ` focus ${r.stations.join("/")}` : ""}`).join("; ")}. Peak fleet ${a.fleet.trainsPeak} trains, crew ${a.fleet.crewPeak}.`;
  const ai = await groq(`Write a WhatsApp shift brief for metro station staff in ${LANGS[lang]}, at most 550 characters, plain text, no markdown. Use ONLY these facts; keep station names and numbers exact.\nFACTS: ${facts}`, 600);
  if (ai) return { text: ai.slice(0, 600), lang, ai: true };
  const text = `${cityName} Metro ${a.date} — alert ${a.alert.toUpperCase()}. ${a.weather.precipSum} mm rain, ${a.weather.tempMax}°C. ${a.rows.map((r) => `${r.band}: every ${r.headway} min${r.stations.length ? ` (${r.stations.join(", ")})` : ""}`).join(". ")}. Events: ${a.events.join(", ") || "none"}. Peak ${a.fleet.trainsPeak} trains.`;
  return { text: text.slice(0, 600), lang: "en", ai: false };
}));

const port = process.env.PORT ?? 3001;
app.listen(port, () => { console.log(`API on :${port}`); seedUsers().catch((e) => console.warn("seed users failed:", e.message)); autoRun().then(scheduleAuto); });
