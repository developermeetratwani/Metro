import { useCallback, useEffect, useMemo, useState } from "react";
import { MotionConfig } from "framer-motion";
import { useGet, today, tomorrow } from "./ui.jsx";
import Advisory from "./pages/Advisory.jsx";
import Planner from "./pages/Planner.jsx";
import Stations from "./pages/Stations.jsx";
import Journey from "./pages/Journey.jsx";
import Rules from "./pages/Rules.jsx";
import Report from "./pages/Report.jsx";

const PAGES = [
  ["advisory", "Advisory", Advisory],
  ["planner", "Planner", Planner],
  ["stations", "Stations", Stations],
  ["journey", "Journey", Journey],
  ["rules", "Rules", Rules],
  ["report", "Report", Report],
];
const fromHash = () => { const k = location.hash.replace(/^#\/?/, ""); return PAGES.some(([id]) => id === k) ? k : "advisory"; };

export default function App() {
  const [page, setPage] = useState(fromHash);
  const [city, setCity] = useState("ahmedabad");
  const [date, setDate] = useState(tomorrow);
  const [eventIds, setEventIds] = useState([]);
  const [weatherMode, setWeatherMode] = useState("live");
  const [advisory, setAdvisory] = useState(null);
  const [selKey, setSelKey] = useState(null); // which city|date|events combo was auto-preselected
  const [autoRun, setAutoRun] = useState(false);

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
    fetch(`/api/auto?city=${city}`).then((r) => r.json()).then((a) => { if (a?.rows && a.date === date) setAdvisory(a); }).catch(() => {});
  }, [city, date]); // eslint-disable-line react-hooks/exhaustive-deps

  const openDay = (d, c) => { setCity(c); setDate(d); setSelKey(null); setAutoRun(true); go("advisory"); };

  const app = {
    city, setCity, date, setDate, eventIds, setEventIds, weatherMode, setWeatherMode,
    advisory, setAdvisory, selKey, setSelKey, autoRun, setAutoRun,
    meta, events, eventsLoading: meta.loading || live.loading, liveError: live.error, go, openDay,
  };
  const Page = PAGES.find(([id]) => id === page)[2];
  const m = meta.data;
  const dot = (ok) => <span className={ok ? "st ok" : "st off"}>{ok ? "on" : "off"}</span>;

  return (
    <MotionConfig reducedMotion="user">
      <a className="skip" href="#main">Skip to content</a>
      <header className="top">
        <div className="brand"><span>Headway Advisor</span><small>Gujarat Metro control room</small></div>
        <p className="status" aria-label="System status">
          {meta.loading ? "Checking server..." : meta.error ? <span className="err">Server unreachable</span> : <>
            <span>Database {dot(m.db)}</span><span>AI {dot(m.llm)}</span><span>Email {dot(m.keys?.email)}</span>
          </>}
        </p>
      </header>
      <div className="shell">
        <nav className="nav" aria-label="Sections">
          {PAGES.map(([id, label]) => (
            <a key={id} href={`#/${id}`} aria-current={page === id ? "page" : undefined}>{label}</a>
          ))}
        </nav>
        <main id="main"><Page app={app} /></main>
      </div>
    </MotionConfig>
  );
}
