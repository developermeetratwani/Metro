import { test } from "node:test";
import assert from "node:assert/strict";
import { hashPassword, checkPassword, issueToken, readToken } from "./auth.js";

test("password hash round-trip", () => {
  const u = hashPassword("s3cret");
  assert.ok(checkPassword("s3cret", u));
  assert.ok(!checkPassword("wrong", u));
});

test("token verifies and rejects tampering", () => {
  const t = issueToken({ username: "motera", role: "station", station: "motera-stadium", name: "Motera" });
  assert.equal(readToken(`Bearer ${t}`).station, "motera-stadium");
  const [body, sig] = t.split(".");
  const forged = Buffer.from(JSON.stringify({ u: "x", r: "control", exp: Date.now() + 1e6 })).toString("base64url");
  assert.equal(readToken(`${forged}.${sig}`), null);
  assert.equal(readToken("garbage"), null);
});
