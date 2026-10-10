import { useId } from "react";
import { n0 } from "./ui.jsx";
import { useT } from "./i18n.js";

// Small inline-SVG charts. Colours come from CSS classes (s1..s5, s-base) so light/dark themes just work.
const W = 640, H = 260;
const niceMax = (v) => { const p = 10 ** Math.floor(Math.log10(v || 1)); return [1, 2, 2.5, 5, 10].find((k) => k * p >= v) * p; };
const fin = (v) => typeof v === "number" && Number.isFinite(v);
const short = (s, n = 14) => (String(s).length > n ? `${String(s).slice(0, n - 1)}…` : String(s));

function Frame({ title, desc, legend, children, wide }) {
  const id = useId();
  return (
    <figure className="chart">
      <figcaption className="chart-title" id={`${id}c`}>{title}</figcaption>
      <div className="chart-scroll">
        <svg viewBox={`0 0 ${W} ${H + (wide ? 50 : 0)}`} role="img" aria-labelledby={`${id}t ${id}d`} style={wide ? { minWidth: 620 } : undefined}>
          <title id={`${id}t`}>{title}</title>
          <desc id={`${id}d`}>{desc}</desc>
          {children}
        </svg>
      </div>
      {legend?.length > 1 && (
        <ul className="legend">{legend.map((s) => <li key={s.name}><i className={`sw-${s.cls}`} aria-hidden="true" />{s.name}</li>)}</ul>
      )}
    </figure>
  );
}

// Shared frame: y grid + labels, x labels (rotated when crowded), axis titles.
function Axes({ cats, max, yLabel, xLabel, x, m, rot }) {
  const ih = H - m.t - m.b;
  return (
    <g className="axes">
      {[0, 0.25, 0.5, 0.75, 1].map((f) => {
        const y = m.t + ih - f * ih;
        return <g key={f}><line x1={m.l} x2={W - m.r} y1={y} y2={y} /><text x={m.l - 6} y={y + 4} textAnchor="end">{+(f * max).toFixed(1)}</text></g>;
      })}
      {cats.map((c, i) => (
        rot
          ? <text key={i} transform={`translate(${x(i)},${H - m.b + 12}) rotate(-40)`} textAnchor="end">{short(c)}</text>
          : <text key={i} x={x(i)} y={H - m.b + 16} textAnchor="middle">{short(c, 12)}</text>
      ))}
      {yLabel && <text className="axt" transform={`translate(12,${m.t + ih / 2}) rotate(-90)`} textAnchor="middle">{yLabel}</text>}
      {xLabel && <text className="axt" x={m.l + (W - m.l - m.r) / 2} y={H + (rot ? 46 : -4)} textAnchor="middle">{xLabel}</text>}
    </g>
  );
}

// series: [{ name, values: number[], cls: "s1".."s5" | "s-base" }]
export function BarChart({ title, desc, cats, series, yLabel, xLabel, unit = "" }) {
  const rot = cats.length > 8;
  const m = { t: 14, r: 10, b: rot ? 30 : 40, l: 52 };
  const max = niceMax(Math.max(1, ...series.flatMap((s) => s.values.filter(fin))));
  const ih = H - m.t - m.b, bw = (W - m.l - m.r) / cats.length, gw = (bw * 0.74) / series.length;
  const x = (i) => m.l + i * bw + bw / 2;
  const y = (v) => m.t + ih - (v / max) * ih;
  return (
    <Frame title={title} desc={desc} legend={series} wide={rot}>
      <Axes cats={cats} max={max} yLabel={yLabel} xLabel={xLabel} x={x} m={m} rot={rot} />
      {cats.map((c, i) => series.map((s, k) => {
        const v = s.values[i];
        if (!fin(v)) return null;
        return (
          <rect key={`${i}-${k}`} className={`bar ${s.cls}`} x={m.l + i * bw + bw * 0.13 + k * gw} y={y(v)} width={Math.max(2, gw - 3)} height={Math.max(0, m.t + ih - y(v))} rx="3">
            <title>{`${c} · ${s.name}: ${v}${unit}`}</title>
          </rect>
        );
      }))}
    </Frame>
  );
}

export function LineChart({ title, desc, cats, series, yLabel, xLabel, unit = "", max: fixedMax }) {
  const rot = cats.length > 12;
  const m = { t: 14, r: 14, b: rot ? 30 : 40, l: 52 };
  const max = fixedMax ?? niceMax(Math.max(1, ...series.flatMap((s) => s.values.filter(fin))));
  const ih = H - m.t - m.b, step = (W - m.l - m.r) / Math.max(1, cats.length - 1);
  const x = (i) => m.l + i * step;
  const y = (v) => m.t + ih - (v / max) * ih;
  return (
    <Frame title={title} desc={desc} legend={series} wide={rot}>
      <Axes cats={cats} max={max} yLabel={yLabel} xLabel={xLabel} x={x} m={m} rot={rot} />
      {series.map((s) => {
        const pts = s.values.map((v, i) => fin(v) && [x(i), y(v)]).filter(Boolean);
        return (
          <g key={s.name} className={`line ${s.cls}`}>
            <polyline points={pts.map((p) => p.join(",")).join(" ")} pathLength="1" />
            {s.values.map((v, i) => fin(v) && (
              <circle key={i} cx={x(i)} cy={y(v)} r="4"><title>{`${s.name} · ${cats[i]}: ${v}${unit}`}</title></circle>
            ))}
          </g>
        );
      })}
    </Frame>
  );
}

// "Usual vs this plan" pairs, each row on its own scale (units differ: km, rupees, kg).
// rows: [{ label, base, now, fmt }]
export function CompareBars({ title, desc, rows, baseName, nowName }) {
  const id = useId();
  const rh = 62, h = rows.length * rh + 8, L = 0, R = 470;
  return (
    <figure className="chart">
      <figcaption className="chart-title">{title}</figcaption>
      <svg viewBox={`0 0 ${R + 150} ${h}`} role="img" aria-labelledby={`${id}t ${id}d`}>
        <title id={`${id}t`}>{title}</title>
        <desc id={`${id}d`}>{desc}</desc>
        {rows.map((r, i) => {
          const mx = Math.max(r.base, r.now, 1), y0 = i * rh + 4;
          const w = (v) => Math.max(2, (v / mx) * (R - L));
          return (
            <g key={r.label} className="cmp">
              <text x={L} y={y0 + 12} className="axt">{r.label}</text>
              <rect className="bar s-base" x={L} y={y0 + 18} width={w(r.base)} height="16" rx="3"><title>{`${r.label} · ${baseName}: ${r.fmt(r.base)}`}</title></rect>
              <text x={L + w(r.base) + 8} y={y0 + 31}>{r.fmt(r.base)}</text>
              <rect className="bar s1" x={L} y={y0 + 37} width={w(r.now)} height="16" rx="3"><title>{`${r.label} · ${nowName}: ${r.fmt(r.now)}`}</title></rect>
              <text x={L + w(r.now) + 8} y={y0 + 50}>{r.fmt(r.now)}</text>
            </g>
          );
        })}
      </svg>
      <ul className="legend"><li><i className="sw-s-base" aria-hidden="true" />{baseName}</li><li><i className="sw-s1" aria-hidden="true" />{nowName}</li></ul>
    </figure>
  );
}

export function CostChart({ c, title }) {
  const t = useT();
  const v = c.vsBaseline;
  const row = (k, label, fmt) => ({ label, base: (+c[k] || 0) - (+v[k] || 0), now: +c[k] || 0, fmt });
  return (
    <CompareBars title={title ?? t("chart.costTitle")} desc={t("chart.costDesc")} baseName={t("chart.usualDay")} nowName={t("chart.thisPlan")}
      rows={[row("trainKm", t("cost.trainKm"), n0), row("costINR", "₹", (x) => `₹${n0(x)}`), row("co2Kg", t("cost.co2"), n0)]} />
  );
}

