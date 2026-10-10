import { test } from "node:test";
import assert from "node:assert/strict";
import { rateLimit, csvCell, toCsv } from "./http.js";
import { nearStations } from "./insights.js";

test("rate limiter allows max POSTs per window then 429s, ignores GET", () => {
  let t = 0, status = 200, calls = 0;
  const lim = rateLimit({ max: 2, windowMs: 1000, now: () => t });
  const res = { set() {}, status(s) { status = s; return { json() {} }; } };
  const hit = (method = "POST") => { status = 200; lim({ method, ip: "1.1.1.1" }, res, () => calls++); return status; };
  assert.equal(hit(), 200); assert.equal(hit(), 200); assert.equal(hit(), 429);
  assert.equal(hit("GET"), 200);
  t = 1000; assert.equal(hit(), 200);
});

test("csv escaping quotes commas/quotes/newlines and defuses formulas", () => {
  assert.equal(csvCell('a,"b"'), '"a,""b"""');
  assert.equal(csvCell("x\ny"), '"x\ny"');
  assert.equal(csvCell("=SUM(A1)"), "'=SUM(A1)");
  assert.equal(csvCell(-3), "-3");
  assert.equal(toCsv([["a", null]]), "a,\r\n");
});

test("nearStations keeps events in their own city", () => {
  assert.deepEqual(nearStations(23.0225, 72.5714, "gandhinagar"), []); // central Ahmedabad
  assert.ok(nearStations(23.05021, 72.50701, "ahmedabad").includes("Thaltej Gam"));
});
