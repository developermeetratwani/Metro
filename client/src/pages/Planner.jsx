import { useState } from "react";
import { motion } from "framer-motion";
import { Msg, PageHead, usePost, tomorrow, cityName, fmtDate, dcls, CITIES, ALERT } from "../ui.jsx";

const BANDS = ["Morning", "Midday", "Evening", "Late"];
const holidayName = (h) => (typeof h === "string" ? h : h?.name);

export default function Planner({ app }) {
  const [from, setFrom] = useState(tomorrow);
  const [days, setDays] = useState(7);
  const [st, run] = usePost("/api/plan");
  const plan = st.data?.plan ?? [];
  const flagged = plan.filter((d) => d.alert && d.alert !== "ok");
  const planCity = st.data?.city ?? app.city;

  return (
    <>
      <PageHead title="Look-ahead planner" lede="One row per day. Cells show the recommended headway in minutes: red is tighter than baseline, green is wider." />
      <form className="controls" onSubmit={(e) => { e.preventDefault(); run({ from, days, city: app.city }); }}>
        <label>City
          <select value={app.city} onChange={(e) => app.setCity(e.target.value)}>
            {CITIES.map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </label>
        <label>From<input type="date" value={from} onChange={(e) => e.target.value && setFrom(e.target.value)} /></label>
        <label>Days
          <select value={days} onChange={(e) => setDays(+e.target.value)}>{[3, 7, 14].map((n) => <option key={n}>{n}</option>)}</select>
        </label>
        <button className="primary" disabled={st.loading}>{st.loading ? "Planning..." : "Build plan"}</button>
      </form>
      <Msg error={st.error} loading={st.loading} />
      {!st.data && !st.loading && !st.error && <p className="msg">Choose a start date and span, then build the plan.</p>}
      {st.data && !plan.length && <p className="msg">The server returned no days.</p>}
      {plan.length > 0 && (
        <>
          <p className={flagged.length ? "banner" : "msg"} role="status">
            {flagged.length
              ? <><strong>{flagged.length} day{flagged.length > 1 ? "s" : ""} flagged:</strong> {flagged.map((d, i) => <span key={d.date}>{i > 0 && ", "}<button className="link" onClick={() => app.openDay(d.date, planCity)}>{fmtDate(d.date)}</button> ({ALERT[d.alert] ?? d.alert})</span>)}</>
              : `No flagged days in this ${plan.length}-day window for ${cityName(planCity)}.`}
          </p>
          <div className="scroll">
            <table className="plan">
              <thead><tr><th>Day</th><th>Weather</th>{BANDS.map((b) => <th key={b} className="r">{b}</th>)}<th>Events</th></tr></thead>
              <tbody>
                {plan.map((d, i) => (
                  <motion.tr key={d.date} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.03, duration: 0.25 }}>
                    <td>
                      <button className="link day" onClick={() => app.openDay(d.date, planCity)}>
                        {d.alert && d.alert !== "ok" && <span className={`mark a-${d.alert}`} title={ALERT[d.alert]} role="img" aria-label={ALERT[d.alert]} />}
                        {fmtDate(d.date)}
                      </button>
                      <small>{d.dayType}{d.holiday ? `, ${holidayName(d.holiday)}` : ""}</small>
                    </td>
                    <td className="num wx">{d.weather ? `${d.weather.precipSum ?? "-"} mm, ${d.weather.tempMax ?? "-"}°C` : "-"}</td>
                    {BANDS.map((b, k) => {
                      const x = d.rows?.[k];
                      return x
                        ? <td key={b} className={`r cell c-${dcls(x.delta)} m${Math.min(3, Math.abs(x.delta))}`} title={`base ${x.base} min`}><span className="num">{x.headway}</span></td>
                        : <td key={b} className="r">-</td>;
                    })}
                    <td className="ev">{d.events?.length ? d.events.map((e) => <span key={e.name}>{e.name}{e.live && <em className="tag">live</em>}</span>) : <span className="mute">none</span>}</td>
                  </motion.tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </>
  );
}
