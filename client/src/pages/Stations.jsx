import { useEffect } from "react";
import { useT } from "../i18n.js";
import { Context, Msg, PageHead, useGet, usePost, bodyOf, cityName, weatherName, fmtDate } from "../ui.jsx";

const hh = (h) => `${String(h).padStart(2, "0")}`;

function Heatmap({ app }) {
  const t = useT();
  const [st, run] = usePost("/api/heatmap");
  const load = () => run(bodyOf(app));
  useEffect(() => { load(); }, [app.city]); // eslint-disable-line react-hooks/exhaustive-deps
  const d = st.data;
  const p = d?.peak;
  return (
    <section>
      <h2 className="sub">Crowd by hour</h2>
      <p className="lede">Modelled crowd index, 0 to 100, for {cityName(t, app.city)} on {fmtDate(app.date)} with {app.eventIds.length} selected event{app.eventIds.length === 1 ? "" : "s"} and {weatherName(t, app.weatherMode).toLowerCase()}. Change events on the Advisory page.</p>
      <p className="actions"><button className="primary" onClick={load} disabled={st.loading}>{st.loading ? "Loading..." : "Refresh heatmap"}</button></p>
      <Msg error={st.error} loading={st.loading && !d} />
      {d && !d.stations?.length && <p className="msg">No station data returned.</p>}
      {d?.stations?.length > 0 && (
        <>
          {p && <p className="peak"><span className="label">Peak</span> <strong>{p.station}</strong> at <span className="num">{hh(p.hour)}:00</span>, index <span className="num">{p.value}</span></p>}
          <div className="scroll">
            <table className="heat">
              <thead><tr><th>Station</th>{d.hours.map((h) => <th key={h} className="r">{hh(h)}</th>)}</tr></thead>
              <tbody>
                {d.stations.map((s) => (
                  <tr key={s.id}>
                    <th scope="row">{s.name}</th>
                    {s.values.map((v, i) => {
                      const isPeak = p && p.station === s.name && p.hour === d.hours[i];
                      return (
                        <td key={i} className={`hc${v > 55 ? " hi" : ""}${isPeak ? " pk" : ""}`} style={{ "--v": `${Math.round(v * 0.9)}%` }} title={`${s.name} ${hh(d.hours[i])}:00 index ${v}`}>
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

function StationWeather({ app }) {
  const { data, error, loading } = useGet(`/api/stations/weather?city=${app.city}`);
  const list = data?.stations ?? [];
  return (
    <section>
      <h2 className="sub">Weather at stations, now</h2>
      <Msg error={error} loading={loading} empty={data && !list.length && "No station weather returned."} />
      {list.length > 0 && (
        <>
          <p className="meta-line">Source <strong>{data.source}</strong>, updated <span className="num">{new Date(data.updated).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}</span></p>
          <div className="scroll">
            <table>
              <thead><tr><th>Station</th><th className="r">Temp</th><th className="r">Feels like</th><th className="r">Rain chance</th><th className="r">Wind</th><th>Condition</th></tr></thead>
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

export default function Stations({ app }) {
  return (
    <>
      <PageHead title="Stations" lede="Where the crowd will be, and what the weather is doing there." />
      <Context app={app} />
      <Heatmap app={app} />
      <StationWeather app={app} />
    </>
  );
}
