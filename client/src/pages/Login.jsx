import { useState } from "react";
import { Msg, PageHead, api, setAuth, useAuth, useGet } from "../ui.jsx";
import { useT } from "../i18n.js";

export default function Login({ app }) {
  const t = useT();
  const a = useAuth();
  const accounts = useGet("/api/auth/accounts");
  const [username, setUser] = useState("");
  const [password, setPass] = useState("");
  const [st, setSt] = useState({ busy: false, error: null });

  const submit = async (e) => {
    e.preventDefault();
    setSt({ busy: true, error: null });
    try {
      const r = await api("/api/auth/login", { method: "POST", body: { username: username.trim(), password } });
      setAuth({ token: r.token, user: r.user });
      setPass("");
      app.go(({ station: "my-station", admin: "admin" })[r.user?.role] ?? "advisory");
    } catch (err) {
      setSt({ busy: false, error: err.status === 401 ? "login.wrong" : err.status === 429 ? "login.locked" : err.message });
      return;
    }
    setSt({ busy: false, error: null });
  };

  const list = Array.isArray(accounts.data) ? accounts.data : [];
  return (
    <>
      <PageHead title={t("login.title")} lede={t("login.lede")} />
      {a?.user && <p className="banner ok-banner" role="status">{t("login.already", { n: a.user.name })}</p>}
      <div className="login-grid">
        <form className="panel login" onSubmit={submit}>
          <label>{t("login.user")}<input type="text" autoComplete="username" value={username} onChange={(e) => setUser(e.target.value)} required /></label>
          <label>{t("login.pass")}<input type="password" autoComplete="current-password" value={password} onChange={(e) => setPass(e.target.value)} required /></label>
          <button className="primary" disabled={st.busy || !username.trim() || !password}>{st.busy ? t("login.going") : t("login.go")}</button>
          <Msg error={st.error} />
        </form>
        <section className="panel tint-blue">
          <h2 className="label">{t("login.who")}</h2>
          <Msg loading={accounts.loading} error={accounts.error} empty={accounts.data && !list.length && t("login.noAcc")}>
            <ul className="accounts">
              {list.map((x) => (
                <li key={x.username}>
                  <button type="button" className="link" onClick={() => setUser(x.username)}>{x.username}</button>
                  <span>{x.name}</span>
                  <em className={`role r-${x.role}`}>{t(`role.${x.role}`)}</em>
                </li>
              ))}
            </ul>
            <small>{t("login.hint")}</small>
          </Msg>
        </section>
      </div>
    </>
  );
}
