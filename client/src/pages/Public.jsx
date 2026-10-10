import { useState } from "react";
import { Msg, CitySelect, useGet, bandName, fmtDate, today, tomorrow } from "../ui.jsx";
import { useT, tv } from "../i18n.js";

const LEVELS = ["quiet", "moderate", "busy", "very busy"];
const hh = (h) => `${String(h).padStart(2, "0")}:00`;

// Passenger view: big type, no jargon. Uses its own city/date so staff context isn't disturbed.
export default function Public({ app }) {
  const t = useT();
  const [city, setCity] = useState(app.city);
  const [date, setDate] = useState(today);
  const [sid, setSid] = useState("");
  const f = useGet(`/api/public/forecast?city=${city}&date=${date}`);
  const d = f.data;
  const stations = [...new Map((d?.stations ?? []).map((s) => [s.id, s])).values()].sort((a, b) => a.name.localeCompare(b.name));
  const s = stations.find((x) => x.id === sid) ?? stations[0];

  return (
    <div className="pub">
      <header className="pagehead">
        <h1>{t("pub.title")}</h1>
        <p className="lede">{t("pub.lede")}</p>
      </header>
      <div className="controls">
        <CitySelect value={city} onChange={(c) => { setCity(c); setSid(""); }} />
        <label>{t("date")}
          <select value={date} onChange={(e) => setDate(e.target.value)}>
            <option value={today()}>{t("pub.today")} · {fmtDate(today())}</option>
            <option value={tomorrow()}>{t("pub.tomorrow")} · {fmtDate(tomorrow())}</option>
          </select>
        </label>
        {stations.length > 0 && (
          <label>{t("th.station")}
            <select value={s?.id ?? ""} onChange={(e) => setSid(e.target.value)}>
              {stations.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
            </select>
          </label>
        )}
      </div>
      <Msg loading={f.loading} error={f.error && (f.error === "err.404" ? "pub.unavail" : f.error)}>
        {d && (
          <>
            {s && (
              <section className="pub-card">
                <h2>{s.name}</h2>
                {s.bestTime && <p className="pub-best"><span>{t("pub.best")}</span> <b className="num">{s.bestTime}</b></p>}
                <ol className="pub-hours" aria-label={t("pub.hours")}>
                  {(s.levels ?? []).map((x) => (
                    <li key={x.hour} className={`pl-${LEVELS.indexOf(x.level)}`}>
                      <span className="num">{hh(x.hour)}</span><b>{tv(t, "pub.l.", x.level)}</b>
                    </li>
                  ))}
                </ol>
                <p className="pub-legend">{LEVELS.map((l, i) => <span key={l} className={`pl-${i}`}>{tv(t, "pub.l.", l)}</span>)}</p>
              </section>
            )}
            {d.bands?.length > 0 && (
              <section className="pub-card">
                <h2>{t("pub.trains")}</h2>
                <ul className="pub-bands">
                  {d.bands.map((b) => (
                    <li key={b.band}>
                      <span>{bandName(t, b.band)}<small className="num">{b.time}</small></span>
                      <b className="num">{t("pub.every", { n: b.headway })}</b>
                      <small className="num">{t("pub.tph", { n: b.trainsPerHour ?? (b.headway > 0 ? Math.round(60 / b.headway) : "-") })}</small>
                    </li>
                  ))}
                </ul>
              </section>
            )}
            {!stations.length && !d.bands?.length && <p className="msg">{t("pub.empty")}</p>}
          </>
        )}
      </Msg>
    </div>
  );
}
