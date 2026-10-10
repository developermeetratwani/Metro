import { useEffect, useState } from "react";
import { Context, Msg, PageHead, api, bodyOf, useGet, dcls, bandName, cityName, fmtDate } from "../ui.jsx";
import { useT } from "../i18n.js";

// Labels come from rules.base.<k>, rules.tier.<k> and rules.<k>; unknown keys show as-is.
const FLAT = ["heavyRain", "moderateRain", "heat", "holidayWiden", "saturdayWiden", "min", "max"];
const lbl = (t, key, k) => { const s = t(key); return s === key ? k : s; };

const sameCfg = (a, b) => JSON.stringify(a) === JSON.stringify(b);

function Num({ label, value, onChange, changed }) {
  const t = useT();
  return (
    <label className={`num-field${changed ? " changed" : ""}`}>
      <span>{label}</span>
      <input type="number" min="0" step="1" value={value} onChange={(e) => onChange(e.target.value === "" ? 0 : +e.target.value)} />
      <small>{t("min")}</small>
    </label>
  );
}

export default function Rules({ app }) {
  const t = useT();
  const { data, error, loading } = useGet("/api/config");
  const [cfg, setCfg] = useState(null);
  const [defs, setDefs] = useState(null);
  const [saved, setSaved] = useState(null);
  const [note, setNote] = useState(null);
  const [cmp, setCmp] = useState({ data: null, error: null, loading: false });

  useEffect(() => {
    if (data?.config) { setCfg(data.config); setSaved(data.config); setDefs(data.defaults ?? data.config); }
  }, [data]);

  const set = (path, v) => setCfg((c) => (path.length === 2 ? { ...c, [path[0]]: { ...c[path[0]], [path[1]]: v } } : { ...c, [path[0]]: v }));
  const changed = (path) => (defs ? (path.length === 2 ? cfg[path[0]][path[1]] !== defs[path[0]][path[1]] : cfg[path[0]] !== defs[path[0]]) : false);

  const put = async (c, msg) => {
    setNote({ text: t("saving") });
    try { await api("/api/config", { method: "PUT", body: c }); setSaved(c); setCfg(c); setNote({ text: msg }); }
    catch (e) { setNote({ text: e.message, err: true }); }
  };

  const compare = async () => {
    setCmp({ data: null, error: null, loading: true });
    try {
      const b = { ...bodyOf(app), fast: true };
      const [before, after] = await Promise.all([api("/api/recommend", { method: "POST", body: { ...b, config: defs } }), api("/api/recommend", { method: "POST", body: { ...b, config: cfg } })]);
      setCmp({ data: { before, after }, error: null, loading: false });
    } catch (e) { setCmp({ data: null, error: e.message, loading: false }); }
  };

  if (loading || error || !cfg) return <><PageHead title={t("rules.title")} /><Msg loading={loading} error={error} /></>;
  const dirty = !sameCfg(cfg, saved);
  const c = cmp.data;

  return (
    <>
      <PageHead title={t("rules.title")} lede={t("rules.lede")} />
      <Context app={app} />
      <div className="rules">
        <fieldset>
          <legend className="label">{t("rules.baseline")}</legend>
          {Object.keys(cfg.base).map((k) => <Num key={k} label={lbl(t, `rules.base.${k}`, k)} value={cfg.base[k]} onChange={(v) => set(["base", k], v)} changed={changed(["base", k])} />)}
        </fieldset>
        <fieldset>
          <legend className="label">{t("rules.tiers")}</legend>
          {Object.keys(cfg.tier).map((k) => <Num key={k} label={lbl(t, `rules.tier.${k}`, k)} value={cfg.tier[k]} onChange={(v) => set(["tier", k], v)} changed={changed(["tier", k])} />)}
        </fieldset>
        <fieldset>
          <legend className="label">{t("rules.flat")}</legend>
          {FLAT.filter((k) => k in cfg).map((k) => <Num key={k} label={lbl(t, `rules.${k}`, k)} value={cfg[k]} onChange={(v) => set([k], v)} changed={changed([k])} />)}
        </fieldset>
      </div>

      <p className="actions">
        <button className="primary" onClick={compare} disabled={cmp.loading}>{cmp.loading ? t("rules.comparing") : t("rules.compare")}</button>
        <button onClick={() => put(cfg, t("rules.saved"))} disabled={!dirty}>{t("rules.save")}</button>
        <button className="link" onClick={() => put(defs, t("rules.resetDone"))} disabled={sameCfg(saved, defs) && sameCfg(cfg, defs)}>{t("rules.reset")}</button>
        {dirty && <span className="mute">{t("rules.unsaved")}</span>}
      </p>
      {note && <p className={`msg${note.err ? " err" : ""}`} role={note.err ? "alert" : "status"}>{note.text}</p>}
      <Msg error={cmp.error} />
      {c && (
        <div className="scroll">
          <table>
            <caption className="label">{t("rules.caption", { c: cityName(t, c.after.city), d: fmtDate(c.after.date) })}</caption>
            <thead><tr><th>{t("th.band")}</th><th className="r">{t("th.defaults")}</th><th className="r">{t("th.yours")}</th><th className="r">{t("th.diff")}</th></tr></thead>
            <tbody>
              {c.after.rows.map((x, i) => {
                const b = c.before.rows[i]?.headway;
                const diff = b == null ? null : x.headway - b;
                return (
                  <tr key={x.band}>
                    <td>{bandName(t, x.band)}</td>
                    <td className="r num">{b ?? "-"} {t("min")}</td>
                    <td className="r num">{x.headway} {t("min")}</td>
                    <td className={`r num d-${diff == null ? "same" : dcls(diff)}`}>{diff == null ? "-" : diff === 0 ? t("rules.same") : `${diff > 0 ? "+" : "−"}${Math.abs(diff)} ${t("min")}`}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
