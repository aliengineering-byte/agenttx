# AgentTX Proof Verifier Action

`AgentTX Proof Verifier` verifies a complete proof pack using the exact AgentTX npm release, fails closed on any mismatch, writes a concise Job Summary, and exposes paths for immutable artifact upload. It requests no permissions itself.

## Minimal workflow

```yaml
name: Verify proof
on: workflow_dispatch
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
          proof-json: proof/proof.json
      - uses: actions/upload-artifact@ea165f8d65b6e75b540449e92b4886f43607fa02 # v4
        with:
          name: agenttx-proof
          path: |
            ${{ steps.proof.outputs.proof-json-path }}
            ${{ steps.proof.outputs.proof-card-path }}
```

For a hardened workflow, replace `aliengineering-byte/agenttx@v0.3.0` with the immutable commit SHA associated with the signed-off v0.3.0 release. Do not guess or prefill that SHA before the release commit exists.

Outputs are `verdict`, `receipt-digest`, `proof-json-path`, `proof-card-path`, and `transaction-state`. The Action does not run an arbitrary agent, write PR comments, open a browser, or request write/id-token permissions.

`agenttx init --github` creates the minimal configuration and workflow only when both target files are absent. It does not push, open a PR, add a badge, or modify repository settings. `--badge owner/repository` prints—but does not write—an optional real workflow-status badge.

## Release order

1. Merge the reviewed code and pass the normal cross-platform CI matrix.
2. Create the immutable annotated Git tag and GitHub Release `v0.3.0` without moving earlier tags.
3. Let the release workflow publish `agenttx@0.3.0` with npm Trusted Publishing and provenance.
4. Run the independent downstream Action smoke repository against the release commit.
5. Edit the existing release, select **Publish this Action to the GitHub Marketplace** and the **Utilities** and **Continuous integration** categories, then publish only after any listing agreement/2FA owner boundary is satisfied.

The Action downloads the exact `agenttx@0.3.0` verifier through npm when no local verifier override is provided. This keeps the Marketplace runtime aligned with the independently installable package. GitHub-hosted runners therefore need npm registry access for this Action version; receipt verification by the installed CLI itself remains fully offline.
