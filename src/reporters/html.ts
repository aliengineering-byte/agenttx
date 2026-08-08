import { readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { EventLedger } from "../core/ledger.js";
import type { TransactionInspection } from "../core/types.js";

function escapeHtml(value: unknown): string {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

export async function generateHtmlReport(
  inspection: TransactionInspection,
  outputPath?: string
): Promise<string> {
  const events = await new EventLedger(inspection.metadata.transactionDirectory).read();
  const destination = resolve(outputPath ?? join(inspection.metadata.transactionDirectory, "report.html"));
  const changedFiles = inspection.diff.files
    .map((file) => `<li><span class="badge ${file.kind}">${escapeHtml(file.kind)}</span><code>${escapeHtml(file.oldPath ? `${file.oldPath} → ${file.path}` : file.path)}</code></li>`)
    .join("");
  const sideEffects = inspection.sideEffects.length
    ? inspection.sideEffects.map((item) => `<li><strong>${item.blocked ? "Blocked" : "Allowed"}</strong> — ${escapeHtml(item.reason)}<small>${escapeHtml(item.evidence)}</small></li>`).join("")
    : "<li>None detected by V0 heuristics</li>";
  const riskReasons = inspection.risk.reasons.length
    ? inspection.risk.reasons.map((item) => `<li>+${item.points} ${escapeHtml(item.reason)}</li>`).join("")
    : "<li>No scoring rules triggered</li>";
  const verification = inspection.verification.checks.length
    ? inspection.verification.checks.map((item) => `<li><span class="status ${item.status}">${escapeHtml(item.status)}</span><code>${escapeHtml(`${item.command} ${item.args.join(" ")}`)}</code></li>`).join("")
    : "<li>No common checks detected</li>";
  const timeline = events.map((event) => `<li><time>${escapeHtml(event.timestamp)}</time><strong>${escapeHtml(event.type)}</strong><span>#${event.seq}</span></li>`).join("");
  const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>AgentTX ${escapeHtml(inspection.metadata.transactionId)}</title>
<style>
:root{color-scheme:dark;--bg:#090b10;--panel:#121722;--line:#263044;--text:#eef3ff;--muted:#8e9ab2;--green:#4ade80;--red:#fb7185;--amber:#fbbf24;--cyan:#22d3ee}*{box-sizing:border-box}body{margin:0;background:radial-gradient(circle at top right,#172340 0,transparent 35%),var(--bg);color:var(--text);font:15px/1.55 ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif}.wrap{width:min(1120px,calc(100% - 32px));margin:52px auto}.eyebrow{color:var(--cyan);font-weight:700;letter-spacing:.14em;text-transform:uppercase}h1{font-size:clamp(34px,7vw,72px);line-height:1;margin:12px 0}h2{margin:0 0 16px;font-size:18px}.muted,small,time{color:var(--muted)}.grid{display:grid;grid-template-columns:repeat(12,1fr);gap:16px;margin-top:28px}.card{grid-column:span 6;background:linear-gradient(145deg,rgba(23,30,44,.96),rgba(14,18,27,.96));border:1px solid var(--line);border-radius:18px;padding:22px;box-shadow:0 18px 50px rgba(0,0,0,.22)}.hero{grid-column:span 12;display:flex;justify-content:space-between;align-items:end}.metric{font-size:36px;font-weight:750}.risk{color:var(--amber)}ul{list-style:none;padding:0;margin:0}li{padding:9px 0;border-bottom:1px solid rgba(38,48,68,.6)}li:last-child{border:0}code{color:#d9e4ff}small{display:block;margin:4px 0 0 90px}.badge,.status{display:inline-block;min-width:78px;margin-right:12px;padding:2px 8px;border-radius:999px;text-align:center;font-size:12px;text-transform:uppercase;background:#263044}.added,.passed{color:var(--green)}.deleted,.failed,.blocked{color:var(--red)}.detected{color:var(--amber)}.timeline li{display:grid;grid-template-columns:1fr 1fr auto;gap:14px}.footer{margin:20px 2px;color:var(--muted)}@media(max-width:760px){.card{grid-column:span 12}.hero{align-items:start;flex-direction:column}.timeline li{grid-template-columns:1fr}.timeline span{display:none}}
</style></head><body><main class="wrap"><div class="eyebrow">AgentTX transaction report</div><h1>${escapeHtml(inspection.metadata.transactionId)}</h1><div class="muted">Local report · no data transmitted</div>
<section class="grid"><article class="card hero"><div><h2>${escapeHtml(inspection.metadata.agent)}</h2><div class="muted">${escapeHtml(inspection.metadata.command.command)} · ${escapeHtml(inspection.metadata.status)}</div></div><div><div class="metric risk">${escapeHtml(inspection.risk.level)}</div><div class="muted">risk score ${inspection.risk.score}</div></div></article>
<article class="card"><h2>Changes</h2><div class="metric">${inspection.diff.filesChanged}</div><div><span style="color:var(--green)">+${inspection.diff.additions}</span> / <span style="color:var(--red)">−${inspection.diff.deletions}</span></div><ul>${changedFiles || "<li>No file changes</li>"}</ul></article>
<article class="card"><h2>Risk reasons</h2><ul>${riskReasons}</ul></article>
<article class="card"><h2>Side effects</h2><ul>${sideEffects}</ul></article>
<article class="card"><h2>Verification</h2><ul>${verification}</ul></article>
<article class="card" style="grid-column:span 12"><h2>Timeline</h2><ul class="timeline">${timeline}</ul></article></section>
<p class="footer">Heuristic side-effect detection is not an OS security boundary. Potential secret values are redacted.</p></main></body></html>`;
  await writeFile(destination, html, { mode: 0o600 });
  // Ensure the report remained readable after the atomic product model was rendered.
  await readFile(destination, "utf8");
  return destination;
}
