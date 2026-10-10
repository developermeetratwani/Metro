import { useEffect, useState } from "react";
import { Context, Msg, PageHead, api, useGet, bandName, n0 } from "../ui.jsx";
import { BarChart } from "../charts.jsx";
import { useT, tv } from "../i18n.js";

// Hours each band runs (morning 6-10, midday 10-17, evening 17-21, late 21-24).
const HOURS = { "Morning Peak": 4, "Midday": 7, "Evening Peak": 4, "Late Night": 3 };
const tph = (hw) => (hw > 0 ? Math.round(60 / hw) : 0);
const dayTotal = (rows, k) => rows.reduce((s, r) => s + (HOURS[r.band] ?? 0) * tph(r[k]), 0);

export default function Frequency({ app }) {
  const t = useT();
  const { city, date } = app;
  const [st, set] = useState({ data: null, error: null, loading: false });
  const net = useGet("/api/stations");

  useEffect(() => {
    const a = app.advisory;
    if (a?.rows && a.city === city && a.date === date) return set({ data: a, error: null, loading: false });
    let off = false;
    set({ data: null, error: null, loading: true });
    api(`/api/auto?city=${city}`).catch(() => null)
      .then((x) => (x?.rows && x.date === date ? x : api("/api/recommend", { method: "POST", body: { date, city, weatherMode: "live", fast: true } })))
      .then((data) => !off && set({ data, error: null, loading: false }), (e) => !off && set({ data: null, error: e.message, loading: false }));
    return () => { off = true; };
  }, [city, date, app.advisory]);

  const rows = st.data?.rows ?? [];
  const d = net.data;
  const lines = d?.lines && d?.stations ? d.lines.filter((l) => l.stations.some((id) => d.stations.find((s) => s.id === id)?.city === city)) : [];
  const usual = dayTotal(rows, "base"), rec = dayTotal(rows, "headway");

  return (
    <>
      <PageHead title={t("fq.title")} lede={t("fq.lede")} />
      <Context app={app} weather={false} />
      <Msg loading={st.loading} error={st.error} empty={!st.loading && !st.error && !rows.length && t("adv.none")}>
        {rows.length > 0 && (
          <>
            <div className="tiles">
              <div className="tile t-blue"><b className="num">{n0(rec)}</b><span>{t("fq.totalRec")}</span></div>
              <div className="tile t-teal"><b className="num">{n0(usual)}</b><span>{t("fq.totalUsual")}</span></div>
              <div className="tile t-saffron"><b className="num">{rec - usual > 0 ? "+" : ""}{n0(rec - usual)}</b><span>{t("fq.diff")}</span></div>
            </div>
            <div className="scroll">
              <table className="bands">
                <thead><tr><th>{t("th.band")}</th><th className="r">{t("fq.usual")}</th><th className="r">{t("fq.rec")}</th></tr></thead>
                <tbody>
                  {rows.map((x) => (
                    <tr key={x.band}>
                      <td><strong>{bandName(t, x.band)}</strong><small className="num">{x.time}</small></td>
                      <td className="r num">{t("freq", { n: x.base, h: tph(x.base) })}</td>
                      <td className="r num"><strong>{t("freq", { n: x.headway, h: tph(x.headway) })}</strong></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="chart-grid">
              <BarChart title={t("fq.chart")} desc={t("fq.chartDesc")} cats={rows.map((x) => bandName(t, x.band))} unit={` ${t("fq.tph")}`}
                yLabel={t("fq.tph")} xLabel={t("th.band")}
                series={[{ name: t("chart.usual"), values: rows.map((x) => tph(x.base)), cls: "s-base" }, { name: t("chart.rec"), values: rows.map((x) => tph(x.headway)), cls: "s1" }]} />
            </div>
            <h2 className="sub">{t("fq.byLine")}</h2>
            <Msg error={net.error} />
            {lines.length > 0 && (
              <div className="scroll">
                <table className="bands">
                  <thead><tr><th>{t("fq.line")}</th>{rows.map((x) => <th key={x.band} className="r">{bandName(t, x.band)}</th>)}</tr></thead>
                  <tbody>
                    {lines.map((l) => (
                      <tr key={l.id} style={{ "--lc": l.color }}>
                        <td><span className="sw" aria-hidden="true" /> {tv(t, "line.", l.id)}</td>
                        {rows.map((x) => <td key={x.band} className="r num">{t("freq", { n: x.headway, h: tph(x.headway) })}</td>)}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}
      </Msg>
    </>
  );
}
