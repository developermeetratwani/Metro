import { useCallback, useEffect, useMemo, useState } from "react";
import { MotionConfig } from "framer-motion";
import { useGet, tomorrow, lsGet, lsSet, api, useAuth, setAuth } from "./ui.jsx";
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
];
const fromHash = () => { const k = location.hash.replace(/^#\/?/, "").split("?")[0]; return PAGES.some(([id]) => id === k) ? k : "advisory"; };
const NAV = ["my-station", "advisory", "planner", "stations", "journey", "rules", "report", "admin"];

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
        <main id="main"><Page app={app} /></main>
      </div>
    </MotionConfig>
    </LangContext.Provider>
  );
}
