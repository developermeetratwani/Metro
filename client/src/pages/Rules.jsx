import { useEffect, useState } from "react";
import { Context, Msg, PageHead, api, bodyOf, useGet, dcls } from "../ui.jsx";

const BAND_LABEL = { morning: "Morning peak baseline", midday: "Midday baseline", evening: "Evening peak baseline", late: "Late night baseline" };
const TIER_LABEL = { big: "Crowd 50k+: tighten by", mid: "Crowd 10k+: tighten by", small: "Smaller crowd: tighten by" };
const FLAT = [
  ["heavyRain", "Heavy rain: widen by"], ["moderateRain", "Moderate rain: widen by"], ["heat", "Extreme heat: widen by"],
  ["holidayWiden", "Holiday / Sunday: widen by"], ["saturdayWiden", "Saturday morning: widen by"],
  ["min", "Shortest headway allowed"], ["max", "Longest headway allowed"],
];

const sameCfg = (a, b) => JSON.stringify(a) === JSON.stringify(b);

function Num({ label, value, onChange, changed }) {
  return (
    <label className={`num-field${changed ? " changed" : ""}`}>
      <span>{label}</span>
      <input type="number" min="0" step="1" value={value} onChange={(e) => onChange(e.target.value === "" ? 0 : +e.target.value)} />
      <small>min</small>
    </label>
  );
}

export default function Rules({ app }) {
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
    setNote({ text: "Saving..." });
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

  if (loading || error || !cfg) return <><PageHead title="Rules" /><Msg loading={loading} error={error} /></>;
  const dirty = !sameCfg(cfg, saved);
  const c = cmp.data;

  return (
    <>
      <PageHead title="Rules and what-if" lede="Every number behind the recommendation. Edit values, compare against the defaults for the day below, then save when satisfied. Negative changes mean more frequent trains." />
      <Context app={app} />
      <div className="rules">
        <fieldset>
          <legend className="label">Baseline headway</legend>
          {Object.keys(cfg.base).map((k) => <Num key={k} label={BAND_LABEL[k] ?? k} value={cfg.base[k]} onChange={(v) => set(["base", k], v)} changed={changed(["base", k])} />)}
        </fieldset>
        <fieldset>
          <legend className="label">Event crowd tiers</legend>
          {Object.keys(cfg.tier).map((k) => <Num key={k} label={TIER_LABEL[k] ?? k} value={cfg.tier[k]} onChange={(v) => set(["tier", k], v)} changed={changed(["tier", k])} />)}
        </fieldset>
        <fieldset>
          <legend className="label">Weather, calendar and limits</legend>
          {FLAT.filter(([k]) => k in cfg).map(([k, l]) => <Num key={k} label={l} value={cfg[k]} onChange={(v) => set([k], v)} changed={changed([k])} />)}
        </fieldset>
      </div>

      <p className="actions">
        <button className="primary" onClick={compare} disabled={cmp.loading}>{cmp.loading ? "Comparing..." : "Compare with defaults"}</button>
        <button onClick={() => put(cfg, "Saved. New recommendations will use these values.")} disabled={!dirty}>Save</button>
        <button className="link" onClick={() => put(defs, "Reset to defaults and saved.")} disabled={sameCfg(saved, defs) && sameCfg(cfg, defs)}>Reset to defaults</button>
        {dirty && <span className="mute">Unsaved changes</span>}
      </p>
      {note && <p className={`msg${note.err ? " err" : ""}`} role={note.err ? "alert" : "status"}>{note.text}</p>}
      <Msg error={cmp.error} />
      {c && (
        <div className="scroll">
          <table>
            <caption className="label">Defaults vs your values, {c.after.city} {c.after.date}</caption>
            <thead><tr><th>Band</th><th className="r">Defaults</th><th className="r">Yours</th><th className="r">Difference</th></tr></thead>
            <tbody>
              {c.after.rows.map((x, i) => {
                const b = c.before.rows[i]?.headway;
                const diff = b == null ? null : x.headway - b;
                return (
                  <tr key={x.band}>
                    <td>{x.band}</td>
                    <td className="r num">{b ?? "-"} min</td>
                    <td className="r num">{x.headway} min</td>
                    <td className={`r num d-${diff == null ? "same" : dcls(diff)}`}>{diff == null ? "-" : diff === 0 ? "same" : `${diff > 0 ? "+" : "−"}${Math.abs(diff)} min`}</td>
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
