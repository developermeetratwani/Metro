import { Fragment, useEffect, useState } from "react";
import { motion } from "framer-motion";
import { Context, Msg, PageHead, usePost, bodyOf, cityName, weatherName, fmtDate, fmtHour, dcls, fmtDelta, dword, ALERT } from "../ui.jsx";

const row = (i) => ({ initial: { opacity: 0, y: 6 }, animate: { opacity: 1, y: 0 }, transition: { delay: i * 0.04, duration: 0.25 } });
const holidayName = (h) => (typeof h === "string" ? h : h?.name);

function Events({ app }) {
  const { events, eventIds, setEventIds, eventsLoading, liveError } = app;
  const toggle = (id) => setEventIds(eventIds.includes(id) ? eventIds.filter((x) => x !== id) : [...eventIds, id]);
  return (
    <fieldset className="events">
      <legend className="label">Events affecting service</legend>
      <Msg loading={eventsLoading && !events.length} empty={!events.length && "No known events for this city."}>
        <ul className="checks">
          {events.map((e) => (
            <li key={e.id}>
              <label>
                <input type="checkbox" checked={eventIds.includes(e.id)} onChange={() => toggle(e.id)} />
                <span>
                  {e.name}
                  {e.live && <em className="tag">live</em>}
                  <small>{[e.date && fmtDate(e.date), e.venue, e.startHour != null && `${fmtHour(e.startHour)}–${fmtHour(e.endHour)}`, e.attendance && `${e.attendance.toLocaleString("en-IN")} expected`].filter(Boolean).join(" · ")}</small>
                </span>
              </label>
            </li>
          ))}
        </ul>
      </Msg>
      {liveError && <p className="msg">Live events unavailable: {liveError}</p>}
    </fieldset>
  );
}

function Ask({ advisory }) {
  const [q, setQ] = useState("");
  const [st, run] = usePost("/api/ask");
  return (
    <section className="ask noprint">
      <h2 className="label">Ask about this advisory</h2>
      <form onSubmit={(e) => { e.preventDefault(); q.trim() && run({ question: q.trim(), advisory }); }}>
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="e.g. Why is the evening peak tightened?" aria-label="Question" />
        <button disabled={st.loading || !q.trim()}>{st.loading ? "Asking..." : "Ask"}</button>
      </form>
      <Msg error={st.error} />
      {st.data?.answer && <p className="answer">{st.data.answer}</p>}
    </section>
  );
}

function Result({ r, app }) {
  const [open, setOpen] = useState({});
  const w = r.weather ?? {};
  return (
    <article className="result">
      <div className="printhead">
        <p className="label">Headway advisory</p>
        <h2 className="serif">{cityName(r.city)}, {fmtDate(r.date)}</h2>
      </div>
      <p className="wxline">
        <span className={`alert a-${r.alert}`}>{ALERT[r.alert] ?? r.alert}</span>
        {r.auto && <span className="label">Auto-generated {new Date(r.createdAt).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })} · all known events</span>}
        <span>{r.dayType}{r.holiday ? `, ${holidayName(r.holiday)}` : ""}</span>
        <span className="num">{w.precipSum ?? "-"} mm rain, {w.precipProb ?? "-"}% chance, max {w.tempMax ?? "-"}&deg;C</span>
        <span>{r.weatherSeverity}</span>
        <span className="mute">weather source: {w.source ?? weatherName(app.weatherMode)}</span>
      </p>
      {r.events?.length > 0 && <p className="evline"><span className="label">Events</span> {r.events.join("; ")}</p>}

      <div className="scroll">
        <table className="bands">
          <thead><tr><th>Band</th><th className="r">Headway</th><th>Change</th><th>Justification</th><th className="noprint"><span className="sr">Why</span></th></tr></thead>
          <tbody>
            {r.rows.map((x, i) => (
              <Fragment key={x.band}>
                <motion.tr {...row(i)}>
                  <td><strong>{x.band}</strong><small className="num">{x.time}</small></td>
                  <td className="r"><span className="big num">{x.headway}</span><small className="num">min, base {x.base}</small></td>
                  <td className={`d-${dcls(x.delta)}`}><span className="num">{fmtDelta(x.delta)}</span><small>{dword(x.delta)}</small></td>
                  <td>{x.justification}{x.stations?.length > 0 && <small>Stations: {x.stations.join(", ")}</small>}{x.trains != null && <small className="num">{x.trains} trains</small>}</td>
                  <td className="noprint">
                    {x.reasons?.length > 0 && <button className="link" aria-expanded={!!open[x.band]} onClick={() => setOpen({ ...open, [x.band]: !open[x.band] })}>{open[x.band] ? "Hide why" : "Why"}</button>}
                  </td>
                </motion.tr>
                {open[x.band] && (
                  <tr className="why"><td colSpan={5}>
                    <ul>{x.reasons.map((s, j) => <li key={j}><span className="label">{s.signal}</span> {s.text} <span className={`num d-${dcls(s.delta)}`}>{fmtDelta(s.delta)}</span></li>)}</ul>
                  </td></tr>
                )}
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>

      {r.fleet && (
        <p className="fleet"><span className="label">Fleet</span>
          <span><b className="num">{r.fleet.trainsPeak}</b> trains at peak</span>
          <span><b className="num">{r.fleet.trainsBase}</b> baseline</span>
          <span><b className="num">{r.fleet.extraTrains}</b> extra</span>
          <span><b className="num">{r.fleet.crewPeak}</b> crew at peak</span>
        </p>
      )}

      <section>
        <h2 className="label">Station surges</h2>
        {r.stations?.length ? (
          <ul className="surges">
            {r.stations.map((s) => (
              <li key={s.station}>
                <strong>{s.station}</strong>
                <ul>{s.surges.map((u, i) => <li key={i}><span className={`lvl l-${u.level}`}>{u.level}</span> <span className="num">{u.window}</span> {u.event}, {u.kind}{u.crowd ? `, crowd ${typeof u.crowd === "number" ? u.crowd.toLocaleString("en-IN") : u.crowd}` : ""}{u.note && <small>{u.note}</small>}</li>)}</ul>
              </li>
            ))}
          </ul>
        ) : <p className="msg">No station-level surges expected.</p>}
      </section>
    </article>
  );
}

export default function Advisory({ app }) {
  const { events, eventsLoading, setEventIds, selKey, setSelKey, advisory, setAdvisory, autoRun, setAutoRun } = app;
  const [st, run] = usePost("/api/recommend");
  const key = `${app.city}|${app.date}|${events.map((e) => e.id).join(",")}`;

  // Preselect events on this date plus live ones, once per city/date/event-list combination.
  useEffect(() => {
    if (eventsLoading || selKey === key) return;
    setEventIds(events.filter((e) => e.live || e.date === app.date).map((e) => e.id));
    setSelKey(key);
  }, [key, eventsLoading]); // eslint-disable-line react-hooks/exhaustive-deps

  const generate = async () => { const r = await run(bodyOf(app)); if (r) setAdvisory(r); };

  // Planner "open day" requests an immediate run once the preselection has settled.
  useEffect(() => {
    if (autoRun && selKey === key && !eventsLoading) { setAutoRun(false); generate(); }
  }, [autoRun, selKey, key, eventsLoading]); // eslint-disable-line react-hooks/exhaustive-deps

  const shown = st.data ?? advisory;
  return (
    <>
      <PageHead title="Tomorrow's headways" lede="Pick the day, tick the events that apply, and generate a recommended frequency for each time band." />
      <section className="noprint">
        <Context app={app} />
        <Events app={app} />
        <p className="actions">
          <button className="primary" onClick={generate} disabled={st.loading}>{st.loading ? "Generating..." : "Generate advisory"}</button>
          {shown && <button className="link" onClick={() => window.print()}>Print brief</button>}
        </p>
      </section>
      <Msg error={st.error} />
      {!shown && !st.loading && !st.error && <p className="msg">No advisory yet. Generate one to see recommended headways.</p>}
      {shown && <Result r={shown} app={app} />}
      {shown && <Ask advisory={shown} />}
    </>
  );
}
