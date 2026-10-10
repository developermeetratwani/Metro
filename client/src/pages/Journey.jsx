import { useState } from "react";
import { Msg, PageHead, useGet, api } from "../ui.jsx";

function StationSelect({ label, value, onChange, data }) {
  return (
    <label>{label}
      <select value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="">Choose station</option>
        {data.lines.map((l) => (
          <optgroup key={l.id} label={l.name}>
            {l.stations.map((id) => <option key={id} value={id}>{data.byId[id]?.name ?? id}</option>)}
          </optgroup>
        ))}
      </select>
    </label>
  );
}

function Diagram({ data }) {
  return (
    <section>
      <h2 className="sub">Lines and stations</h2>
      <div className="lines">
        {data.lines.map((l) => (
          <div key={l.id} className="line" style={{ "--lc": l.color }}>
            <h3><span className="sw" aria-hidden="true" />{l.name}<small className="num">{l.stations.length} stations</small></h3>
            <ol>
              {l.stations.map((id) => {
                const s = data.byId[id];
                const others = (s?.lines ?? []).filter((x) => x !== l.id).map((x) => data.lineName[x] ?? x);
                return (
                  <li key={id} className={s?.interchange ? "ix" : undefined}>
                    {s?.name ?? id}
                    {s?.interchange && <small>Interchange{others.length ? `: ${others.join(", ")}` : ""}</small>}
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
  const st = useGet("/api/stations");
  const [from, setFrom] = useState("");
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
      <PageHead title="Journey planner" lede="Fare and travel time between any two stations." />
      <Msg error={st.error} loading={st.loading} empty={st.data && !data && "No station data returned."} />
      {data && (
        <>
          <form className="controls" onSubmit={plan}>
            <StationSelect label="From" value={from} onChange={setFrom} data={data} />
            <StationSelect label="To" value={to} onChange={setTo} data={data} />
            <label>Depart (optional)<input type="time" value={time} onChange={(e) => setTime(e.target.value)} /></label>
            <button className="primary" disabled={!from || !to || from === to || j.loading}>{j.loading ? "Planning..." : "Plan journey"}</button>
          </form>
          {from && from === to && <p className="msg">Pick two different stations.</p>}
          <Msg error={j.error} />
          {r && (
            <article className="result">
              <dl className="facts">
                <div><dt className="label">Fare</dt><dd className="big num">&#8377;{r.fare}</dd></div>
                <div><dt className="label">Time</dt><dd className="big num">{r.minutes}<small> min</small></dd></div>
                <div><dt className="label">Stops</dt><dd className="big num">{r.stops}</dd></div>
                <div><dt className="label">Distance</dt><dd className="big num">{r.distanceKm}<small> km</small></dd></div>
              </dl>
              {r.peak && <p className="meta-line">Peak-hour travel time and fare apply.</p>}
              <ol className="legs">
                {r.legs.map((l, i) => (
                  <li key={i} style={{ "--lc": l.color }}>
                    <span className="sw" aria-hidden="true" />
                    <strong>{l.lineName}</strong>
                    <span>{data.byId[l.from]?.name ?? l.from} to {data.byId[l.to]?.name ?? l.to}</span>
                    <small className="num">{l.stops} stops</small>
                  </li>
                ))}
              </ol>
              {r.interchanges?.length > 0 && <p><span className="label">Change at</span> {r.interchanges.join(", ")}</p>}
              <p className="mute note">{r.note}</p>
            </article>
          )}
          <Diagram data={data} />
        </>
      )}
    </>
  );
}
