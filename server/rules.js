// Transparent rule engine: signals (event + weather + holiday/weekday) -> headway change per band.
// Baselines are ASSUMED values (peak 4 min, off-peak 8 min) — state this in the pitch.
// Every tunable number lives in DEFAULT_CONFIG so the what-if tool can override it.
export const DEFAULT_CONFIG = {
  base: { morning: 4, midday: 8, evening: 4, late: 10 },
  tier: { big: 3, mid: 2, small: 1 }, // tighten (min) for 50k+ / 10k+ / smaller crowds
  heavyRain: 2, moderateRain: 1, heat: 1, // widen (min)
  holidayWiden: 2, saturdayWiden: 1,
  min: 3, max: 15,
  cycle: { ahmedabad: 90, gandhinagar: 60 }, // assumed round-trip minutes per corridor, drives fleet sizing
  routeKm: { ahmedabad: 40, gandhinagar: 28 }, // assumed train-km run per departure (one headway slot), both directions combined
  costs: { kWhPerTrainKm: 8, inrPerKWh: 8, kgCO2PerKWh: 0.71 }, // assumed traction energy, tariff, Indian grid emission factor
};
const BAND_DEFS = [
  { id: "morning", label: "Morning Peak", from: 6, to: 10 },
  { id: "midday", label: "Midday", from: 10, to: 17 },
  { id: "evening", label: "Evening Peak", from: 17, to: 21 },
  { id: "late", label: "Late Night", from: 21, to: 24 },
];
export const bands = (cfg = DEFAULT_CONFIG) => BAND_DEFS.map((b) => ({ ...b, base: cfg.base[b.id] }));

const overlap = (b, from, to) => Math.min(b.to, to) - Math.max(b.from, from);
const fmt = (h) => `${Math.floor(h)}:${h % 1 ? "30" : "00"}`;

// Venue keyword -> nearest metro station, so live events (which carry no stations) still map.
const VENUE_STATIONS = [
  ["narendra modi", ["Motera Stadium", "Sabarmati"]],
  ["sardar vallabhbhai patel stadium", ["Old High Court", "Usmanpura"]],
  ["sabarmati riverfront", ["Sabarmati", "Usmanpura"]],
  ["hec exhibition", ["Thaltej Gam", "Gurukul Road"]],
  ["gmdc", ["Thaltej Gam", "Gurukul Road"]],
  ["mahatma mandir", ["Mahatma Mandir", "Sector 1"]],
  ["gift city", ["GIFT City"]],
  ["akshardham", ["Akshardham", "Sector 10A"]],
  ["kankaria", ["Kankaria East", "Kalupur"]],
];
export const stationsFor = (ev) => ev.stations?.length ? ev.stations : (VENUE_STATIONS.find(([k]) => `${ev.venue} ${ev.name}`.toLowerCase().includes(k))?.[1] ?? []);

export function weatherSeverity({ precipSum, precipProb, tempMax }) {
  if (precipSum >= 15) return "heavy-rain";
  if (precipSum >= 5 || precipProb >= 70) return "moderate-rain";
  if (tempMax >= 42) return "extreme-heat";
  return "clear";
}

const crowdTier = (a, cfg) => (a >= 50000 ? cfg.tier.big : a >= 10000 ? cfg.tier.mid : cfg.tier.small);

// The two demand windows an event creates (shared by the rules and the station view).
export function eventWindows(ev, cfg = DEFAULT_CONFIG) {
  const big = crowdTier(ev.attendance, cfg);
  if (ev.type === "market") return [{ from: ev.startHour, to: ev.endHour, delta: -1, what: "sustained shopping crowd", kind: "sustained" }];
  return [
    { from: ev.startHour - 1.5, to: ev.startHour, delta: -Math.max(1, big - 1), what: `arrivals before ${fmt(ev.startHour)}`, kind: "arrival" },
    ev.endHour >= 24
      ? { from: 23, to: 24, delta: -big, what: "late-night return surge (runs past midnight)", kind: "exit" } // last trains before service ends
      : { from: ev.endHour, to: ev.endHour + 1.5, delta: -big, what: `exit surge after ${fmt(ev.endHour)}`, kind: "exit" },
  ];
}

// Each rule returns [{ bandId, delta, signal, text, stations? }]; delta < 0 = more frequent trains.
function eventRules(ev, cfg, bs) {
  const stations = stationsFor(ev);
  return eventWindows(ev, cfg).flatMap((w) =>
    bs.filter((b) => overlap(b, w.from, w.to) >= 0.5).map((b) => ({
      bandId: b.id, delta: w.delta, signal: "event", text: `${ev.name} at ${ev.venue}: ${w.what}`, stations,
    })),
  );
}

function weatherRules(sev, w, cfg, bs) {
  const all = (delta, text) => bs.map((b) => ({ bandId: b.id, delta, signal: "weather", text }));
  if (sev === "heavy-rain") return all(cfg.heavyRain, `Heavy rain forecast (${w.precipSum} mm) — lower ridership expected`);
  if (sev === "moderate-rain") return all(cfg.moderateRain, `Rain likely (${w.precipProb}% chance) — slightly lower ridership`);
  if (sev === "extreme-heat") return [{ bandId: "midday", delta: cfg.heat, signal: "weather", text: `Extreme heat (${w.tempMax}°C) — fewer midday trips` }];
  return [];
}

function calendarRules(dayType, holidayName, cfg) {
  if (dayType === "holiday" || dayType === "sunday") {
    const why = holidayName ? `${holidayName} (public holiday)` : "Sunday";
    return ["morning", "evening"].map((bandId) => ({ bandId, delta: cfg.holidayWiden, signal: "calendar", text: `${why} — commuter peak is weaker` }));
  }
  if (dayType === "saturday") return [{ bandId: "morning", delta: cfg.saturdayWiden, signal: "calendar", text: "Saturday — weaker morning commute" }];
  return [];
}

export function dayType(dateStr, holiday) {
  if (holiday) return "holiday";
  const d = new Date(`${dateStr}T00:00:00Z`).getUTCDay();
  return d === 0 ? "sunday" : d === 6 ? "saturday" : "weekday";
}

export function recommend({ date, weather, holiday, events, city = "ahmedabad" }, config = {}) {
  const cfg = { ...DEFAULT_CONFIG, ...config, cycle: { ...DEFAULT_CONFIG.cycle, ...config.cycle }, base: { ...DEFAULT_CONFIG.base, ...config.base }, tier: { ...DEFAULT_CONFIG.tier, ...config.tier }, routeKm: { ...DEFAULT_CONFIG.routeKm, ...config.routeKm }, costs: { ...DEFAULT_CONFIG.costs, ...config.costs } };
  const bs = bands(cfg);
  const sev = weatherSeverity(weather);
  const type = dayType(date, holiday);
  const rules = [...calendarRules(type, holiday?.name, cfg), ...weatherRules(sev, weather, cfg, bs), ...events.flatMap((e) => eventRules(e, cfg, bs))];
  const rows = bs.map((b) => {
    const reasons = rules.filter((r) => r.bandId === b.id);
    const raw = b.base + reasons.reduce((s, r) => s + r.delta, 0);
    const headway = Math.min(cfg.max, Math.max(cfg.min, raw));
    const delta = headway - b.base;
    const stations = [...new Set(reasons.flatMap((r) => r.stations ?? []))];
    return {
      trains: Math.ceil(cfg.cycle[city] / headway), band: b.label, time: `${fmt(b.from)}–${fmt(b.to)}`, base: b.base, headway, delta, stations,
      action: delta === 0 ? (reasons.length ? "Hold — signals offset" : "Normal") : `${delta < 0 ? "Tighten" : "Widen"} by ${Math.abs(delta)} min`,
      reasons: reasons.length ? reasons : [{ signal: "baseline", delta: 0, text: "No unusual demand signal — run the planned timetable" }],
    };
  });
  return { dayType: type, weatherSeverity: sev, alert: alertLevel(rows, events), rows, fleet: fleet(rows, cfg, city), cost: costOf(rows, cfg, city) };
}

// Daily train-km, energy, cost and CO2 implied by the headways, and the change vs the base timetable. Assumed constants.
export function costOf(rows, cfg = DEFAULT_CONFIG, city = "ahmedabad") {
  const { kWhPerTrainKm, inrPerKWh, kgCO2PerKWh } = { ...DEFAULT_CONFIG.costs, ...cfg.costs };
  const route = { ...DEFAULT_CONFIG.routeKm, ...cfg.routeKm }[city];
  const totals = (key) => {
    const trainKm = rows.reduce((s, r) => { const b = BAND_DEFS.find((d) => d.label === r.band); return s + (60 / r[key]) * (b.to - b.from) * route; }, 0);
    const kwh = trainKm * kWhPerTrainKm;
    return { trainKm: Math.round(trainKm), energyKWh: Math.round(kwh), costINR: Math.round(kwh * inrPerKWh), co2Kg: Math.round(kwh * kgCO2PerKWh) };
  };
  const now = totals("headway"), base = totals("base");
  return { ...now, vsBaseline: { trainKm: now.trainKm - base.trainKm, costINR: now.costINR - base.costINR, co2Kg: now.co2Kg - base.co2Kg } };
}

// Fleet and crew implied by the recommendation (crew = 2 per train, assumed).
function fleet(rows, cfg, city) {
  const trainsPeak = Math.max(...rows.map((r) => r.trains));
  const trainsBase = Math.max(...rows.map((r) => Math.ceil(cfg.cycle[city] / r.base)));
  const extraTrains = Math.max(...rows.map((r) => r.trains - Math.ceil(cfg.cycle[city] / r.base))); // biggest band-level increase over plan
  return { trainsPeak, trainsBase, extraTrains, crewPeak: trainsPeak * 2 };
}

// high: a big crowd or a 3+ min tightening; watch: any 2+ min move or an event; ok otherwise.
export function alertLevel(rows, events) {
  const tight = Math.min(0, ...rows.map((r) => r.delta));
  const crowd = Math.max(0, ...events.map((e) => e.attendance ?? 0));
  if (tight <= -3 || crowd >= 50000) return "high";
  if (tight <= -2 || Math.max(...rows.map((r) => Math.abs(r.delta))) >= 2 || events.length) return "watch";
  return "ok";
}

// Station manager view: when and how hard each station is hit.
export function stationSurges(events, cfg = DEFAULT_CONFIG) {
  const map = new Map();
  for (const ev of events) {
    for (const st of stationsFor(ev)) {
      for (const w of eventWindows(ev, cfg)) {
        const list = map.get(st) ?? [];
        list.push({ event: ev.name, kind: w.kind, window: `${fmt(w.from)}–${fmt(Math.min(24, w.to))}`, level: -w.delta >= 3 ? "severe" : -w.delta === 2 ? "high" : "moderate", crowd: ev.attendance, note: w.what });
        map.set(st, list);
      }
    }
  }
  return [...map].map(([station, surges]) => ({ station, surges })).sort((a, b) => b.surges.length - a.surges.length);
}

// Template justification; an LLM may replace it in server/index.js.
export function templateJustification(row) {
  const why = row.reasons.map((r) => r.text).join("; ");
  if (row.delta === 0) return `Keep ${row.base}-min headway: ${why}.`;
  const where = row.stations.length ? ` (focus on ${row.stations.join(", ")})` : "";
  return `Run every ${row.headway} min instead of ${row.base}${where}: ${why}.`;
}
