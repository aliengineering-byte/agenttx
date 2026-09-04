import type { ProofArtifact, ProofReceipt } from "./types.js";

function html(value: unknown): string {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function markdownCode(value: string): string {
  return value.replaceAll("`", "\\`");
}

function commandLine(receipt: ProofReceipt): string {
  return ["agenttx", "proof", "--", ...receipt.reproduction.argv]
    .map((arg) => JSON.stringify(arg))
    .join(" ");
}

export function renderReproduction(receipt: ProofReceipt): string {
  return `# Reproduce AgentTX proof ${receipt.transaction.id}

Run from the repository root at base commit \`${markdownCode(receipt.repository.baseCommit)}\`.

\`\`\`text
${commandLine(receipt)}
\`\`\`

Exact argv boundaries:

\`\`\`json
${JSON.stringify(receipt.reproduction.argv, null, 2)}
\`\`\`

Verify the copied proof offline:

\`\`\`text
agenttx verify-proof proof.json
\`\`\`

${receipt.reproduction.note}

Limitations:
${receipt.limitations.map((item) => `- ${item}`).join("\n")}
`;
}

export function renderProofCard(artifact: ProofArtifact): string {
  const { proof, integrity } = artifact;
  const required = proof.validators.filter((item) => item.required);
  const tests = required.length === 0
    ? "No required validators declared"
    : required.every((item) => item.status === "passed")
      ? `${required.length} required validator${required.length === 1 ? "" : "s"} passed`
      : "Required validation failed";
  const rollback = proof.transaction.rollbackCompleted
    ? "Rollback completed"
    : proof.transaction.state === "REVIEW"
      ? "Rollback available"
      : "Rollback not available";
  const statusClass = proof.transaction.verdict === "PASS" ? "pass" : "reject";
  const files = proof.changes.files.length
    ? `<ul>${proof.changes.files.map((item) => `<li><span class="kind">${html(item.kind)}</span> ${html(item.path ?? "path withheld")}</li>`).join("")}</ul>`
    : `<p>${proof.changes.filesChanged === 0 ? "No Git-visible files changed." : "Changed paths withheld by privacy mode."}</p>`;
  const validators = proof.validators.length
    ? `<ul>${proof.validators.map((item) => `<li><strong>${html(item.status.toUpperCase())}</strong> ${html(item.id)}${item.required ? " · required" : " · optional"}</li>`).join("")}</ul>`
    : "<p>No validators declared.</p>";
  const related = proof.relatedEvidence.length
    ? `<ul>${proof.relatedEvidence.map((item) => `<li><strong>${html(item.verificationStatus.toUpperCase())}</strong> ${html(item.producer)} ${html(item.producerVersion)} · ${html(item.capability)}</li>`).join("")}</ul>`
    : "<p>No related evidence attached.</p>";
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light dark">
<title>AgentTX Proof · ${html(proof.transaction.verdict)}</title>
<style>
:root{font-family:ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color-scheme:light dark;--bg:#f6f7f9;--card:#fff;--text:#17202a;--muted:#566270;--line:#d6dbe1;--pass:#087f5b;--reject:#c92a2a;--code:#eef1f4}@media(prefers-color-scheme:dark){:root{--bg:#11151a;--card:#191f26;--text:#f2f4f7;--muted:#aab4c0;--line:#36414d;--pass:#63e6be;--reject:#ff8787;--code:#232b34}}*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--text);line-height:1.5}main,footer{width:min(920px,calc(100% - 32px));margin:32px auto}.hero,.panel{background:var(--card);border:1px solid var(--line);border-radius:16px;padding:clamp(20px,4vw,40px);margin-bottom:20px}.eyebrow{font-size:.78rem;font-weight:800;letter-spacing:.12em;text-transform:uppercase;color:var(--muted)}h1{font-size:clamp(3rem,10vw,6.5rem);line-height:.9;margin:.25em 0}.pass h1{color:var(--pass)}.reject h1{color:var(--reject)}.lede{font-size:1.25rem}.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:12px}.metric{border-top:3px solid var(--line);padding-top:10px}.metric strong{display:block;font-size:1.05rem}.metric span{color:var(--muted);font-size:.9rem}code{background:var(--code);border-radius:6px;padding:.15em .35em;overflow-wrap:anywhere}.digest{font-family:ui-monospace,SFMono-Regular,Consolas,monospace;word-break:break-all}.kind{display:inline-block;min-width:5.5rem;color:var(--muted)}h2{margin-top:0}a{color:inherit}footer{color:var(--muted);font-size:.88rem}ul{padding-left:1.25rem}@media print{body{background:#fff}.hero,.panel{break-inside:avoid}}
</style>
</head>
<body>
<main>
<section class="hero ${statusClass}" aria-labelledby="verdict">
<div class="eyebrow">AgentTX proof card</div>
<h1 id="verdict">${html(proof.transaction.verdict)}</h1>
<p class="lede">${html(proof.transaction.reason)}</p>
<div class="grid">
<div class="metric"><strong>${proof.changes.filesChanged} file${proof.changes.filesChanged === 1 ? "" : "s"}</strong><span>${proof.changes.additions} additions · ${proof.changes.deletions} deletions</span></div>
<div class="metric"><strong>${html(tests)}</strong><span>Claims ${proof.claims.derivedVerdict ? "derived from recorded outcomes" : "not verified"}</span></div>
<div class="metric"><strong>${html(rollback)}</strong><span>Terminal state: ${html(proof.transaction.state)}</span></div>
</div>
<p><strong>Evidence digest</strong><br><span class="digest">sha256:${html(integrity.digest)}</span></p>
<p><strong>Verify locally</strong><br><code>${html(proof.verificationCommand)}</code></p>
</section>
<section class="panel"><h2>What changed</h2>${files}</section>
<section class="panel"><h2>Validation</h2>${validators}</section>
<section class="panel"><h2>Related evidence</h2>${related}</section>
<section class="panel"><h2>Execution</h2><p><code>${html(JSON.stringify([proof.execution.command.command, ...proof.execution.command.args]))}</code></p><p>Exit ${proof.execution.exitCode} · ${html(proof.execution.terminationReason)} · ${proof.execution.durationMs} ms · shell ${proof.execution.shell ? "explicitly enabled" : "disabled"} · external effects ${proof.execution.externalSideEffectsAuthorized ? "explicitly authorized but not reversible" : "not authorized"}</p></section>
<section class="panel"><h2>Limitations</h2><ul>${proof.limitations.map((item) => `<li>${html(item)}</li>`).join("")}</ul></section>
</main>
<footer>Produced by AgentTX ${html(proof.agenttxVersion)} · <a href="https://github.com/aliengineering-byte/agenttx">source and documentation</a> · <a href="https://github.com/aliengineering-byte/agenttx/issues/new?template=feedback.yml">voluntary feedback</a> · no analytics, remote fonts, or tracking</footer>
</body>
</html>
`;
}
