/**
 * Turns a QC sweep's JSON into a self-contained HTML report (data/qc/qc-<time>.html).
 * qc.ts calls this after every run; to re-render the latest JSON on its own:
 *   pnpm --filter @contour/desk exec tsx scripts/qc-report.ts
 */
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

/** Only what the page draws, so the report stays small. */
function slim(data: any) {
  return {
    startedAt: data.startedAt,
    books: data.books,
    rules: data.rules,
    rejected: data.rejected,
    results: data.results.map((r: any) => ({
      ticker: r.ticker,
      title: r.title,
      category: r.category,
      kind: r.kind,
      expiry: r.expiry,
      volume: r.volume,
      mean: r.mean,
      anchor: r.anchor,
      spot: r.spot,
      marketProb: r.marketProb,
      bucketLabels: r.bucketLabels,
      quotes: r.quotes.map((q: any) => ({ s: q.strike, l: q.label, b: q.bid, a: q.ask, f: q.firm, c: q.counted, k: q.locked, v: q.curve })),
      findings: r.findings,
      runs: r.runs.map((x: any) => ({ o: x.outlook, c: x.confidence, t: x.trades, p: x.payouts, z: x.profitZone, legs: x.legs.map((g: any) => `${g.side.toUpperCase()} ${g.label} @ ${Math.round(g.price * 100)}¢ × ${g.qty}`) })),
    })),
  };
}

export function renderQcReport(data: any): string {
  const json = JSON.stringify(slim(data)).replace(/</g, "\\u003c");
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Contour Market QC</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;700&family=JetBrains+Mono:wght@400;500&display=swap">
<style>
/* Layout: one reading column; summary → rules → filterable market list with expandable detail. Contour's own palette. */
:root {
  --bg: #f6f6f6; --surface: #ffffff; --ink: #1f1f1f; --slate: #5d5d5d; --smoke: #888888; --line: #e7e7e7;
  --accent: #594ff4; --accent-soft: rgba(89,79,244,0.10);
  --error: #d1433b; --error-soft: rgba(209,67,59,0.10); --warn: #b97c0c; --warn-soft: rgba(185,124,12,0.12); --ok: #1aab8b; --ok-soft: rgba(26,171,139,0.12);
  --o-higher: #594ff4; --o-lower: #e0703a; --o-near: #1aab8b; --o-move: #8a8a8a;
  --sans: "Inter", ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
  --mono: "JetBrains Mono", ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  color-scheme: light;
}
@media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) {
  --bg: #141416; --surface: #1d1d21; --ink: #ececef; --slate: #b4b4bb; --smoke: #8b8b93; --line: #2e2e34;
  --accent: #8b84ff; --accent-soft: rgba(139,132,255,0.14);
  --error: #ff6f66; --error-soft: rgba(255,111,102,0.14); --warn: #e8b04a; --warn-soft: rgba(232,176,74,0.14); --ok: #3dd0ad; --ok-soft: rgba(61,208,173,0.14);
  --o-higher: #8b84ff; --o-lower: #f08a55; --o-near: #3dd0ad; --o-move: #a0a0a8; color-scheme: dark; } }
:root[data-theme="dark"] {
  --bg: #141416; --surface: #1d1d21; --ink: #ececef; --slate: #b4b4bb; --smoke: #8b8b93; --line: #2e2e34;
  --accent: #8b84ff; --accent-soft: rgba(139,132,255,0.14);
  --error: #ff6f66; --error-soft: rgba(255,111,102,0.14); --warn: #e8b04a; --warn-soft: rgba(232,176,74,0.14); --ok: #3dd0ad; --ok-soft: rgba(61,208,173,0.14);
  --o-higher: #8b84ff; --o-lower: #f08a55; --o-near: #3dd0ad; --o-move: #a0a0a8; color-scheme: dark; }
* { box-sizing: border-box; }
body { margin: 0; background: var(--bg); color: var(--ink); font: 15px/1.5 var(--sans); }
.wrap { max-width: 1120px; margin: 0 auto; padding-block: 32px 64px; padding-left: max(16px, env(safe-area-inset-left, 0px)); padding-right: max(16px, env(safe-area-inset-right, 0px)); display: grid; gap: 28px; }
h1 { font-size: 30px; line-height: 1.15; margin: 0; letter-spacing: -0.01em; text-wrap: balance; }
h2 { font-size: 19px; margin: 0; }
.meta { color: var(--slate); font-size: 14px; margin-top: 6px; }
.mono { font-family: var(--mono); font-size: 12.5px; }
.tnum { font-variant-numeric: tabular-nums; }
.stats { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 12px; }
.stat { background: var(--surface); border-radius: 16px; padding: 14px 16px; border: 1px solid var(--line); }
.stat b { display: block; font-size: 26px; line-height: 1.1; }
.stat span { color: var(--slate); font-size: 13px; }
.stat.err b { color: var(--error); } .stat.warn b { color: var(--warn); } .stat.ok b { color: var(--ok); }
section { display: grid; gap: 12px; }
.panel { background: var(--surface); border: 1px solid var(--line); border-radius: 20px; overflow: hidden; }
.scroll { overflow-x: auto; }
table { border-collapse: collapse; width: 100%; font-size: 13.5px; }
th, td { text-align: left; padding: 10px 14px; border-bottom: 1px solid var(--line); vertical-align: top; }
th { font-size: 11.5px; text-transform: uppercase; letter-spacing: 0.06em; color: var(--smoke); font-weight: 500; }
tr:last-child td { border-bottom: 0; }
td.n { text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; }
.sev { display: inline-block; border-radius: 99px; padding: 1px 9px; font-size: 12px; font-weight: 500; white-space: nowrap; }
.sev.error { background: var(--error-soft); color: var(--error); } .sev.warn { background: var(--warn-soft); color: var(--warn); } .sev.info, .sev.ok { background: var(--ok-soft); color: var(--ok); }
.rule-title { font-weight: 700; } .rule-id { color: var(--smoke); }
.why { color: var(--slate); }
button.linkish { all: unset; cursor: pointer; color: var(--accent); font-weight: 700; font-variant-numeric: tabular-nums; }
button.linkish:focus-visible, .chip:focus-visible, summary:focus-visible, select:focus-visible, input:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; border-radius: 6px; }
.filters { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }
.chip { border: 1px solid var(--line); background: var(--surface); color: var(--ink); border-radius: 99px; padding: 6px 14px; font: inherit; font-size: 13.5px; cursor: pointer; }
.chip[aria-pressed="true"] { border-color: var(--accent); background: var(--accent-soft); color: var(--accent); font-weight: 500; }
select, input[type="search"] { font: inherit; font-size: 13.5px; color: var(--ink); background: var(--surface); border: 1px solid var(--line); border-radius: 12px; padding: 6px 10px; min-width: 0; }
input[type="search"] { flex: 1 1 200px; }
.count { color: var(--slate); font-size: 13px; }
.markets { display: grid; gap: 8px; }
details.m { background: var(--surface); border: 1px solid var(--line); border-radius: 16px; overflow: hidden; }
details.m > summary { list-style: none; cursor: pointer; display: grid; grid-template-columns: 6px 1fr auto; gap: 12px; align-items: center; padding: 12px 16px 12px 0; }
details.m > summary::-webkit-details-marker { display: none; }
.stripe { align-self: stretch; border-radius: 0 4px 4px 0; background: var(--ok); }
.stripe.error { background: var(--error); } .stripe.warn { background: var(--warn); }
.m-title { font-weight: 700; min-width: 0; } .m-sub { color: var(--slate); font-size: 12.5px; }
.tags { display: flex; flex-wrap: wrap; gap: 4px; justify-content: flex-end; max-width: 420px; }
.tag { font-size: 11.5px; border-radius: 99px; padding: 1px 8px; white-space: nowrap; }
.tag.error { background: var(--error-soft); color: var(--error); } .tag.warn { background: var(--warn-soft); color: var(--warn); } .tag.info { background: var(--ok-soft); color: var(--ok); }
.body { padding: 4px 16px 18px 22px; display: grid; gap: 16px; border-top: 1px solid var(--line); }
.findings { display: grid; gap: 8px; margin: 12px 0 0; padding: 0; list-style: none; }
.findings li { display: grid; grid-template-columns: auto 1fr; gap: 10px; align-items: baseline; }
.findings .fr { font-weight: 500; }
.findings .fo { color: var(--smoke); font-size: 12.5px; }
.charts { display: grid; grid-template-columns: repeat(auto-fit, minmax(300px, 1fr)); gap: 16px; }
.chart { min-width: 0; }
.chart h3 { font-size: 12px; text-transform: uppercase; letter-spacing: 0.06em; color: var(--smoke); font-weight: 500; margin: 0 0 6px; }
.chart svg { width: 100%; height: auto; display: block; }
.legend { display: flex; flex-wrap: wrap; gap: 4px 14px; font-size: 12.5px; color: var(--slate); margin-top: 6px; }
.legend i { display: inline-block; width: 10px; height: 3px; border-radius: 2px; margin-right: 6px; vertical-align: middle; }
.positions { font-size: 13px; }
.positions td { padding: 7px 10px; }
.empty { padding: 28px; text-align: center; color: var(--slate); }
.rej { color: var(--slate); font-size: 13.5px; }
.rej summary { cursor: pointer; color: var(--accent); }
@media (max-width: 640px) { details.m > summary { grid-template-columns: 6px 1fr; } .tags { grid-column: 2; justify-content: flex-start; } h1 { font-size: 25px; } }
@media (prefers-reduced-motion: reduce) { * { transition: none !important; } }
</style>
</head>
<body>
<div class="wrap">
  <header>
    <h1>Contour market QC</h1>
    <div class="meta" id="meta"></div>
  </header>
  <div class="stats" id="stats"></div>
  <section>
    <h2>Rules</h2>
    <div class="panel scroll"><table id="rules"><thead><tr><th>Rule</th><th>Severity</th><th>What it checks · why it matters</th><th style="text-align:right">Markets</th></tr></thead><tbody></tbody></table></div>
  </section>
  <section>
    <h2>Markets</h2>
    <div class="filters" role="group" aria-label="Filter markets">
      <button class="chip" data-sev="all" aria-pressed="true">All</button>
      <button class="chip" data-sev="error" aria-pressed="false">Errors</button>
      <button class="chip" data-sev="warn" aria-pressed="false">Warnings only</button>
      <button class="chip" data-sev="ok" aria-pressed="false">Clean</button>
      <select id="cat" aria-label="Category"></select>
      <select id="rule" aria-label="Rule"></select>
      <input type="search" id="q" placeholder="Search title or ticker" aria-label="Search markets">
    </div>
    <div class="count" id="count"></div>
    <div class="markets" id="markets"></div>
    <details class="rej" id="rej"></details>
  </section>
</div>
<script type="application/json" id="data">${json}</script>
<script>
const D = JSON.parse(document.getElementById("data").textContent);
const RULE = Object.fromEntries(D.rules.map(r => [r.id, r]));
const RANK = { error: 0, warn: 1, info: 2, ok: 3 };
const OUT = { higher: "Higher", lower: "Lower", near: "Stays near", move: "Big move" };
const esc = s => String(s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
const worst = r => r.findings.reduce((w, f) => RANK[f.severity] < RANK[w] ? f.severity : w, "ok");
const level = r => { const w = worst(r); return w === "info" ? "ok" : w; };
D.results.forEach(r => r.level = level(r));
const pct = x => Math.round(x * 100) + "%";

// Header and summary
const when = new Date(D.startedAt);
document.getElementById("meta").textContent = "Live Gemini data from " + when.toLocaleString() + (D.books ? " · order books checked" : " · order books not checked") + " · $100 stake, confidence 25 / 50 / 75 / 100%";
const n = l => D.results.filter(r => r.level === l).length;
const rejTotal = Object.values(D.rejected).reduce((a, b) => a + b, 0);
document.getElementById("stats").innerHTML = [
  ["", D.results.length, "listed markets checked"],
  ["err", n("error"), "with errors"],
  ["warn", n("warn"), "with warnings only"],
  ["ok", n("ok"), "clean"],
  ["", rejTotal, "events not listed"],
].map(([c, v, t]) => '<div class="stat ' + c + '"><b class="tnum">' + v + '</b><span>' + t + '</span></div>').join("");

// Rules table
const hits = id => D.results.filter(r => r.findings.some(f => f.rule === id)).length;
document.querySelector("#rules tbody").innerHTML = D.rules.map(r =>
  '<tr><td><div class="rule-title">' + esc(r.title) + '</div><div class="rule-id mono">' + r.id + '</div></td>' +
  '<td><span class="sev ' + r.severity + '">' + r.severity + '</span></td>' +
  '<td>' + esc(r.check) + '<div class="why">' + esc(r.why) + '</div></td>' +
  '<td class="n">' + (hits(r.id) ? '<button class="linkish" data-rule="' + r.id + '">' + hits(r.id) + '</button>' : '<span style="color:var(--smoke)">0</span>') + '</td></tr>').join("");

// Filters
const state = { sev: "all", cat: "", rule: "", q: "" };
const cats = [...new Set(D.results.map(r => r.category))].sort();
document.getElementById("cat").innerHTML = '<option value="">All categories</option>' + cats.map(c => '<option>' + esc(c) + '</option>').join("");
document.getElementById("rule").innerHTML = '<option value="">Any rule</option>' + D.rules.filter(r => hits(r.id)).map(r => '<option value="' + r.id + '">' + esc(r.title) + '</option>').join("");
document.querySelectorAll(".chip").forEach(b => b.addEventListener("click", () => { state.sev = b.dataset.sev; document.querySelectorAll(".chip").forEach(x => x.setAttribute("aria-pressed", String(x === b))); render(); }));
document.getElementById("cat").addEventListener("change", e => { state.cat = e.target.value; render(); });
document.getElementById("rule").addEventListener("change", e => { state.rule = e.target.value; render(); });
document.getElementById("q").addEventListener("input", e => { state.q = e.target.value.toLowerCase().trim(); render(); });
document.querySelectorAll("button[data-rule]").forEach(b => b.addEventListener("click", () => {
  state.rule = b.dataset.rule; document.getElementById("rule").value = b.dataset.rule;
  state.sev = "all"; document.querySelectorAll(".chip").forEach(x => x.setAttribute("aria-pressed", String(x.dataset.sev === "all")));
  render(); document.getElementById("markets").scrollIntoView({ behavior: "smooth", block: "start" });
}));

// Charts
const W = 360, H = 150, PL = 40, PR = 8, PT = 8, PB = 26;
function axisLabels(r) {
  const k = r.bucketLabels.length, idx = [0, Math.floor((k - 1) / 2), k - 1];
  return idx.map(i => ({ i, t: r.bucketLabels[i].length > 18 ? r.bucketLabels[i].slice(0, 17) + "…" : r.bucketLabels[i] }));
}
function curveChart(r) {
  const k = r.marketProb.length, max = Math.max(...r.marketProb, 0.01), bw = (W - PL - PR) / k;
  const y = v => PT + (H - PT - PB) * (1 - v / max);
  let s = '<svg viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="Market curve">';
  [0, max / 2, max].forEach(v => { s += '<line x1="' + PL + '" x2="' + (W - PR) + '" y1="' + y(v) + '" y2="' + y(v) + '" stroke="var(--line)"/><text x="' + (PL - 6) + '" y="' + (y(v) + 4) + '" text-anchor="end" font-size="10" fill="var(--smoke)">' + pct(v) + '</text>'; });
  r.marketProb.forEach((p, j) => { s += '<rect x="' + (PL + j * bw + 1) + '" y="' + y(p) + '" width="' + Math.max(1, bw - 2) + '" height="' + (H - PB - y(p)) + '" rx="1.5" fill="var(--accent)" opacity="0.75"><title>' + esc(r.bucketLabels[j]) + ': ' + (p * 100).toFixed(1) + '%</title></rect>'; });
  axisLabels(r).forEach(({ i, t }, n) => { s += '<text x="' + (PL + (i + 0.5) * bw) + '" y="' + (H - 8) + '" text-anchor="' + (n === 0 ? "start" : n === 2 ? "end" : "middle") + '" font-size="10" fill="var(--smoke)">' + esc(t) + '</text>'; });
  return s + '</svg>';
}
function payoutChart(r, conf) {
  const runs = r.runs.filter(x => x.c === conf);
  const k = r.marketProb.length, max = Math.max(110, ...runs.flatMap(x => x.p)), bw = (W - PL - PR) / k;
  const y = v => PT + (H - PT - PB) * (1 - v / max), x = j => PL + (j + 0.5) * bw;
  let s = '<svg viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="What each outlook pays">';
  [0, max / 2, max].forEach(v => { s += '<line x1="' + PL + '" x2="' + (W - PR) + '" y1="' + y(v) + '" y2="' + y(v) + '" stroke="var(--line)"/><text x="' + (PL - 6) + '" y="' + (y(v) + 4) + '" text-anchor="end" font-size="10" fill="var(--smoke)">$' + Math.round(v) + '</text>'; });
  s += '<line x1="' + PL + '" x2="' + (W - PR) + '" y1="' + y(100) + '" y2="' + y(100) + '" stroke="var(--smoke)" stroke-dasharray="3 3"/>';
  runs.forEach((run, n) => {
    const col = OUT[run.o] ? "var(--o-" + run.o + ")" : (n ? "var(--o-lower)" : "var(--o-higher)");
    const dash = n === 0 ? "" : n === 1 ? "6 3" : n === 2 ? "2 3" : "8 3 2 3";
    s += '<polyline fill="none" stroke="' + col + '" stroke-width="2" stroke-dasharray="' + dash + '" stroke-linejoin="round" points="' + run.p.map((v, j) => x(j) + "," + y(v)).join(" ") + '"/>';
  });
  axisLabels(r).forEach(({ i, t }, n) => { s += '<text x="' + x(i) + '" y="' + (H - 8) + '" text-anchor="' + (n === 0 ? "start" : n === 2 ? "end" : "middle") + '" font-size="10" fill="var(--smoke)">' + esc(t) + '</text>'; });
  s += '</svg><div class="legend">' + runs.map((run, n) => '<span><i style="background:' + (OUT[run.o] ? "var(--o-" + run.o + ")" : (n ? "var(--o-lower)" : "var(--o-higher)")) + '"></i>' + esc(OUT[run.o] || run.o.replace(/^more:/, "More likely: ")) + '</span>').join("") + '<span><i style="background:var(--smoke)"></i>$100 stake</span></div>';
  return s;
}
function detail(r) {
  const fs = [...r.findings].sort((a, b) => RANK[a.severity] - RANK[b.severity]);
  const list = fs.length ? '<ul class="findings">' + fs.map(f =>
    '<li><span class="sev ' + f.severity + '">' + f.severity + '</span><div><span class="fr">' + esc(RULE[f.rule]?.title || f.rule) + '</span>' +
    (f.outlook ? ' <span class="fo">· ' + esc(f.outlook === "higher+lower" ? "Higher vs Lower" : (OUT[f.outlook] || f.outlook.replace(/^more:/, "More likely: "))) + (f.confidences?.length ? " at " + f.confidences.map(pct).join(", ") : "") + '</span>' : "") +
    '<div>' + esc(f.detail) + '</div></div></li>').join("") + '</ul>' : '<p class="why">No findings.</p>';
  const conf = 0.5;
  const pos = r.runs.filter(x => x.c === conf).map(x => '<tr><td>' + esc(OUT[x.o] || x.o.replace(/^more:/, "More likely: ")) + '</td><td>' + (x.t ? esc(x.z) : '<span class="why">no trade</span>') + '</td><td>' + (x.legs.length ? x.legs.map(esc).join("<br>") : "—") + '</td></tr>').join("");
  const firm = r.quotes.filter(q => q.f).length, locked = r.quotes.filter(q => q.c && q.k).length;
  return list +
    '<div class="charts"><div class="chart"><h3>Market curve · ' + firm + ' of ' + r.quotes.length + ' contracts firmly priced' + (locked ? ', ' + locked + ' locked' : '') + '</h3>' + curveChart(r) + '</div>' +
    '<div class="chart"><h3>What you make at 50% confidence</h3>' + payoutChart(r, conf) + '</div></div>' +
    '<div class="panel scroll positions"><table><thead><tr><th>Outlook</th><th>Makes money</th><th>Buys (50% confidence)</th></tr></thead><tbody>' + pos + '</tbody></table></div>';
}
function render() {
  const rows = D.results.filter(r =>
    (state.sev === "all" || r.level === state.sev) && (!state.cat || r.category === state.cat) &&
    (!state.rule || r.findings.some(f => f.rule === state.rule)) &&
    (!state.q || (r.title + " " + r.ticker).toLowerCase().includes(state.q)))
    .sort((a, b) => RANK[a.level] - RANK[b.level] || b.findings.filter(f => f.severity === "error").length - a.findings.filter(f => f.severity === "error").length || (b.volume || 0) - (a.volume || 0));
  document.getElementById("count").textContent = rows.length + " of " + D.results.length + " markets";
  const el = document.getElementById("markets");
  if (!rows.length) { el.innerHTML = '<div class="panel empty">No markets match these filters.</div>'; return; }
  el.innerHTML = rows.map((r, i) => {
    const ids = [...new Set(r.findings.map(f => f.rule))].sort((a, b) => RANK[RULE[a]?.severity] - RANK[RULE[b]?.severity]);
    return '<details class="m" data-i="' + D.results.indexOf(r) + '"><summary><span class="stripe ' + r.level + '"></span><div style="min-width:0"><div class="m-title">' + esc(r.title) + '</div><div class="m-sub"><span class="mono">' + esc(r.ticker) + '</span> · ' + esc(r.category) + ' · ' + r.kind + ' · settles ' + new Date(r.expiry).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) + '</div></div>' +
      '<div class="tags">' + (ids.length ? ids.map(id => '<span class="tag ' + (RULE[id]?.severity || "info") + '">' + esc(id) + '</span>').join("") : '<span class="tag info">clean</span>') + '</div></summary><div class="body"></div></details>';
  }).join("");
  el.querySelectorAll("details.m").forEach(d => d.addEventListener("toggle", () => { const b = d.querySelector(".body"); if (d.open && !b.innerHTML) b.innerHTML = detail(D.results[+d.dataset.i]); }));
}
render();
const rej = Object.entries(D.rejected).sort((a, b) => b[1] - a[1]);
document.getElementById("rej").innerHTML = '<summary>' + rejTotal + ' active events are never listed (rejected before QC)</summary><div class="panel scroll" style="margin-top:8px"><table><tbody>' + rej.map(([k, v]) => '<tr><td>' + esc(k) + '</td><td class="n">' + v + '</td></tr>').join("") + '</tbody></table></div>';
</script>
</body>
</html>`;
}

// Run on its own: re-render the newest JSON in data/qc.
if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const dir = resolve(import.meta.dirname, "../../../data/qc");
  const latest = readdirSync(dir).filter((f) => /^qc-.*\.json$/.test(f)).sort().pop();
  if (!latest) throw new Error("No QC results in data/qc yet: run pnpm --filter @contour/desk qc first.");
  const out = resolve(dir, latest.replace(/\.json$/, ".html"));
  writeFileSync(out, renderQcReport(JSON.parse(readFileSync(resolve(dir, latest), "utf8"))));
  console.log(out);
}
