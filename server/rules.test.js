import { test } from "node:test";
import assert from "node:assert/strict";
import events from "./data/events.json" with { type: "json" };
import { recommend, alertLevel, stationSurges, costOf, DEFAULT_CONFIG } from "./rules.js";
import { journey } from "./insights.js";

const clear = { precipSum: 0, precipProb: 10, tempMax: 30 };
const row = (r, id) => r.rows.find((x) => x.band.toLowerCase().includes(id));

test("normal weekday changes nothing", () => {
  const r = recommend({ date: "2026-10-14", weather: clear, holiday: null, events: [] });
  assert.ok(r.rows.every((x) => x.delta === 0));
});

test("cricket exit surge tightens late night and names stations", () => {
  const r = recommend({ date: "2026-10-11", weather: clear, holiday: null, events: [events[0]] });
  const late = row(r, "late");
  assert.equal(late.delta, -3);
  assert.ok(late.stations.includes("Motera Stadium"));
});

test("heavy rain widens every band", () => {
  const r = recommend({ date: "2026-10-14", weather: { ...clear, precipSum: 30 }, holiday: null, events: [] });
  assert.ok(r.rows.every((x) => x.delta === 2));
});

test("headway is clamped", () => {
  const r = recommend({ date: "2026-10-14", weather: clear, holiday: null, events: [events[0], { ...events[0] }, { ...events[0] }] });
  assert.ok(r.rows.every((x) => x.headway >= 3));
});

test("event running past midnight still tightens late night", () => {
  const r = recommend({ date: "2026-10-12", weather: clear, holiday: null, events: [events[1]] });
  assert.equal(row(r, "late").delta, -2);
});

test("config override changes baseline and rain widening", () => {
  const r = recommend({ date: "2026-10-14", weather: { ...clear, precipSum: 30 }, holiday: null, events: [] }, { base: { morning: 5 }, heavyRain: 4 });
  assert.equal(row(r, "morning").headway, 9);
});

test("alert levels", () => {
  assert.equal(recommend({ date: "2026-10-14", weather: clear, holiday: null, events: [] }).alert, "ok");
  assert.equal(recommend({ date: "2026-10-11", weather: clear, holiday: null, events: [events[0]] }).alert, "high");
  assert.equal(alertLevel([{ delta: 0 }], []), "ok");
});

test("live event without stations maps via venue keyword", () => {
  const s = stationSurges([{ name: "Ranji", venue: "Narendra Modi Stadium", startHour: 9.5, endHour: 17.5, attendance: 32000, type: "stadium" }]);
  assert.ok(s.some((x) => x.station === "Motera Stadium"));
});

test("costOf: base timetable has zero delta, tighter headways cost more", () => {
  const base = recommend({ date: "2026-10-14", weather: clear, holiday: null, events: [] });
  // 6-10 @4, 10-17 @8, 17-21 @4, 21-24 @10 -> 60+52.5+60+18 = 190.5 trips x 40 km
  assert.equal(base.cost.trainKm, 7620);
  assert.equal(base.cost.costINR, Math.round(7620 * 8 * 8));
  assert.deepEqual(base.cost.vsBaseline, { trainKm: 0, costINR: 0, co2Kg: 0 });
  const busy = costOf([{ band: "Late Night", base: 10, headway: 5 }], DEFAULT_CONFIG, "ahmedabad");
  assert.equal(busy.vsBaseline.trainKm, 36 * 40 - 18 * 40);
  assert.ok(busy.vsBaseline.co2Kg > 0);
});

test("journey with exclude routes around or fails", () => {
  const direct = journey("thaltej", "gurukul-road");
  assert.ok(direct.legs[0].stationIds.includes("doordarshan-kendra"));
  assert.throws(() => journey("thaltej", "gurukul-road", "09:00", new Set(["doordarshan-kendra"])), /no route/);
  assert.throws(() => journey("thaltej", "gurukul-road", "09:00", new Set(["thaltej"])), /closed/);
  assert.equal(journey("thaltej", "gurukul-road", "09:00", new Set(["apmc"])).minutes, direct.minutes); // unrelated closure
  assert.throws(() => journey("vadaj", "gandhigram", "09:00", new Set(["old-high-court"])), /no route/); // network is a tree: interchange closure splits it
});
