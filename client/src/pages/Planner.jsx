import { useState } from "react";
import { motion } from "framer-motion";
import { Msg, PageHead, usePost, tomorrow, cityName, fmtDate, dcls, CitySelect, alertName, bandName, Cost } from "../ui.jsx";
import { BarChart, CostChart, LineChart } from "../charts.jsx";
import { useT } from "../i18n.js";

const BANDS = ["Morning Peak", "Midday", "Evening Peak", "Late Night"];
const holidayName = (h) => (typeof h === "string" ? h : h?.name);

export default function Planner({ app }) {
  const [from, setFrom] = useState(tomorrow);
  const [days, setDays] = useState(7);
  const [st, run] = usePost("/api/plan");
  const plan = st.data?.plan ?? [];
  const flagged = plan.filter((d) => d.alert && d.alert !== "ok");
  const planCity = st.data?.city ?? app.city;
  const t = useT();
  const costs = plan.map((d) => d.cost).filter(Boolean);
  const sum = (f) => costs.reduce((a, c) => a + (+f(c) || 0), 0);
  const total = costs.length > 0 && {
    trainKm: sum((c) => c.trainKm), costINR: sum((c) => c.costINR), co2Kg: sum((c) => c.co2Kg),
    vsBaseline: costs.every((c) => c.vsBaseline) ? { trainKm: sum((c) => c.vsBaseline.trainKm), costINR: sum((c) => c.vsBaseline.costINR), co2Kg: sum((c) => c.vsBaseline.co2Kg) } : null,
  };

  return (
    <>
      <PageHead title={t("plan.title")} lede={t("plan.lede")} />
      <form className="controls" onSubmit={(e) => { e.preventDefault(); run({ from, days, city: app.city }); }}>
        <CitySelect value={app.city} onChange={app.setCity} />
        <label>{t("plan.from")}<input type="date" value={from} onChange={(e) => e.target.value && setFrom(e.target.value)} /></label>
        <label>{t("plan.days")}
          <select value={days} onChange={(e) => setDays(+e.target.value)}>{[3, 7, 14].map((n) => <option key={n}>{n}</option>)}</select>
        </label>
        <button className="primary" disabled={st.loading}>{st.loading ? t("plan.building") : t("plan.build")}</button>
      </form>
      <Msg error={st.error} loading={st.loading} />
      {!st.data && !st.loading && !st.error && <p className="msg">{t("plan.hint")}</p>}
      {st.data && !plan.length && <p className="msg">{t("plan.noDays")}</p>}
      {plan.length > 0 && (
        <>
          <p className={flagged.length ? "banner" : "msg"} role="status">
            {flagged.length
              ? <><strong>{t("plan.flagged", { n: flagged.length })}</strong> {flagged.map((d, i) => <span key={d.date}>{i > 0 && ", "}<button className="link" onClick={() => app.openDay(d.date, planCity)}>{fmtDate(d.date)}</button> ({alertName(t, d.alert)})</span>)}</>
              : t("plan.noFlag", { n: plan.length, c: cityName(t, planCity) })}
          </p>
          <div className="scroll">
            <table className="plan">
              <thead><tr><th>{t("th.day")}</th><th>{t("weather")}</th>{BANDS.map((b) => <th key={b} className="r">{bandName(t, b)}</th>)}<th>{t("th.events")}</th></tr></thead>
              <tbody>
                {plan.map((d, i) => (
                  <motion.tr key={d.date} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.03, duration: 0.25 }}>
                    <td>
                      <button className="link day" onClick={() => app.openDay(d.date, planCity)}>
                        {d.alert && d.alert !== "ok" && <span className={`mark a-${d.alert}`} title={alertName(t, d.alert)} role="img" aria-label={alertName(t, d.alert)} />}
                        {fmtDate(d.date)}
                      </button>
                      <small>{d.dayType}{d.holiday ? `, ${holidayName(d.holiday)}` : ""}</small>
                    </td>
                    <td className="num wx">{d.weather ? `${d.weather.precipSum ?? "-"} mm, ${d.weather.tempMax ?? "-"}°C` : "-"}</td>
                    {BANDS.map((b, k) => {
                      const x = d.rows?.[k];
                      return x
                        ? <td key={b} className={`r cell c-${dcls(x.delta)} m${Math.min(3, Math.abs(x.delta))}`} title={t("plan.base", { b: x.base })}><span className="num">{x.headway}</span></td>
                        : <td key={b} className="r">-</td>;
                    })}
                    <td className="ev">{d.events?.length ? d.events.map((e) => <span key={e.name}>{e.name}{e.live && <em className="tag">{t("live")}</em>}</span>) : <span className="mute">{t("none")}</span>}</td>
                  </motion.tr>
                ))}
              </tbody>
            </table>
          </div>
          {total && <Cost c={total} label={t("plan.total", { n: costs.length })} />}
          <div className="chart-grid">
            <LineChart title={t("chart.planTitle")} desc={t("chart.planDesc")} cats={plan.map((d) => fmtDate(d.date))} unit={` ${t("min")}`}
              yLabel={t("chart.minutes")} xLabel={t("th.day")}
              series={BANDS.map((b, k) => ({ name: bandName(t, b), values: plan.map((d) => d.rows?.[k]?.headway), cls: `s${k + 1}` }))} />
            {costs.length > 0 && (
              <BarChart title={t("chart.dayCost")} desc={t("chart.dayCostDesc")} cats={plan.filter((d) => d.cost).map((d) => fmtDate(d.date))} unit=" ₹"
                yLabel="₹" xLabel={t("th.day")}
                series={[
                  ...(costs.every((c) => c.vsBaseline) ? [{ name: t("chart.usualDay"), values: costs.map((c) => (+c.costINR || 0) - (+c.vsBaseline.costINR || 0)), cls: "s-base" }] : []),
                  { name: t("chart.thisPlan"), values: costs.map((c) => +c.costINR || 0), cls: "s1" },
                ]} />
            )}
            {total?.vsBaseline && <CostChart c={total} title={t("chart.weekCost")} />}
          </div>
        </>
      )}
    </>
  );
}
