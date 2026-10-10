import { Fragment, useEffect, useState } from "react";
import { motion } from "framer-motion";
import { Context, Cost, Msg, PageHead, api, useGet, usePost, bodyOf, cityName, weatherName, fmtDate, fmtHour, dcls, fmtDelta, dword, alertName, bandName, useAuth, isControl, freq } from "../ui.jsx";
import { BarChart, CostChart } from "../charts.jsx";
import { useT, tv } from "../i18n.js";

const row = (i) => ({ initial: { opacity: 0, y: 6 }, animate: { opacity: 1, y: 0 }, transition: { delay: i * 0.04, duration: 0.25 } });
const holidayName = (h) => (typeof h === "string" ? h : h?.name);
const hm = (iso) => (iso ? new Date(iso).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" }) : "");

function Events({ app }) {
  const t = useT();
  const { events, eventIds, setEventIds, eventsLoading, liveError } = app;
  const toggle = (id) => setEventIds(eventIds.includes(id) ? eventIds.filter((x) => x !== id) : [...eventIds, id]);
  return (
    <fieldset className="events">
      <legend className="label">{t("adv.events")}</legend>
      <Msg loading={eventsLoading && !events.length} empty={!events.length && t("adv.noEvents")}>
        <ul className="checks">
          {events.map((e) => (
            <li key={e.id}>
              <label>
                <input type="checkbox" checked={eventIds.includes(e.id)} onChange={() => toggle(e.id)} />
                <span>
                  {e.name}
                  {e.live && <em className="tag">{t("live")}</em>}
                  <small>{[e.date && fmtDate(e.date), e.venue, e.startHour != null && `${fmtHour(e.startHour)}–${fmtHour(e.endHour)}`, e.attendance && t("adv.expected", { n: e.attendance.toLocaleString("en-IN") })].filter(Boolean).join(" · ")}</small>
                </span>
              </label>
            </li>
          ))}
        </ul>
      </Msg>
      {liveError && <p className="msg">{t("adv.liveErr")} {t(liveError)}</p>}
    </fieldset>
  );
}

// Shown only over the auto-generated advisory: once the operator regenerates, the banner has done its job.
function Drift({ app, shown, onRegen, busy }) {
  const t = useT();
  const { data, error } = useGet(`/api/drift?city=${app.city}`);
  if (error) return <p className="msg noprint">{t("drift.unavail")} {t(error)}</p>;
  if (!data?.changed || (data.planned?.date && data.planned.date !== app.date) || (shown && !shown.auto)) return null;
  const p = data.planned ?? {};
  return (
    <div className="banner watch noprint" role="status">
      <p><strong>{t("drift.title")}</strong>{p.createdAt && <span className="mute"> ({t("drift.planned", { t: hm(p.createdAt) })})</span>}</p>
      {p.alert && data.now?.alert && p.alert !== data.now.alert && <p>{t("drift.alert", { a: alertName(t, p.alert), b: alertName(t, data.now.alert) })}</p>}
      {data.bandsChanged?.length > 0 && (
        <ul className="drift-bands">
          {data.bandsChanged.map((b) => <li key={b.band}>{bandName(t, b.band)} <span className="num">{b.planned} → {b.now} {t("min")}</span></li>)}
        </ul>
      )}
      <button onClick={onRegen} disabled={busy}>{busy ? t("adv.generating") : t("drift.regen")}</button>
    </div>
  );
}

function Ask({ advisory }) {
  const t = useT();
  const [q, setQ] = useState("");
  const [st, run] = usePost("/api/ask");
  return (
    <section className="ask noprint">
      <h2 className="label">{t("ask.title")}</h2>
      <form onSubmit={(e) => { e.preventDefault(); q.trim() && run({ question: q.trim(), advisory }); }}>
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("ask.ph")} aria-label={t("ask.q")} />
        <button disabled={st.loading || !q.trim()}>{st.loading ? t("ask.going") : t("ask.go")}</button>
      </form>
      <Msg error={st.error} />
      {st.data?.answer && <p className="answer">{st.data.answer}</p>}
    </section>
  );
}

function Override({ x, onSave, onCancel, busy }) {
  const t = useT();
  const [final, setFinal] = useState(String(x.headway));
  const [reason, setReason] = useState("");
  const needReason = +final !== x.headway && !reason.trim();
  return (
    <form className="override" onSubmit={(e) => { e.preventDefault(); if (!needReason) onSave(+final, reason.trim()); }}>
      <label>{t("dec.final")}<input type="number" min="1" step="1" value={final} onChange={(e) => setFinal(e.target.value)} required /></label>
      <label className="grow">{t("dec.reason")}<input type="text" value={reason} onChange={(e) => setReason(e.target.value)} /></label>
      <button className="primary" disabled={busy || needReason || !final}>{busy ? t("saving") : t("dec.save")}</button>
      <button type="button" className="link" onClick={onCancel}>{t("cancel")}</button>
      {needReason && <small>{t("dec.reasonReq")}</small>}
    </form>
  );
}

// One plain-language line: the busiest time of day and where.
function Summary({ r }) {
  const t = useT();
  const top = [...(r.rows ?? [])].sort((a, b) => a.delta - b.delta)[0];
  const st = top?.stations?.[0] ?? r.stations?.[0]?.station;
  return (
    <p className="summary">{top && top.delta < 0
      ? t(st ? "adv.summary" : "adv.summaryNo", { alert: alertName(t, r.alert), band: bandName(t, top.band).toLowerCase(), st, n: top.headway })
      : t("adv.summaryNo", { alert: alertName(t, r.alert) })}</p>
  );
}

function Result({ r, app }) {
  const t = useT();
  const [open, setOpen] = useState({});
  const [edit, setEdit] = useState(null);
  const auth = useAuth();
  const control = isControl(auth);
  const [rev, setRev] = useState(0);
  const [dec, setDec] = useState({ busy: false, error: null });
  const log = useGet(r.date && r.city ? `/api/decisions?date=${r.date}&city=${r.city}&rev=${rev}` : null);
  const list = Array.isArray(log.data) ? log.data : [];
  const latest = (band) => list.find((d) => d.band === band); // list is newest first
  const w = r.weather ?? {};

  const decide = async (x, final, reason = "") => {
    setDec({ busy: true, error: null });
    try {
      await api("/api/decisions", { method: "POST", body: { date: r.date, city: r.city, band: x.band, recommended: x.headway, final, reason } });
      setDec({ busy: false, error: null }); setEdit(null); setRev((n) => n + 1);
    } catch (e) { setDec({ busy: false, error: e.message }); }
  };

  return (
    <article className="result">
      <div className="printhead">
        <p className="label">{t("adv.printhead")}</p>
        <h2 className="serif">{cityName(t, r.city)}, {fmtDate(r.date)}</h2>
      </div>
      <Summary r={r} />
      <p className="wxline">
        <span className={`alert a-${r.alert}`}>{alertName(t, r.alert)}</span>
        {r.auto && <span className="label">{t("adv.auto", { t: hm(r.createdAt) })}</span>}
        <span>{r.dayType}{r.holiday ? `, ${holidayName(r.holiday)}` : ""}</span>
        <span className="num">{t("adv.wx", { mm: w.precipSum ?? "-", p: w.precipProb ?? "-", c: w.tempMax ?? "-" })}</span>
        <span>{r.weatherSeverity}</span>
        <span className="mute">{t("adv.wxSource", { s: w.source ?? weatherName(t, app.weatherMode) })}</span>
      </p>
      {r.events?.length > 0 && <p className="evline"><span className="label">{t("th.events")}</span> {r.events.join("; ")}</p>}

      <p className="msg noprint">{control ? t("dec.as", { n: auth.user.name }) : <>{t("dec.needLogin")} <a href="#/login">{t("login.title")}</a></>}</p>

      <div className="scroll">
        <table className="bands">
          <thead><tr><th>{t("th.band")}</th><th className="r">{t("th.headway")}</th><th>{t("th.change")}</th><th>{t("th.justification")}</th><th className="noprint">{t("th.decision")}</th></tr></thead>
          <tbody>
            {r.rows.map((x, i) => {
              const d = latest(x.band);
              return (
                <Fragment key={x.band}>
                  <motion.tr {...row(i)}>
                    <td><strong>{bandName(t, x.band)}</strong><small className="num">{x.time}</small></td>
                    <td className="r"><span className="big num">{x.headway}</span><small className="num">{freq(t, x.headway, x.trainsPerHour)}</small><small className="num">{t("adv.minBase", { b: x.base })}</small></td>
                    <td className={`d-${dcls(x.delta)}`}><span className="num">{fmtDelta(x.delta)}</span><small>{dword(t, x.delta)}</small></td>
                    <td>
                      {x.justification}
                      {x.stations?.length > 0 && <small>{t("adv.stations", { s: x.stations.join(", ") })}</small>}
                      {x.trains != null && <small className="num">{t("adv.trains", { n: x.trains })}</small>}
                      {x.reasons?.length > 0 && <button className="link noprint why-btn" aria-expanded={!!open[x.band]} onClick={() => setOpen({ ...open, [x.band]: !open[x.band] })}>{open[x.band] ? t("adv.hideWhy") : t("adv.why")}</button>}
                    </td>
                    <td className="noprint dec">
                      {d && <small className={d.final === d.recommended ? "a-ok" : "d-tight"}>{d.final === d.recommended ? t("dec.approved", { op: d.operator }) : t("dec.overridden", { n: d.final, op: d.operator })}</small>}
                      {control ? (
                        <span className="dec-btns">
                          <button onClick={() => decide(x, x.headway)} disabled={dec.busy}>{t("dec.approve")}</button>
                          <button className="link" aria-expanded={edit === x.band} onClick={() => setEdit(edit === x.band ? null : x.band)}>{t("dec.override")}</button>
                        </span>
                      ) : <small><a href="#/login">{t("dec.needLogin")}</a></small>}
                    </td>
                  </motion.tr>
                  {open[x.band] && (
                    <tr className="why"><td colSpan={5}>
                      <ul>{x.reasons.map((s, j) => <li key={j}><span className="label">{s.signal}</span> {s.text} <span className={`num d-${dcls(s.delta)}`}>{fmtDelta(s.delta)}</span></li>)}</ul>
                    </td></tr>
                  )}
                  {edit === x.band && (
                    <tr className="why noprint"><td colSpan={5}>
                      <Override x={x} busy={dec.busy} onCancel={() => setEdit(null)} onSave={(f, reason) => decide(x, f, reason)} />
                    </td></tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
      <Msg error={dec.error} />

      <div className="chart-grid noprint">
        <BarChart title={t("chart.hwTitle")} desc={t("chart.hwDesc")} cats={r.rows.map((x) => bandName(t, x.band))} unit={` ${t("min")}`}
          yLabel={t("chart.minutes")} xLabel={t("th.band")}
          series={[{ name: t("chart.usual"), values: r.rows.map((x) => x.base), cls: "s-base" }, { name: t("chart.rec"), values: r.rows.map((x) => x.headway), cls: "s1" }]} />
        {r.cost?.vsBaseline && <CostChart c={r.cost} />}
      </div>

      {r.fleet && (
        <p className="fleet"><span className="label">{t("fleet.label")}</span>
          <span><b className="num">{r.fleet.trainsPeak}</b> {t("fleet.peak")}</span>
          <span><b className="num">{r.fleet.trainsBase}</b> {t("fleet.base")}</span>
          <span><b className="num">{r.fleet.extraTrains}</b> {t("fleet.extra")}</span>
          <span><b className="num">{r.fleet.crewPeak}</b> {t("fleet.crew")}</span>
        </p>
      )}
      {r.cost && <Cost c={r.cost} />}

      <section>
        <h2 className="label">{t("surge.title")}</h2>
        {r.stations?.length ? (
          <ul className="surges">
            {r.stations.map((s) => (
              <li key={s.station}>
                <strong>{s.station}</strong>
                <ul>{s.surges.map((u, i) => <li key={i}><span className={`lvl l-${u.level}`}>{tv(t, "lvl.", u.level)}</span> <span className="num">{u.window}</span> {u.event}, {u.kind}{u.crowd ? `, ${t("surge.crowd", { n: typeof u.crowd === "number" ? u.crowd.toLocaleString("en-IN") : u.crowd })}` : ""}{u.note && <small>{u.note}</small>}</li>)}</ul>
              </li>
            ))}
          </ul>
        ) : <p className="msg">{t("surge.none")}</p>}
      </section>

      <section className="noprint">
        <h2 className="label">{t("dec.log")}</h2>
        <Msg loading={log.loading && !log.data} error={log.error} empty={log.data && !list.length && t("dec.empty")}>
          {list.length > 0 && (
            <div className="scroll">
              <table className="audit">
                <thead><tr><th>{t("th.when")}</th><th>{t("th.band")}</th><th className="r">{t("th.recommended")}</th><th className="r">{t("th.final")}</th><th>{t("th.operator")}</th><th>{t("th.reason")}</th></tr></thead>
                <tbody>
                  {list.map((d, i) => (
                    <tr key={`${d.at}-${i}`}>
                      <td className="num">{hm(d.at)}</td>
                      <td>{bandName(t, d.band)}</td>
                      <td className="r num">{d.recommended}</td>
                      <td className={`r num${d.final !== d.recommended ? " d-tight" : ""}`}>{d.final}</td>
                      <td>{d.operator}</td>
                      <td>{d.reason || <span className="mute">-</span>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Msg>
      </section>
    </article>
  );
}

export default function Advisory({ app }) {
  const t = useT();
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
      <PageHead title={t("adv.title")} lede={t("adv.lede")} />
      <section className="noprint">
        <Context app={app} />
        <Events app={app} />
        <p className="actions">
          <button className="primary" onClick={generate} disabled={st.loading}>{st.loading ? t("adv.generating") : t("adv.generate")}</button>
          {shown && <button className="link" onClick={() => window.print()}>{t("adv.print")}</button>}
        </p>
      </section>
      <Drift app={app} shown={shown} onRegen={generate} busy={st.loading} />
      <Msg error={st.error} />
      {!shown && !st.loading && !st.error && <p className="msg">{t("adv.none")}</p>}
      {shown && <Result key={`${shown.city}|${shown.date}|${shown.createdAt}`} r={shown} app={app} />}
      {shown && <Ask advisory={shown} />}
    </>
  );
}
