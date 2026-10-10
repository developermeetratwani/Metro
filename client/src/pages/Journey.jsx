import { useState } from "react";
import { Msg, PageHead, useGet, api, uniqLines } from "../ui.jsx";
import { useT, tv } from "../i18n.js";

function StationSelect({ label, value, onChange, data }) {
  const t = useT();
  return (
    <label>{label}
      <select value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="">{t("j.choose")}</option>
        {uniqLines(data.lines).map((l) => (
          <optgroup key={l.id} label={tv(t, "line.", l.id)}>
            {l.stations.map((id) => <option key={id} value={id}>{data.byId[id]?.name ?? id}</option>)}
          </optgroup>
        ))}
      </select>
    </label>
  );
}

function Diagram({ data }) {
  const t = useT();
  return (
    <section>
      <h2 className="sub">{t("j.lines")}</h2>
      <div className="lines">
        {data.lines.map((l) => (
          <div key={l.id} className="line" style={{ "--lc": l.color }}>
            <h3><span className="sw" aria-hidden="true" />{tv(t, "line.", l.id)}<small className="num">{t("j.stationsN", { n: l.stations.length })}</small></h3>
            <ol>
              {l.stations.map((id) => {
                const s = data.byId[id];
                const others = (s?.lines ?? []).filter((x) => x !== l.id).map((x) => tv(t, "line.", x));
                return (
                  <li key={id} className={s?.interchange ? "ix" : undefined}>
                    {s?.name ?? id}
                    {s?.interchange && <small>{t("j.ix")}{others.length ? `: ${others.join(", ")}` : ""}</small>}
                  </li>
                );
              })}
            </ol>
          </div>
        ))}
      </div>
    </section>
  );
}

export default function Journey() {
  const t = useT();
  const st = useGet("/api/stations");
  // Stations page links here as #/journey?from=<stationId>
  const [from, setFrom] = useState(() => new URLSearchParams(location.hash.split("?")[1]).get("from") ?? "");
  const [to, setTo] = useState("");
  const [time, setTime] = useState("");
  const [j, setJ] = useState({ data: null, error: null, loading: false });

  const data = st.data?.lines && st.data?.stations && {
    ...st.data,
    byId: Object.fromEntries(st.data.stations.map((s) => [s.id, s])),
    lineName: Object.fromEntries(st.data.lines.map((l) => [l.id, l.name])),
  };

  const plan = async (e) => {
    e.preventDefault();
    setJ({ data: null, error: null, loading: true });
    try {
      const q = new URLSearchParams({ from, to, ...(time && { time }) });
      setJ({ data: await api(`/api/journey?${q}`), error: null, loading: false });
    } catch (err) {
      setJ({ data: null, error: err.message, loading: false });
    }
  };

  const r = j.data;
  return (
    <>
      <PageHead title={t("j.title")} lede={t("j.lede")} />
      <Msg error={st.error} loading={st.loading} empty={st.data && !data && t("j.noData")} />
      {data && (
        <>
          <form className="controls" onSubmit={plan}>
            <StationSelect label={t("j.from")} value={from} onChange={setFrom} data={data} />
            <StationSelect label={t("j.to")} value={to} onChange={setTo} data={data} />
            <label>{t("j.depart")}<input type="time" value={time} onChange={(e) => setTime(e.target.value)} /></label>
            <button className="primary" disabled={!from || !to || from === to || j.loading}>{j.loading ? t("j.planning") : t("j.plan")}</button>
          </form>
          {from && from === to && <p className="msg">{t("j.same")}</p>}
          <Msg error={j.error} />
          {r && (
            <article className="result">
              <dl className="facts">
                <div><dt className="label">{t("j.fare")}</dt><dd className="big num">&#8377;{r.fare}</dd></div>
                <div><dt className="label">{t("j.time")}</dt><dd className="big num">{r.minutes}<small> {t("min")}</small></dd></div>
                <div><dt className="label">{t("j.stops")}</dt><dd className="big num">{r.stops}</dd></div>
                <div><dt className="label">{t("j.dist")}</dt><dd className="big num">{r.distanceKm}<small> {t("j.km")}</small></dd></div>
              </dl>
              {r.peak && <p className="meta-line">{t("j.peak")}</p>}
              <ol className="legs">
                {r.legs.map((l, i) => (
                  <li key={i} style={{ "--lc": l.color }}>
                    <span className="sw" aria-hidden="true" />
                    <strong>{tv(t, "line.", l.line)}</strong>
                    <span>{t("j.leg", { a: data.byId[l.from]?.name ?? l.from, b: data.byId[l.to]?.name ?? l.to })}</span>
                    <small className="num">{t("j.stopsN", { n: l.stops })}</small>
                  </li>
                ))}
              </ol>
              {r.interchanges?.length > 0 && <p><span className="label">{t("j.change")}</span> {r.interchanges.join(", ")}</p>}
              <p className="mute note">{r.note}</p>
            </article>
          )}
          <Diagram data={data} />
        </>
      )}
    </>
  );
}
