import { writeFile } from "node:fs/promises";

const destination = process.argv[2] ?? "gallery-site/adoption.json";
const headers = { "User-Agent": "agenttx-public-adoption-snapshot" };
if (process.env.GITHUB_TOKEN) headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;

async function json(url, authorized = false) {
  const response = await fetch(url, { headers: authorized ? headers : { "User-Agent": headers["User-Agent"] } });
  if (!response.ok) return null;
  return response.json();
}

const [agenttx, resilireplay, npmAgenttx, npmResiliReplay, actionReferences, rrRegistry, gmRegistry] = await Promise.all([
  json("https://api.github.com/repos/aliengineering-byte/agenttx", true),
  json("https://api.github.com/repos/aliengineering-byte/resilireplay", true),
  json("https://api.npmjs.org/downloads/point/last-week/agenttx"),
  json("https://api.npmjs.org/downloads/point/last-week/resilireplay"),
  json("https://api.github.com/search/code?q=%22aliengineering-byte%2Fagenttx%40%22+path%3A.github%2Fworkflows", true),
  json("https://registry.modelcontextprotocol.io/v0.1/servers?search=io.github.aliengineering-byte%2Fresilireplay"),
  json("https://registry.modelcontextprotocol.io/v0.1/servers?search=io.github.aliengineering-byte%2Fgaugemesh")
]);
const registryHas = (value, name) => Boolean(value?.servers?.some((entry) => (entry.server ?? entry).name === name));
const snapshot = {
  schemaVersion: "aeb.public-adoption.v1",
  capturedAt: new Date().toISOString(),
  primaryMetric: {
    name: "verified external proof runs",
    value: null,
    reason: "No telemetry is collected; only voluntarily public, independently observable runs can be counted."
  },
  publicAggregates: {
    agenttx: { npmDownloadsLastWeek: npmAgenttx?.downloads ?? null, stars: agenttx?.stargazers_count ?? null, forks: agenttx?.forks_count ?? null, openIssues: agenttx?.open_issues_count ?? null },
    resilireplay: { npmDownloadsLastWeek: npmResiliReplay?.downloads ?? null, stars: resilireplay?.stargazers_count ?? null, forks: resilireplay?.forks_count ?? null, openIssues: resilireplay?.open_issues_count ?? null },
    repositoriesReferencingAgenttxAction: actionReferences?.total_count ?? null,
    officialMcpRegistry: { resilireplay: registryHas(rrRegistry, "io.github.aliengineering-byte/resilireplay"), gaugemesh: registryHas(gmRegistry, "io.github.aliengineering-byte/gaugemesh") },
    ghcrPulls: null
  },
  limitations: [
    "Downloads, stars, forks, and references are public distribution signals, not unique users or successful proof runs.",
    "Bot traffic is not classified as adoption.",
    "GHCR does not expose a reliable anonymous aggregate pull count here."
  ]
};
await writeFile(destination, `${JSON.stringify(snapshot, null, 2)}\n`, "utf8");
console.log(JSON.stringify(snapshot));
