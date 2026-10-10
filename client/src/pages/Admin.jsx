import { useState } from "react";
import { Msg, PageHead, api, isAdmin, useAuth, useGet } from "../ui.jsx";
import { useT, tv } from "../i18n.js";

const ROLES = ["station", "control", "admin"];

// Station select grouped by line (a station on two lines shows under both).
function StationSelect({ net, value, onChange, label, required }) {
  const t = useT();
  return (
    <label>{label}
      <select value={value} onChange={(e) => onChange(e.target.value)} required={required}>
        <option value="">{t("adm.noStation")}</option>
        {net.lines.map((l) => (
          <optgroup key={l.id} label={tv(t, "line.", l.id)}>
            {l.stations.map((id) => <option key={`${l.id}-${id}`} value={id}>{net.byId[id]?.name ?? id}</option>)}
          </optgroup>
        ))}
      </select>
    </label>
  );
}

const notifiedMsg = (t, r) => r?.notified && `${t("adm.notified")}${r.notified.emailed ? ` · ${t("adm.emailed")}` : ""}`;

function Create({ net, onDone }) {
  const t = useT();
  const empty = { name: "", username: "", password: "", role: "station", station: "", email: "" };
  const [f, setF] = useState(empty);
  const [st, setSt] = useState({ busy: false, error: null, ok: null });
  const set = (k) => (v) => setF({ ...f, [k]: v });
  const needStation = f.role === "station" && !f.station;
  const submit = async (e) => {
    e.preventDefault();
    if (needStation || f.password.length < 8) return;
    setSt({ busy: true, error: null, ok: null });
    try {
      const body = { name: f.name.trim(), username: f.username.trim(), password: f.password, role: f.role, ...(f.station && { station: f.station }), ...(f.email.trim() && { email: f.email.trim() }) };
      const r = await api("/api/admin/operators", { method: "POST", body });
      setF(empty);
      setSt({ busy: false, error: null, ok: notifiedMsg(t, r) || t("adm.created") });
      onDone();
    } catch (err) { setSt({ busy: false, error: err.message, ok: null }); }
  };
  return (
    <form className="panel tint-blue adm-form" onSubmit={submit}>
      <h2 className="label">{t("adm.new")}</h2>
      <div className="adm-fields">
        <label>{t("adm.name")}<input type="text" value={f.name} onChange={(e) => set("name")(e.target.value)} required /></label>
        <label>{t("login.user")}<input type="text" autoComplete="off" value={f.username} onChange={(e) => set("username")(e.target.value)} required /></label>
        <label>{t("login.pass")}<input type="password" autoComplete="new-password" minLength={8} value={f.password} onChange={(e) => set("password")(e.target.value)} required /></label>
        <label>{t("adm.role")}
          <select value={f.role} onChange={(e) => set("role")(e.target.value)}>{ROLES.map((r) => <option key={r} value={r}>{t(`role.${r}`)}</option>)}</select>
        </label>
        <StationSelect net={net} value={f.station} onChange={set("station")} label={t("th.station")} required={f.role === "station"} />
        <label>{t("adm.email")}<input type="email" value={f.email} onChange={(e) => set("email")(e.target.value)} /></label>
      </div>
      <small>{t("adm.passHint")}</small>
      <p className="actions"><button className="primary" disabled={st.busy || needStation || f.password.length < 8}>{st.busy ? t("saving") : t("adm.create")}</button></p>
      <Msg error={st.error} />
      {st.ok && <p className="msg ok" role="status">{st.ok}</p>}
    </form>
  );
}

function Row({ o, net, onDone }) {
  const t = useT();
  const [station, setStation] = useState(o.station ?? "");
  const [st, setSt] = useState({ busy: false, error: null, ok: null });
  const run = async (fn) => {
    setSt({ busy: true, error: null, ok: null });
    try { const ok = await fn(); setSt({ busy: false, error: null, ok }); onDone(); } catch (e) { setSt({ busy: false, error: e.message, ok: null }); }
  };
  const reassign = () => run(async () => notifiedMsg(t, await api(`/api/admin/operators/${encodeURIComponent(o.username)}`, { method: "PATCH", body: { station } })) || t("adm.saved"));
  const remove = () => window.confirm(t("adm.confirmRm", { n: o.name })) && run(async () => { await api(`/api/admin/operators/${encodeURIComponent(o.username)}`, { method: "DELETE" }); return null; });
  return (
    <tr>
      <td><strong>{o.name}</strong><small className="num">{o.username}</small></td>
      <td><em className={`role r-${o.role}`}>{t(`role.${o.role}`)}</em></td>
      <td>{o.station ? net.byId[o.station]?.name ?? o.station : <span className="mute">-</span>}</td>
      <td>{o.email || <span className="mute">-</span>}</td>
      <td className="adm-act">
        <div className="override">
          <StationSelect net={net} value={station} onChange={setStation} label={t("adm.reassign")} />
          <button onClick={reassign} disabled={st.busy || station === (o.station ?? "")}>{t("adm.save")}</button>
          <button className="link" onClick={remove} disabled={st.busy}>{t("adm.remove")}</button>
        </div>
        <Msg error={st.error} />
        {st.ok && <small className="msg ok" role="status">{st.ok}</small>}
      </td>
    </tr>
  );
}

export default function Admin() {
  const t = useT();
  const a = useAuth();
  const [rev, setRev] = useState(0);
  const admin = isAdmin(a);
  const ops = useGet(admin ? `/api/admin/operators?r=${rev}` : null);
  const all = useGet(admin ? "/api/stations" : null);
  const d = all.data;
  const net = d?.lines && d?.stations ? { lines: d.lines, byId: Object.fromEntries(d.stations.map((s) => [s.id, s])) } : null;
  const list = Array.isArray(ops.data) ? ops.data : [];
  const refresh = () => setRev((n) => n + 1);

  if (!admin) return <><PageHead title={t("adm.title")} /><p className="banner watch">{t("adm.need")} <a href="#/login">{t("login.title")}</a></p></>;
  return (
    <>
      <PageHead title={t("adm.title")} lede={t("adm.lede")} />
      <Msg loading={all.loading} error={all.error} />
      {net && <Create net={net} onDone={refresh} />}
      <h2 className="sub">{t("adm.list")}</h2>
      <Msg loading={ops.loading && !ops.data} error={ops.error} empty={ops.data && !list.length && t("adm.none")}>
        {net && list.length > 0 && (
          <div className="scroll">
            <table>
              <thead><tr><th>{t("adm.name")}</th><th>{t("adm.role")}</th><th>{t("th.station")}</th><th>{t("adm.email")}</th><th>{t("adm.actions")}</th></tr></thead>
              <tbody>{list.map((o) => <Row key={o.username} o={o} net={net} onDone={refresh} />)}</tbody>
            </table>
          </div>
        )}
      </Msg>
    </>
  );
}
