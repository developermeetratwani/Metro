import { useEffect, useMemo, useState } from "react";
import { useT, tv } from "../i18n.js";
import { Context, Msg, PageHead, useGet, usePost, bodyOf, cityName, weatherName, fmtDate, fmtHour, dcls, fmtDelta, dword, bandName } from "../ui.jsx";

const hh = (h) => `${String(h).padStart(2, "0")}`;
const lineName = (t, l) => tv(t, "line.", l.id) ?? l.name;

function Heatmap({ app, st, load, show }) {
  const t = useT();
  const d = st.data;
  const p = d?.peak;
  const rows = (d?.stations ?? []).filter((s) => show(s.id));
  return (
    <section>
      <h2 className="sub">{t("heat.title")}</h2>
      <p className="lede">{t("heat.lede", { c: cityName(t, app.city), d: fmtDate(app.date), n: app.eventIds.length, w: weatherName(t, app.weatherMode).toLowerCase() })}</p>
      <p className="actions"><button className="primary" onClick={load} disabled={st.loading}>{st.loading ? t("loading") : t("heat.refresh")}</button></p>
      <Msg error={st.error} loading={st.loading && !d} />
      {d && !rows.length && <p className="msg">{t("heat.noData")}</p>}
      {rows.length > 0 && (
        <>
          {p && <p className="peak"><span className="label">{t("heat.peak")}</span> <strong>{p.station}</strong> <span className="num">{hh(p.hour)}:00</span>, {t("heat.index")} <span className="num">{p.value}</span></p>}
          <div className="scroll">
            <table className="heat">
              <thead><tr><th>{t("th.station")}</th>{d.hours.map((h) => <th key={h} className="r">{hh(h)}</th>)}</tr></thead>
              <tbody>
                {rows.map((s) => (
                  <tr key={s.id}>
                    <th scope="row">{s.name}</th>
                    {s.values.map((v, i) => {
                      const isPeak = p && p.station === s.name && p.hour === d.hours[i];
                      return (
                        // text flips to light ink once the cell is darker than the contrast crossover
                        <td key={i} className={`hc${v >= 58 ? " hi" : ""}${isPeak ? " pk" : ""}`} style={{ "--v": `${Math.round(v)}%` }} title={`${s.name} ${hh(d.hours[i])}:00 ${t("heat.index")} ${v}`}>
                          <span className="num">{Math.round(v)}</span>
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </section>
  );
}

function StationWeather({ wx, show }) {
  const t = useT();
  const { data, error, loading } = wx;
  const list = (data?.stations ?? []).filter((s) => show(s.id));
  return (
    <section>
      <h2 className="sub">{t("wxs.title")}</h2>
      <Msg error={error} loading={loading} empty={data && !list.length && t("wxs.none")} />
      {list.length > 0 && (
        <>
          <p className="meta-line">{t("wxs.source")} <strong>{data.source}</strong>, {t("wxs.updated")} <span className="num">{new Date(data.updated).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}</span></p>
          <div className="scroll">
            <table>
              <thead><tr><th>{t("th.station")}</th><th className="r">{t("th.temp")}</th><th className="r">{t("th.feels")}</th><th className="r">{t("th.rain")}</th><th className="r">{t("th.wind")}</th><th>{t("th.condition")}</th></tr></thead>
              <tbody>
                {list.map((s) => (
                  <tr key={s.id}>
                    <td>{s.name}</td>
                    <td className="r num">{s.temp_c}&deg;C</td>
                    <td className="r num">{s.feelslike_c}&deg;C</td>
                    <td className={`r num${s.chance_of_rain >= 60 ? " d-tight" : ""}`}>{s.chance_of_rain}%</td>
                    <td className="r num">{s.wind_kph} km/h</td>
                    <td>{s.condition}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </section>
  );
}

function Finder({ net, line, setLine, sel, setSel }) {
  const t = useT();
  const [q, setQ] = useState(sel ? net.byId[sel]?.name ?? "" : "");
  useEffect(() => { setQ(sel ? net.byId[sel]?.name ?? "" : ""); }, [sel]); // eslint-disable-line react-hooks/exhaustive-deps
  const pick = (v) => {
    setQ(v);
    const s = net.stations.find((x) => x.name.toLowerCase() === v.trim().toLowerCase());
    setSel(s ? s.id : null);
  };
  const miss = q.trim() && !sel && !net.stations.some((x) => x.name.toLowerCase().includes(q.trim().toLowerCase()));
  return (
    <section>
      <h2 className="sub">{t("sf.title")}</h2>
      <div className="controls">
        <label>{t("sf.search")}
          <input type="text" list="st-names" value={q} placeholder={t("sf.ph")} onChange={(e) => pick(e.target.value)} />
        </label>
        <datalist id="st-names">{net.stations.map((s) => <option key={s.id} value={s.name} />)}</datalist>
        {(sel || line) && <button className="link" onClick={() => { setSel(null); setLine(null); }}>{t("sf.clear")}</button>}
      </div>
      <p className="chips" role="group" aria-label={t("j.lines")}>
        <button aria-pressed={!line} onClick={() => setLine(null)}>{t("sf.all")}</button>
        {net.lines.map((l) => (
          <button key={l.id} aria-pressed={line === l.id} onClick={() => { setLine(line === l.id ? null : l.id); setSel(null); }} style={{ "--lc": l.color }}>
            <span className="sw" aria-hidden="true" />{lineName(t, l)}
          </button>
        ))}
      </p>
      {miss && <p className="msg">{t("sf.notFound", { q: q.trim() })}</p>}
    </section>
  );
}

function StationCard({ s, net, heat, wx, app }) {
  const t = useT();
  const h = heat.data?.stations?.find((x) => x.id === s.id);
  const w = wx.data?.stations?.find((x) => x.id === s.id);
  const adv = app.advisory && app.advisory.city === app.city ? app.advisory : null;
  const surges = adv?.stations?.find((x) => x.station === s.name)?.surges ?? [];
  return (
    <article className="card result" aria-label={s.name}>
      <h3 className="serif">{s.name}{s.interchange && <em className="tag ix-tag">{t("j.ix")}</em>}</h3>
      <p className="card-lines">
        {s.lines.map((id) => { const l = net.lines.find((x) => x.id === id); return l && <span key={id} style={{ "--lc": l.color }}><span className="sw" aria-hidden="true" /> {lineName(t, l)}</span>; })}
      </p>
      {h && (
        <>
          <p className="label">{t("heat.title")}</p>
          <ol className="bars" aria-label={t("heat.title")}>
            {h.values.map((v, i) => (
              <li key={i} title={`${hh(heat.data.hours[i])}:00 ${t("heat.index")} ${v}`}>
                <span className="bar" style={{ height: `${Math.max(2, v)}%` }} />
                <small className="num">{hh(heat.data.hours[i])}</small>
                <span className="sr">{v}</span>
              </li>
            ))}
          </ol>
        </>
      )}
      <p className="label">{t("sf.wxNow")}</p>
      {w ? <p className="num">{w.temp_c}&deg;C · {t("th.feels")} {w.feelslike_c}&deg;C · {t("th.rain")} {w.chance_of_rain}% · {w.condition}</p> : <p className="mute">{t("sf.noWx")}</p>}
      <p className="label">{t("surge.title")}</p>
      {!adv ? <p className="mute">{t("sf.noAdv")}</p> : surges.length ? (
        <ul>{surges.map((u, i) => <li key={i}><span className={`lvl l-${u.level}`}>{tv(t, "lvl.", u.level)}</span> <span className="num">{u.window}</span> {u.event}{u.note && <small>{u.note}</small>}</li>)}</ul>
      ) : <p className="mute">{t("sf.noSurge")}</p>}
      <p className="actions"><button className="primary" onClick={() => { location.hash = `/journey?from=${encodeURIComponent(s.id)}`; }}>{t("sf.trip")}</button></p>
    </article>
  );
}

const HOURS = Array.from({ length: 19 }, (_, i) => i + 6); // 06:00 .. 24:00

function Disruption({ app, net }) {
  const t = useT();
  const [closed, setClosed] = useState([]);
  const [fromHour, setFrom] = useState(17);
  const [toHour, setTo] = useState(20);
  const [st, run] = usePost("/api/disruption");
  useEffect(() => setClosed([]), [app.city]);
  const toggle = (id) => setClosed((c) => (c.includes(id) ? c.filter((x) => x !== id) : [...c, id]));
  const bad = !closed.length ? "dis.pick" : toHour <= fromHour ? "dis.hours" : null;
  const r = st.data;
  return (
    <section>
      <h2 className="sub">{t("dis.title")}</h2>
      <p className="lede">{t("dis.lede")}</p>
      {!net.lines.length ? <p className="msg">{t("dis.noStations")}</p> : (
        <form onSubmit={(e) => { e.preventDefault(); if (!bad) run({ date: app.date, city: app.city, closed, fromHour, toHour, weatherMode: app.weatherMode }); }}>
          <fieldset className="events">
            <legend className="label">{t("dis.closed")}</legend>
            {net.lines.map((l) => (
              <details key={l.id} className="dis-line" style={{ "--lc": l.color }}>
                <summary><span className="sw" aria-hidden="true" /> {lineName(t, l)} <small className="num">{l.stations.filter((id) => closed.includes(id)).length || ""}</small></summary>
                <ul className="checks">
                  {l.stations.map((id) => (
                    <li key={id}><label><input type="checkbox" checked={closed.includes(id)} onChange={() => toggle(id)} /><span>{net.byId[id]?.name ?? id}</span></label></li>
                  ))}
                </ul>
              </details>
            ))}
          </fieldset>
          <div className="controls">
            <label>{t("dis.from")}<select value={fromHour} onChange={(e) => setFrom(+e.target.value)}>{HOURS.slice(0, -1).map((h) => <option key={h} value={h}>{fmtHour(h)}</option>)}</select></label>
            <label>{t("dis.to")}<select value={toHour} onChange={(e) => setTo(+e.target.value)}>{HOURS.slice(1).map((h) => <option key={h} value={h}>{h === 24 ? "24:00" : fmtHour(h)}</option>)}</select></label>
            <button className="primary" disabled={!!bad || st.loading}>{st.loading ? t("dis.running") : t("dis.run")}</button>
          </div>
          {bad && <p className="msg">{t(bad)}</p>}
        </form>
      )}
      <Msg error={st.error} />
      {r && (
        <div className="result">
          <p className="banner"><span className="label">{t("dis.closedList")}</span> {r.closed.map((c) => c.name).join(", ")} · <span className="num">{fmtHour(fromHour)}–{toHour === 24 ? "24:00" : fmtHour(toHour)}</span></p>
          <h3 className="label">{t("dis.neigh")}</h3>
          {r.neighbours?.length ? (
            <ul className="legs">{r.neighbours.map((n) => <li key={n.id}><strong>{n.name}</strong><small className="num">{t("dis.extra")} +{n.extraLoad}</small></li>)}</ul>
          ) : <p className="msg">{t("dis.noNeigh")}</p>}
          <h3 className="label">{t("dis.reroutes")}</h3>
          {r.reroutes?.length ? (
            <ul className="legs">
              {r.reroutes.map((x, i) => (
                <li key={i}>
                  <span>{t("j.leg", { a: x.from, b: x.to })}</span>
                  {x.ok ? <>
                    {(x.legs ?? []).map((l, k) => <span key={k} style={{ "--lc": l.color }}><span className="sw" aria-hidden="true" /> {tv(t, "line.", l.line) ?? l.lineName}</span>)}
                    <small className="num">{x.minutes} {t("min")}</small>
                  </> : <strong className="d-tight">{t("dis.bus")}</strong>}
                </li>
              ))}
            </ul>
          ) : <p className="msg">{t("dis.noReroute")}</p>}
          {r.rows?.length > 0 && (
            <div className="scroll">
              <table className="bands">
                <caption className="label">{t("dis.bands")}</caption>
                <thead><tr><th>{t("th.band")}</th><th className="r">{t("th.headway")}</th><th>{t("th.change")}</th><th>{t("th.justification")}</th></tr></thead>
                <tbody>
                  {r.rows.map((x) => (
                    <tr key={x.band}>
                      <td><strong>{bandName(t, x.band)}</strong><small className="num">{x.time}</small></td>
                      <td className="r"><span className="big num">{x.headway}</span><small className="num">{t("adv.minBase", { b: x.base })}</small></td>
                      <td className={`d-${dcls(x.delta)}`}><span className="num">{fmtDelta(x.delta)}</span><small>{dword(t, x.delta)}</small></td>
                      <td>{x.justification}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {r.justification && <p className="answer">{r.justification}</p>}
        </div>
      )}
    </section>
  );
}

export default function Stations({ app }) {
  const t = useT();
  const all = useGet("/api/stations");
  const wx = useGet(`/api/stations/weather?city=${app.city}`);
  const [heat, run] = usePost("/api/heatmap");
  const load = () => run(bodyOf(app));
  useEffect(() => { load(); }, [app.city]); // eslint-disable-line react-hooks/exhaustive-deps
  const [line, setLine] = useState(null);
  const [sel, setSel] = useState(null);
  useEffect(() => { setSel(null); setLine(null); }, [app.city]);

  // Only this city's stations; lines keep their order but drop stations from the other city.
  const net = useMemo(() => {
    const d = all.data;
    if (!d?.stations || !d?.lines) return null;
    const stations = d.stations.filter((s) => s.city === app.city);
    const byId = Object.fromEntries(stations.map((s) => [s.id, s]));
    const lines = d.lines.map((l) => ({ ...l, stations: l.stations.filter((id) => byId[id]) })).filter((l) => l.stations.length);
    return { stations, byId, lines };
  }, [all.data, app.city]);

  const show = (id) => (sel ? id === sel : line ? !!net?.byId[id]?.lines.includes(line) : true);
  const s = sel && net?.byId[sel];

  return (
    <>
      <PageHead title={t("st.title")} lede={t("st.lede")} />
      <Context app={app} />
      <Msg error={all.error} loading={all.loading} />
      {net && <Finder net={net} line={line} setLine={setLine} sel={sel} setSel={setSel} />}
      {s && <StationCard s={s} net={net} heat={heat} wx={wx} app={app} />}
      <Heatmap app={app} st={heat} load={load} show={show} />
      <StationWeather wx={wx} show={show} />
      {net && <Disruption app={app} net={net} />}
    </>
  );
}
