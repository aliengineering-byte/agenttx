# Record the 10–20 second demo

The production package has no recording dependency. Build first, use a terminal at least 100 columns wide, and record this deterministic local command:

```bash
npm ci
npm run build
npm run demo
```

For a tight launch edit, show these beats from the actual output:

1. `agenttx demo` and the agent's short edit list;
2. `BLOCKED` beside the safely simulated `git push`;
3. `INSPECT`, `7 files changed`, and `Risk HIGH`;
4. `ROLLBACK` and `Original workspace unchanged`.

Target 10–20 seconds at 1.25–1.5× playback. Do not type into a real repository or configure a remote. Do not replace output with a mock: the checked-in `agenttx-demo.svg` is only a static representation of this real deterministic flow.

An asciinema-compatible capture can be made without changing package dependencies:

```bash
asciinema rec --command "npm run demo" agenttx-demo.cast
```

Review the cast for terminal paths or environment data before conversion or upload. The intended public frame is 1200×760, dark neutral background, monospace text, green for accepted/unchanged state, red for blocked state, and no gradients.
