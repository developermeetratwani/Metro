import { useCallback, useEffect, useMemo, useState } from "react";
import { MotionConfig } from "framer-motion";
import { useGet, tomorrow, lsGet, lsSet, api, useAuth, setAuth, ErrorBoundary } from "./ui.jsx";
import { LANGS, LangContext, translate } from "./i18n.js";
import Advisory from "./pages/Advisory.jsx";
import Planner from "./pages/Planner.jsx";
import Stations from "./pages/Stations.jsx";
import Journey from "./pages/Journey.jsx";
import Rules from "./pages/Rules.jsx";
import Report from "./pages/Report.jsx";
import MyStation from "./pages/MyStation.jsx";
import Login from "./pages/Login.jsx";
import Admin from "./pages/Admin.jsx";
import Public from "./pages/Public.jsx";
import Frequency from "./pages/Frequency.jsx";

const PAGES = [
  ["advisory", Advisory],
  ["planner", Planner],
  ["stations", Stations],
  ["journey", Journey],
  ["rules", Rules],
  ["report", Report],
  ["my-station", MyStation],
  ["login", Login],
  ["admin", Admin],
  ["public", Public],
  ["frequency", Frequency],
];
const fromHash = () => { const k = location.hash.replace(/^#\/?/, "").split("?")[0]; return PAGES.some(([id]) => id === k) ? k : "advisory"; };
const NAV = ["my-station", "advisory", "planner", "frequency", "stations", "journey", "rules", "report", "admin", "public"];
const when = (iso) => (iso ? new Date(iso).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : "");

function Bell({ t }) {
  const [open, setOpen] = useState(false);
  const [tick, setTick] = useState(0);
  const [note, setNote] = useState(null);
  useEffect(() => { const id = setInterval(() => setTick((n) => n + 1), 60000); return () => clearInterval(id); }, []);
  const n = useGet(`/api/notifications?r=${tick}`);
  if (n.error === "err.404") return null; // server without notifications yet
  const items = n.data?.items ?? [];
  const unread = n.data?.unread ?? 0;
  const seen = async () => {
    try { await api("/api/notifications/seen", { method: "POST", body: {} }); setNote(null); setTick((x) => x + 1); }
    catch (e) { setNote(e.message); }
  };
  return (
    <div className="bell">
      <button className="ghost" aria-expanded={open} aria-label={t("bell.label", { n: unread })} onClick={() => setOpen((o) => !o)}>
        <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path fill="currentColor" d="M12 22a2.5 2.5 0 0 0 2.45-2h-4.9A2.5 2.5 0 0 0 12 22Zm7-6V11a7 7 0 0 0-5.5-6.84V3a1.5 1.5 0 0 0-3 0v1.16A7 7 0 0 0 5 11v5l-2 2v1h18v-1Z"/></svg>
        {unread > 0 && <span className="badge num">{unread > 99 ? "99+" : unread}</span>}
      </button>
      {open && (
        <div className="bell-pop" role="dialog" aria-label={t("bell.title")}>
          <p className="bell-head"><strong>{t("bell.title")}</strong>{unread > 0 && <button className="link" onClick={seen}>{t("bell.seen")}</button>}</p>
          {note && <p className="msg err">{t(note)}</p>}
          {n.error ? <p className="msg err">{t(n.error)}</p> : items.length ? (
            <ul>{items.map((x, i) => <li key={`${x.at}-${i}`} className={`k-${x.kind}`}><span className="label">{t(`bell.k.${x.kind}`)}</span> {x.text}<small>{when(x.at)}</small></li>)}</ul>
          ) : <p className="msg">{n.loading ? t("loading") : t("bell.none")}</p>}
        </div>
      )}
    </div>
  );
}

function Health({ t }) {
  const h = useGet("/api/health");
  if (h.loading) return null;
  if (h.error) return <footer className="health"><span className="err">{t(h.error === "err.404" ? "health.na" : "app.down")}</span></footer>;
  const d = h.data;
  return (
    <footer className="health" aria-label={t("app.status")}>
      <span>{t("app.db")}: {t(d.db ? "app.on" : "app.off")}</span>
      {d.autopilot?.nextRun && <span>{t("health.next", { w: when(d.autopilot.nextRun) })}</span>}
      {d.autopilot?.lastRun && <span>{t("health.last", { w: when(d.autopilot.lastRun.at ?? d.autopilot.lastRun) })}</span>}
      {d.version && <span>v{d.version}</span>}
    </footer>
  );
}

export default function App() {
  const [page, setPage] = useState(fromHash);
  const [city, setCity] = useState("ahmedabad");
  const [date, setDate] = useState(tomorrow);
  const [eventIds, setEventIds] = useState([]);
  const [weatherMode, setWeatherMode] = useState("live");
  const [advisory, setAdvisory] = useState(null);
  const [selKey, setSelKey] = useState(null); // which city|date|events combo was auto-preselected
  const [autoRun, setAutoRun] = useState(false);
  const [lang, setLang] = useState(() => { const l = lsGet("metro.lang", "en"); return LANGS.some(([k]) => k === l) ? l : "en"; });
  const t = useMemo(() => translate(lang), [lang]);
  useEffect(() => { document.documentElement.lang = lang; lsSet("metro.lang", lang); }, [lang]);

  useEffect(() => {
    const on = () => setPage(fromHash());
    addEventListener("hashchange", on);
    return () => removeEventListener("hashchange", on);
  }, []);
  const go = useCallback((id) => { location.hash = `/${id}`; }, []);

  const meta = useGet("/api/meta");
  const live = useGet(`/api/live-events?date=${date}&city=${city}`);
  const events = useMemo(() => {
    const seen = new Map();
    (meta.data?.events ?? []).filter((e) => e.city === city).forEach((e) => seen.set(e.id, e));
    (Array.isArray(live.data) ? live.data : []).forEach((e) => seen.set(e.id, { ...e, live: true }));
    return [...seen.values()];
  }, [meta.data, live.data, city]);

  // Show the server's auto-generated advisory for tomorrow until the operator generates their own.
  useEffect(() => {
    if (advisory) return;
    api(`/api/auto?city=${city}`).then((a) => { if (a?.rows && a.date === date) setAdvisory(a); }).catch(() => {});
  }, [city, date]); // eslint-disable-line react-hooks/exhaustive-deps

  const openDay = (d, c) => { setCity(c); setDate(d); setSelKey(null); setAutoRun(true); go("advisory"); };

  const app = {
    city, setCity, date, setDate, eventIds, setEventIds, weatherMode, setWeatherMode,
    advisory, setAdvisory, selKey, setSelKey, autoRun, setAutoRun,
    lang, meta, events, eventsLoading: meta.loading || live.loading, liveError: live.error, go, openDay,
  };
  const Page = PAGES.find(([id]) => id === page)[1];
  const m = meta.data;
  const user = useAuth()?.user;
  const dot = (ok) => <span className={ok ? "st ok" : "st off"}>{t(ok ? "app.on" : "app.off")}</span>;

  return (
    <LangContext.Provider value={t}>
    <MotionConfig reducedMotion="user">
      <a className="skip" href="#main">{t("app.skip")}</a>
      <header className="top">
        <div className="brand">
          <span className="lines4" aria-hidden="true"><i /><i /><i /><i /></span>
          <span className="name">{t("app.name")}</span><small>{t("app.tag")}</small>
        </div>
        <div className="topright">
          <p className="status" aria-label={t("app.status")}>
            {meta.loading ? t("app.checking") : meta.error ? <span className="err">{t("app.down")}</span> : <>
              <span>{t("app.db")} {dot(m.db)}</span><span>{t("app.ai")} {dot(m.llm)}</span><span>{t("app.email")} {dot(m.keys?.email)}</span>
            </>}
          </p>
          {user && <Bell key={user.username} t={t} />}
          {user ? (
            <p className="who">
              <span><strong>{user.name}</strong> <em className={`role r-${user.role}`}>{t(`role.${user.role}`)}</em></span>
              <button className="ghost" onClick={() => setAuth(null)}>{t("login.out")}</button>
            </p>
          ) : <a className="ghost btn" href="#/login">{t("login.title")}</a>}
          <label className="langsel"><span className="sr">{t("app.lang")}</span>
            <select value={lang} onChange={(e) => setLang(e.target.value)}>
              {LANGS.map(([k, v]) => <option key={k} value={k} lang={k}>{v}</option>)}
            </select>
          </label>
        </div>
      </header>
      <div className="shell">
        <nav className="nav" aria-label={t("app.sections")}>
          {NAV.filter((id) => (id === "admin" ? user?.role === "admin" : user || id !== "my-station")).map((id) => (
            <a key={id} href={`#/${id}`} aria-current={page === id ? "page" : undefined}>{t(`nav.${id}`)}</a>
          ))}
        </nav>
        <main id="main"><ErrorBoundary key={page} t={t}><Page app={app} /></ErrorBoundary><Health t={t} /></main>
      </div>
    </MotionConfig>
    </LangContext.Provider>
  );
}
