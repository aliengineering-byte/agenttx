import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { pathExists } from "../core/fs.js";

const CONFIG = `{
  "validators": [
    {
      "id": "tests",
      "argv": ["npm", "test"],
      "required": true,
      "shell": true
    }
  ],
  "relatedEvidence": []
}
`;

const WORKFLOW = `name: AgentTX Proof

on:
  workflow_dispatch:
    inputs:
      proof_json:
        description: Relative path to proof.json
        required: true
        default: proof/proof.json

permissions:
  contents: read

jobs:
  verify:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7
      - id: proof
        uses: aliengineering-byte/agenttx@v0.3.0
        with:
          proof-json: \${{ inputs.proof_json }}
      - uses: actions/upload-artifact@ea165f8d65b6e75b540449e92b4886f43607fa02 # v4
        with:
          name: agenttx-proof
          path: |
            \${{ steps.proof.outputs.proof-json-path }}
            \${{ steps.proof.outputs.proof-card-path }}
`;

export async function initializeGitHub(repositoryRoot: string): Promise<string[]> {
  const files = [
    { path: resolve(repositoryRoot, ".agenttx", "proof.json"), content: CONFIG },
    { path: resolve(repositoryRoot, ".github", "workflows", "agenttx-proof.yml"), content: WORKFLOW }
  ];
  const collisions = [];
  for (const item of files) if (await pathExists(item.path)) collisions.push(item.path);
  if (collisions.length) {
    throw new Error(`Refusing to overwrite existing files:\n${collisions.map((path) => `  ${path}`).join("\n")}`);
  }
  for (const item of files) {
    await mkdir(dirname(item.path), { recursive: true });
    await writeFile(item.path, item.content, { flag: "wx", mode: 0o600 });
  }
  return files.map((item) => item.path);
}

export function badgeSnippet(repository: string): string {
  const safe = repository.replace(/^https:\/\/github\.com\//, "").replace(/\.git$/, "");
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(safe)) throw new Error("Expected a GitHub owner/repository name.");
  const workflow = "agenttx-proof.yml";
  return `[![AgentTX Proof](https://github.com/${safe}/actions/workflows/${workflow}/badge.svg)](https://github.com/${safe}/actions/workflows/${workflow})`;
}
