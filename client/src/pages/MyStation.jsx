import { useEffect, useState } from "react";
import { Msg, PageHead, api, useAuth, useGet, usePost, alertName, bandName, cityName, dcls, fmtDate, fmtDelta, dword, isControl, freq } from "../ui.jsx";
import { LineChart } from "../charts.jsx";
import { useT, tv } from "../i18n.js";

const when = (iso) => (iso ? new Date(iso).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : "");
const hh = (h) => `${String(h).padStart(2, "0")}:00`;

function Crowd({ feed, app }) {
  const t = useT();
  const s = feed.station;
  const [heat, run] = usePost("/api/heatmap");
  useEffect(() => { run({ date: feed.date, city: s.city ?? app.city, eventIds: [], weatherMode: app.weatherMode }); }, [s.id, feed.date]); // eslint-disable-line react-hooks/exhaustive-deps
  const h = heat.data?.stations?.find((x) => x.id === s.id);
  if (heat.error) return <Msg error={heat.error} />;
  if (!h) return heat.loading ? <Msg loading /> : null;
  return (
    <LineChart title={t("chart.crowdOne", { s: s.name })} desc={t("chart.crowdDesc")} cats={heat.data.hours.map(hh)}
      series={[{ name: s.name, values: h.values, cls: "s1" }]} yLabel={t("chart.crowdY")} xLabel={t("chart.hour")} max={100} />
  );
}

function Notice({ station, onSent }) {
  const t = useT();
  const [text, setText] = useState("");
  const [st, run] = usePost("/api/notices");
  return (
    <form className="panel tint-saffron notice-form" onSubmit={async (e) => { e.preventDefault(); if (text.trim() && await run({ station, text: text.trim() })) { setText(""); onSent(); } }}>
      <label className="label" htmlFor="notice-text">{t("my.sendTitle")}</label>
      <textarea id="notice-text" className="brief" rows={3} value={text} onChange={(e) => setText(e.target.value)} placeholder={t("my.sendPh")} />
      <p className="actions"><button className="primary" disabled={st.loading || !text.trim()}>{st.loading ? t("rep.sending") : t("my.send")}</button>{st.data && <span className="msg ok">{t("my.sent")}</span>}</p>
      <Msg error={st.error} />
    </form>
  );
}

export default function MyStation({ app }) {
  const t = useT();
  const a = useAuth();
  const user = a?.user;
  const control = isControl(a);
  const all = useGet(control ? "/api/stations" : null);
  const stations = [...(all.data?.stations ?? [])].sort((x, y) => x.name.localeCompare(y.name));
  const [pick, setPick] = useState(null);
  const sid = control ? pick ?? stations[0]?.id : null;
  const [tick, setTick] = useState(0);
  useEffect(() => { const id = setInterval(() => setTick((n) => n + 1), 60000); return () => clearInterval(id); }, []);
  const url = user && (!control || sid) ? `/api/station-feed?${sid ? `station=${encodeURIComponent(sid)}&` : ""}u=${user.username}&r=${tick}` : null;
  const feed = useGet(url);
  const [ack, setAck] = useState({ busy: false, error: null });

  if (!user) {
    return (
      <>
        <PageHead title={t("my.title")} lede={t("my.lede")} />
        <p className="banner watch">{t("my.needLogin")} <a href="#/login">{t("login.title")}</a></p>
      </>
    );
  }

  const f = feed.data;
  const doAck = async () => {
    setAck({ busy: true, error: null });
    try { await api("/api/station-feed/ack", { method: "POST", body: { date: f.date } }); setAck({ busy: false, error: null }); setTick((n) => n + 1); }
    catch (e) { setAck({ busy: false, error: e.message }); }
  };
  const acked = f?.acks?.some((x) => x.by === user.username || x.by === user.name);
  const hits = f?.rows?.filter((r) => r.affectsThisStation).length ?? 0;

  return (
    <>
      <PageHead title={t("my.title")} lede={t(control ? "my.ledeControl" : "my.lede")} />
      {control && (
        <div className="controls">
          <label>{t("th.station")}
            <select value={sid ?? ""} onChange={(e) => setPick(e.target.value)} disabled={!stations.length}>
              {stations.map((s) => <option key={s.id} value={s.id}>{s.name} ({cityName(t, s.city)})</option>)}
            </select>
          </label>
        </div>
      )}
      <Msg loading={feed.loading && !f} error={feed.error} />
      {f && (
        <article className="result">
          <header className="station-hero">
            <div>
              <h2>{f.station?.name}</h2>
              <p className="card-lines">
                {(f.station?.lines ?? []).map((l) => <span key={l} className={`line-chip lc-${l}`}>{tv(t, "line.", l)}</span>)}
                {f.station?.interchange && <em className="tag ix-tag">{t("j.ix")}</em>}
              </p>
              <small>{t("my.forDay", { d: fmtDate(f.date) })}{f.createdAt && ` · ${t("my.made", { w: when(f.createdAt) })}`} · {t("my.refresh")}</small>
            </div>
            <span className={`alert pill a-${f.alert}`}>{alertName(t, f.alert)}</span>
          </header>

          <div className="tiles">
            <div className={`tile ${f.alert === "high" ? "t-red" : f.alert === "watch" ? "t-saffron" : "t-teal"}`}><b>{alertName(t, f.alert)}</b><span>{t("my.tAlert")}</span></div>
            <div className="tile t-blue"><b className="num">{hits}</b><span>{t("my.tHits")}</span></div>
            <div className="tile t-saffron"><b className="num">{f.surges?.length ?? 0}</b><span>{t("my.tSurges")}</span></div>
            <div className="tile t-teal"><b className="num">{f.notices?.length ?? 0}</b><span>{t("my.tNotices")}</span></div>
          </div>

          <section>
            <h3 className="sub">{t("my.plan")}</h3>
            {f.rows?.length ? (
              <div className="scroll">
                <table className="bands">
                  <thead><tr><th>{t("th.band")}</th><th className="r">{t("th.headway")}</th><th>{t("th.change")}</th><th>{t("th.justification")}</th></tr></thead>
                  <tbody>
                    {f.rows.map((x) => (
                      <tr key={x.band} className={x.affectsThisStation ? "hit" : undefined}>
                        <td><strong>{bandName(t, x.band)}</strong><small className="num">{x.time}</small>{x.affectsThisStation && <em className="tag">{t("my.here")}</em>}</td>
                        <td className="r"><span className="big num">{x.headway}</span><small className="num">{freq(t, x.headway, x.trainsPerHour)}</small><small className="num">{t("adv.minBase", { b: x.base })}</small></td>
                        <td className={`d-${dcls(x.delta)}`}><span className="num">{fmtDelta(x.delta)}</span><small>{dword(t, x.delta)}</small></td>
                        <td>{x.action && <strong>{x.action}</strong>}{x.justification}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : <p className="msg">{t("my.noPlan")}</p>}
          </section>

          <Crowd feed={f} app={app} />

          <section>
            <h3 className="sub">{t("surge.title")}</h3>
            {f.surges?.length ? (
              <ul className="surges">
                {f.surges.map((u, i) => <li key={i}><span><span className={`lvl l-${u.level}`}>{tv(t, "lvl.", u.level)}</span> <span className="num">{u.window}</span></span><span>{u.event}{u.kind ? `, ${u.kind}` : ""}{u.note && <small>{u.note}</small>}</span></li>)}
              </ul>
            ) : <p className="msg">{t("sf.noSurge")}</p>}
          </section>

          <section>
            <h3 className="sub">{t("my.decisions")}</h3>
            {f.decisions?.length ? (
              <ul className="feed-list">
                {f.decisions.map((d, i) => (
                  <li key={i} className={d.final === d.recommended ? "ok" : "chg"}>
                    <strong>{bandName(t, d.band)}: {d.final === d.recommended ? t("my.approvedAt", { n: d.final }) : t("my.overAt", { n: d.final, r: d.recommended })}</strong>
                    {d.reason && <span>{t("th.reason")}: {d.reason}</span>}
                    <small>{d.operator} · {when(d.at)}</small>
                  </li>
                ))}
              </ul>
            ) : <p className="msg">{t("my.noDec")}</p>}
          </section>

          <section>
            <h3 className="sub">{t("my.notices")}</h3>
            {f.notices?.length ? (
              <ul className="feed-list">{f.notices.map((n, i) => <li key={i} className="note-item"><span>{n.text}</span><small>{n.from} · {when(n.at)}</small></li>)}</ul>
            ) : <p className="msg">{t("my.noNotices")}</p>}
            {control && sid && <Notice station={sid} onSent={() => setTick((n) => n + 1)} />}
          </section>

          <section className="panel tint-teal">
            <h3 className="label">{t("my.ackTitle")}</h3>
            {!control && (
              <p className="actions">
                <button className="primary" onClick={doAck} disabled={ack.busy || acked}>{acked ? t("my.acked") : ack.busy ? t("saving") : t("my.ack")}</button>
              </p>
            )}
            <Msg error={ack.error} />
            {f.acks?.length ? <ul className="feed-list">{f.acks.map((x, i) => <li key={i}><span>{x.by}</span><small>{when(x.at)}</small></li>)}</ul> : <p className="msg">{t("my.noAcks")}</p>}
          </section>
        </article>
      )}
    </>
  );
}
