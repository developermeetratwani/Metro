import { useEffect, useState } from "react";
import { Context, Msg, PageHead, usePost, bodyOf } from "../ui.jsx";

export default function Report({ app }) {
  const m = app.meta.data;
  const recipients = m?.recipients ?? [];
  const [prev, preview] = usePost("/api/report/preview");
  const [sent, send] = usePost("/api/report/send");
  const [to, setTo] = useState("");

  useEffect(() => { if (!to && recipients.length) setTo(recipients[0]); }, [recipients, to]);

  const doSend = () => {
    if (window.confirm(`Send this report for ${app.date} to ${to}?`)) send({ ...bodyOf(app), to });
  };

  return (
    <>
      <PageHead title="Report" lede="An AI-written briefing for the selected day, reviewed here before it goes to anyone." />
      <Context app={app} />
      {m && !m.keys?.email && <p className="banner" role="status">Email is not configured on the server, so sending will fail. Preview still works.</p>}
      {m && !m.llm && <p className="msg">AI is not configured; the report may be a plain template.</p>}
      <p className="actions"><button className="primary" onClick={() => preview(bodyOf(app))} disabled={prev.loading}>{prev.loading ? "Writing report..." : "Preview report"}</button></p>
      <Msg error={prev.error} />
      {prev.data && (
        <section className="result">
          <p><span className="label">Subject</span> {prev.data.subject}</p>
          <iframe className="report-frame" title="Report preview" sandbox="" srcDoc={prev.data.html} />
          <div className="controls send">
            <label>Recipient
              <select value={to} onChange={(e) => setTo(e.target.value)} disabled={!recipients.length}>
                {!recipients.length && <option value="">No authorised recipients</option>}
                {recipients.map((r) => <option key={r}>{r}</option>)}
              </select>
            </label>
            <button className="primary" onClick={doSend} disabled={!to || sent.loading}>{sent.loading ? "Sending..." : "Send report"}</button>
          </div>
          <p className="mute">Only recipients authorised on the server can be selected.</p>
          <Msg error={sent.error} />
          {sent.data?.ok && <p className="msg ok" role="status">Report sent to {sent.data.sentTo ?? to}.</p>}
        </section>
      )}
    </>
  );
}
