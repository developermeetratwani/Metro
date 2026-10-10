import { useCallback, useEffect, useState } from "react";

export async function api(path, opts) {
  let res;
  try {
    res = await fetch(path, opts && { ...opts, headers: { "Content-Type": "application/json" }, body: opts.body && JSON.stringify(opts.body) });
  } catch {
    throw new Error("Server not reachable.");
  }
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { /* non-JSON body */ }
  if (!res.ok) throw new Error(data?.error || (res.status === 404 ? "This endpoint is not available on the server yet." : `Request failed (HTTP ${res.status}).`));
  if (data === null) throw new Error("Unexpected response from server.");
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

export const CITIES = [["ahmedabad", "Ahmedabad"], ["gandhinagar", "Gandhinagar"]];
export const WEATHER = [["live", "Live forecast"], ["rain", "Simulate rain"], ["clear", "Simulate clear"]];
export const cityName = (c) => CITIES.find(([k]) => k === c)?.[1] ?? c;
export const weatherName = (m) => WEATHER.find(([k]) => k === m)?.[1] ?? m;
export const today = () => { const d = new Date(); return new Date(d - d.getTimezoneOffset() * 6e4).toISOString().slice(0, 10); };
export const tomorrow = () => { const d = new Date(Date.now() + 864e5); return new Date(d - d.getTimezoneOffset() * 6e4).toISOString().slice(0, 10); };
// 21.5 -> 21:30, 25 -> 01:00 (next day)
export const fmtHour = (h) => `${String(Math.floor(h) % 24).padStart(2, "0")}:${h % 1 ? "30" : "00"}`;
export const fmtDate = (s) => new Date(`${s}T00:00:00`).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" });

// delta < 0 = trains more frequent (tighten); > 0 = wider gaps
export const dcls = (d) => (d < 0 ? "tight" : d > 0 ? "wide" : "same");
export const fmtDelta = (d) => (d < 0 ? `−${-d} min` : d > 0 ? `+${d} min` : "—");
export const dword = (d) => (d < 0 ? "Tighten" : d > 0 ? "Widen" : "Hold");
export const ALERT = { ok: "Normal", watch: "Watch", high: "High alert" };

export const Msg = ({ loading, error, empty, children }) =>
  loading ? <p className="msg" role="status">Loading…</p>
  : error ? <p className="msg err" role="alert">{error}</p>
  : empty ? <p className="msg">{empty}</p>
  : children ?? null;

export function Context({ app, weather = true }) {
  return (
    <div className="controls">
      <label>City
        <select value={app.city} onChange={(e) => app.setCity(e.target.value)}>
          {CITIES.map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
      </label>
      <label>Date
        <input type="date" value={app.date} onChange={(e) => e.target.value && app.setDate(e.target.value)} />
      </label>
      {weather && (
        <label>Weather
          <select value={app.weatherMode} onChange={(e) => app.setWeatherMode(e.target.value)}>
            {WEATHER.map(([k, v]) => <option key={k} value={k}>{v}</option>)}
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

export const bodyOf = (app) => ({ date: app.date, city: app.city, eventIds: app.eventIds, weatherMode: app.weatherMode });
