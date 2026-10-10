// Operator accounts: scrypt-hashed passwords + HMAC-signed tokens (no extra dependency).
// Roles: "control" (control room, sees and decides everything) and "station" (one station's view).
import { scryptSync, randomBytes, timingSafeEqual, createHmac } from "node:crypto";

const SECRET = process.env.AUTH_SECRET || randomBytes(32).toString("hex"); // unset = tokens die on restart
const TTL = 12 * 3600 * 1000;

export const hashPassword = (pw, salt = randomBytes(16).toString("hex")) => ({ salt, hash: scryptSync(pw, salt, 64).toString("hex") });
export const checkPassword = (pw, user) => {
  const a = Buffer.from(scryptSync(pw, user.salt, 64).toString("hex"));
  const b = Buffer.from(user.hash);
  return a.length === b.length && timingSafeEqual(a, b);
};

const sign = (s) => createHmac("sha256", SECRET).update(s).digest("base64url");
export const issueToken = (u) => {
  const body = Buffer.from(JSON.stringify({ u: u.username, r: u.role, s: u.station ?? null, n: u.name, exp: Date.now() + TTL })).toString("base64url");
  return `${body}.${sign(body)}`;
};
export function readToken(header) {
  const [body, sig] = String(header ?? "").replace(/^Bearer\s+/i, "").split(".");
  if (!body || !sig) return null;
  const expected = sign(body);
  if (sig.length !== expected.length || !timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
  let p;
  try { p = JSON.parse(Buffer.from(body, "base64url").toString()); } catch { return null; }
  return p.exp > Date.now() ? { username: p.u, role: p.r, station: p.s, name: p.n } : null;
}

// Demo accounts: one control room login plus one login per key station. Password comes from DEMO_PASSWORD.
export const DEMO_USERS = [
  { username: "control", name: "Control Room", role: "control", station: null },
  { username: "motera", name: "Motera Stadium station", role: "station", station: "motera-stadium" },
  { username: "kalupur", name: "Kalupur Railway Station", role: "station", station: "kalupur-railway-station" },
  { username: "oldhighcourt", name: "Old High Court station", role: "station", station: "old-high-court" },
  { username: "sabarmati", name: "Sabarmati station", role: "station", station: "sabarmati" },
  { username: "mahatmamandir", name: "Mahatma Mandir station", role: "station", station: "mahatma-mandir" },
  { username: "giftcity", name: "GIFT City station", role: "station", station: "gift-city" },
];
