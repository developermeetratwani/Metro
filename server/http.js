// Small HTTP helpers kept out of index.js so they can be unit-tested without a server or DB.

export const securityHeaders = (_req, res, next) => {
  res.set({ "X-Content-Type-Options": "nosniff", "X-Frame-Options": "DENY", "Referrer-Policy": "strict-origin-when-cross-origin" });
  next();
};

// shortcut: in-memory fixed window per IP, fine for one server process; move to Redis if we scale out.
export function rateLimit({ max = 20, windowMs = 60000, now = Date.now } = {}) {
  const hits = new Map();
  return (req, res, next) => {
    if (req.method !== "POST") return next();
    const key = req.ip, t = now(), h = hits.get(key);
    if (!h || t - h.t >= windowMs) hits.set(key, { t, n: 1 });
    else if (++h.n > max) {
      res.set("Retry-After", String(Math.ceil((h.t + windowMs - t) / 1000)));
      return res.status(429).json({ error: "too many requests — try again in a minute" });
    }
    if (hits.size > 10000) for (const [k, v] of hits) if (t - v.t >= windowMs) hits.delete(k);
    next();
  };
}

// RFC 4180 cell; a leading = + - @ is prefixed with ' so spreadsheets don't run it as a formula.
export const csvCell = (v) => {
  let s = String(v ?? "");
  if (typeof v !== "number" && /^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
export const toCsv = (rows) => rows.map((r) => r.map(csvCell).join(",")).join("\r\n") + "\r\n";
