import { useEffect, useRef, useState } from "react";
import { Context, Msg, PageHead, usePost, bodyOf, cityName, fmtDate } from "../ui.jsx";
import { useT, LANGS } from "../i18n.js";

async function copyText(text, el) {
  try { await navigator.clipboard.writeText(text); return true; } catch { /* insecure context or denied */ }
  try { el.select(); return document.execCommand("copy"); } catch { return false; }
}

function Brief({ app }) {
  const t = useT();
  const [lang, setLang] = useState(app.lang);
  const [st, run] = usePost("/api/brief");
  const [copied, setCopied] = useState(null);
  const box = useRef(null);
  const text = st.data?.text ?? "";
  useEffect(() => setCopied(null), [text]);
  return (
    <section>
      <h2 className="sub">{t("brief.title")}</h2>
      <p className="lede">{t("brief.lede")}</p>
      <p className="chips" role="group" aria-label={t("brief.lang")}>
        {LANGS.map(([k, v]) => <button key={k} lang={k} aria-pressed={lang === k} onClick={() => setLang(k)}>{v}</button>)}
      </p>
      <p className="actions"><button className="primary" onClick={() => run({ ...bodyOf(app), lang })} disabled={st.loading}>{st.loading ? t("brief.making") : t("brief.make")}</button></p>
      <Msg error={st.error} />
      {text && (
        <div className="result">
          <textarea ref={box} className="brief" readOnly value={text} lang={st.data.lang} rows={Math.min(12, text.split("\n").length + 2)} aria-label={t("brief.title")} />
          {st.data.ai === false && <p className="msg">{t("brief.template")}</p>}
          <p className="actions">
            <button onClick={async () => setCopied(await copyText(text, box.current))}>{t("brief.copy")}</button>
            <a href={`https://wa.me/?text=${encodeURIComponent(text)}`} target="_blank" rel="noopener noreferrer">{t("brief.wa")}</a>
            {copied != null && <span className={copied ? "msg ok" : "msg err"} role="status">{t(copied ? "brief.copied" : "brief.copyFail")}</span>}
          </p>
        </div>
      )}
    </section>
  );
}

export default function Report({ app }) {
  const t = useT();
  const m = app.meta.data;
  const recipients = m?.recipients ?? [];
  const [prev, preview] = usePost("/api/report/preview");
  const [sent, send] = usePost("/api/report/send");
  const [to, setTo] = useState("");

  useEffect(() => { if (!to && recipients.length) setTo(recipients[0]); }, [recipients, to]);

  const doSend = () => {
    if (window.confirm(t("rep.confirm", { d: `${cityName(t, app.city)} ${fmtDate(app.date)}`, to }))) send({ ...bodyOf(app), to });
  };

  return (
    <>
      <PageHead title={t("rep.title")} lede={t("rep.lede")} />
      <Context app={app} />
      {m && !m.keys?.email && <p className="banner" role="status">{t("rep.noEmail")}</p>}
      {m && !m.llm && <p className="msg">{t("rep.noAI")}</p>}
      <p className="actions"><button className="primary" onClick={() => preview(bodyOf(app))} disabled={prev.loading}>{prev.loading ? t("rep.previewing") : t("rep.preview")}</button></p>
      <Msg error={prev.error} />
      {prev.data && (
        <section className="result">
          <p><span className="label">{t("rep.subject")}</span> {prev.data.subject}</p>
          <iframe className="report-frame" title={t("rep.frame")} sandbox="" srcDoc={prev.data.html} />
          <div className="controls send">
            <label>{t("rep.recipient")}
              <select value={to} onChange={(e) => setTo(e.target.value)} disabled={!recipients.length}>
                {!recipients.length && <option value="">{t("rep.noRecip")}</option>}
                {recipients.map((r) => <option key={r}>{r}</option>)}
              </select>
            </label>
            <button className="primary" onClick={doSend} disabled={!to || sent.loading}>{sent.loading ? t("rep.sending") : t("rep.send")}</button>
          </div>
          <p className="mute">{t("rep.onlyAuth")}</p>
          <Msg error={sent.error} />
          {sent.data?.ok && <p className="msg ok" role="status">{t("rep.sent", { to: sent.data.sentTo ?? to })}</p>}
        </section>
      )}
      <Brief app={app} />
    </>
  );
}
