import { Component, useCallback, useEffect, useState, useSyncExternalStore } from "react";
import { useT, tv } from "./i18n.js";

// Login session {token, user} lives in localStorage; every api() call reads it from here.
const AUTH_KEY = "metro.auth";
let auth = (() => { try { return JSON.parse(localStorage.getItem(AUTH_KEY)) || null; } catch { return null; } })();
const subs = new Set();
export function setAuth(a) {
  auth = a;
  try { a ? localStorage.setItem(AUTH_KEY, JSON.stringify(a)) : localStorage.removeItem(AUTH_KEY); } catch { /* storage blocked */ }
  subs.forEach((f) => f());
}
export const useAuth = () => useSyncExternalStore((cb) => { subs.add(cb); return () => subs.delete(cb); }, () => auth);
export const isControl = (a) => ["control", "admin"].includes(a?.user?.role); // admin can do everything control can
export const isAdmin = (a) => a?.user?.role === "admin";
// "every 4 min · 15 trains/hour"
export const freq = (t, headway, tph) => t("freq", { n: headway, h: tph ?? (headway > 0 ? Math.round(60 / headway) : "-") });

export async function api(path, opts = {}) {
  const headers = { ...(opts.body !== undefined && { "Content-Type": "application/json" }), ...(auth?.token && { Authorization: `Bearer ${auth.token}` }) };
  let res;
  try {
    res = await fetch(path, { ...opts, headers, body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined });
  } catch {
    throw new Error("err.unreachable");
  }
  if (res.status === 401 && auth) setAuth(null); // expired or revoked token
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { /* non-JSON body */ }
  if (!res.ok) throw Object.assign(new Error(data?.error || (res.status === 404 ? "err.404" : `err.http:${res.status}`)), { status: res.status });
  if (data === null) throw new Error("err.bad");
  return data;
}

export function useGet(url) {
  const [s, set] = useState({ data: null, error: null, loading: !!url });
  useEffect(() => {
    if (!url) return set({ data: null, error: null, loading: false });
    let off = false;
    set((x) => ({ ...x, loading: true, error: null }));
    api(url).then((data) => !off && set({ data, error: null, loading: false }), (e) => !off && set({ data: null, error: e.message, loading: false }));
    return () => { off = true; };
  }, [url]);
  return s;
}

export function usePost(path) {
  const [s, set] = useState({ data: null, error: null, loading: false });
  const run = useCallback(async (body, p = path) => {
    set({ data: null, error: null, loading: true });
    try {
      const data = await api(p, { method: "POST", body });
      set({ data, error: null, loading: false });
      return data;
    } catch (e) {
      set({ data: null, error: e.message, loading: false });
      return null;
    }
  }, [path]);
  return [s, run];
}

export const CITIES = ["ahmedabad", "gandhinagar"];
export const WEATHER = ["live", "rain", "clear"];
export const cityName = (t, c) => tv(t, "city.", c);
export const weatherName = (t, m) => tv(t, "wx.", m);
export const today = () => { const d = new Date(); return new Date(d - d.getTimezoneOffset() * 6e4).toISOString().slice(0, 10); };
export const tomorrow = () => { const d = new Date(Date.now() + 864e5); return new Date(d - d.getTimezoneOffset() * 6e4).toISOString().slice(0, 10); };
// 21.5 -> 21:30, 25 -> 01:00 (next day)
export const fmtHour = (h) => `${String(Math.floor(h) % 24).padStart(2, "0")}:${h % 1 ? "30" : "00"}`;
export const fmtDate = (s) => new Date(`${s}T00:00:00`).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" });

// delta < 0 = trains more frequent (tighten); > 0 = wider gaps
export const dcls = (d) => (d < 0 ? "tight" : d > 0 ? "wide" : "same");
export const fmtDelta = (d) => (d < 0 ? `−${-d} min` : d > 0 ? `+${d} min` : "—");
export const dword = (t, d) => t(`d.${dcls(d)}`);
export const alertName = (t, a) => tv(t, "alert.", a);
export const bandName = (t, b) => tv(t, "band.", b);

export function Msg({ loading, error, empty, children }) {
  const t = useT();
  return loading ? <p className="msg" role="status">{t("loading")}</p>
    : error ? <p className="msg err" role="alert">{t(error)}</p>
    : empty ? <p className="msg">{empty}</p>
    : children ?? null;
}

export function CitySelect({ value, onChange }) {
  const t = useT();
  return (
    <label>{t("city")}
      <select value={value} onChange={(e) => onChange(e.target.value)}>
        {CITIES.map((k) => <option key={k} value={k}>{cityName(t, k)}</option>)}
      </select>
    </label>
  );
}

export function Context({ app, weather = true }) {
  const t = useT();
  return (
    <div className="controls">
      <CitySelect value={app.city} onChange={app.setCity} />
      <label>{t("date")}
        <input type="date" value={app.date} onChange={(e) => e.target.value && app.setDate(e.target.value)} />
      </label>
      {weather && (
        <label>{t("weather")}
          <select value={app.weatherMode} onChange={(e) => app.setWeatherMode(e.target.value)}>
            {WEATHER.map((k) => <option key={k} value={k}>{weatherName(t, k)}</option>)}
          </select>
        </label>
      )}
    </div>
  );
}

export const PageHead = ({ title, lede }) => (
  <header className="pagehead">
    <h1>{title}</h1>
    {lede && <p className="lede">{lede}</p>}
  </header>
);

// Number formatted for the en-IN grouping the control room uses (1,23,456).
export const n0 = (x) => (x == null || Number.isNaN(+x) ? "-" : Math.round(+x).toLocaleString("en-IN"));

export function lsGet(k, d = "") { try { return localStorage.getItem(k) ?? d; } catch { return d; } }
export function lsSet(k, v) { try { localStorage.setItem(k, v); } catch { /* storage blocked */ } }

export const bodyOf = (app) => ({ date: app.date, city: app.city, eventIds: app.eventIds, weatherMode: app.weatherMode });

export function Cost({ c, label }) {
  const t = useT();
  const v = c.vsBaseline;
  const sg = (x) => (x > 0 ? `+${n0(x)}` : x < 0 ? `−${n0(-x)}` : "0");
  return (
    <div className="fleet cost">
      <span className="label">{label ?? t("cost.label")}</span>
      <span><b className="num">{n0(c.trainKm)}</b> {t("cost.trainKm")}{v && <small className="num">{sg(v.trainKm)}</small>}</span>
      <span><b className="num">&#8377;{n0(c.costINR)}</b>{v && <small className="num">{sg(v.costINR)}</small>}</span>
      <span><b className="num">{n0(c.co2Kg)}</b> {t("cost.co2")}{v && <small className="num">{sg(v.co2Kg)}</small>}</span>
      {v && <small>{t("cost.vs")} · {t("cost.note")}</small>}
    </div>
  );
}

// Lines with each station listed only once (interchanges sit under their first line) — for pickers.
export const uniqLines = (lines) => {
  const seen = new Set();
  return lines.map((l) => ({ ...l, stations: l.stations.filter((id) => !seen.has(id) && seen.add(id)) }));
};

// One page crash shows this panel instead of blanking the app; keyed by page in App so navigating resets it.
export class ErrorBoundary extends Component {
  state = { err: null };
  static getDerivedStateFromError(err) { return { err }; }
  componentDidCatch(err, info) { console.error(err, info.componentStack); }
  render() {
    if (!this.state.err) return this.props.children;
    const t = this.props.t;
    return (
      <div className="banner high" role="alert">
        <strong>{t("err.crash")}</strong>{" "}
        <button className="primary" onClick={() => location.reload()}>{t("err.reload")}</button>
      </div>
    );
  }
}
