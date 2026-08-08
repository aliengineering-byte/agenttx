# V0 repository benchmark

These are single local samples, not broad performance claims. AgentTX V0 optimizes for correctness over workspace setup speed.

## Release measurement

Measured 2026-08-08 on Windows, Node.js 24.14.0, and Git 2.53.0.windows.3 using `npm run benchmark`:

| Fixture | File payload | Workspace setup | Bookkeeping | Diff | Rollback | Commit transaction setup | Commit apply |
|---:|---:|---:|---:|---:|---:|---:|---:|
| 100 files | 11,200 B | 3,335.34 ms | 342.83 ms | 158.20 ms | 190.11 ms | 2,225.29 ms | 464.33 ms |
| 1,000 files | 112,000 B | 14,587.92 ms | 297.21 ms | 160.01 ms | 335.58 ms | 6,552.54 ms | 610.38 ms |
| 10,000 files | 1,120,000 B | 10,686.54 ms | 438.79 ms | 252.51 ms | 1,111.58 ms | 11,895.37 ms | 1,461.01 ms |

`File payload` is the generated tracked-file content before Git metadata; it is not total on-disk repository size. Fixture generation and the baseline Git commit are excluded from the measured operations. The rollback transaction changes five files; the commit transaction accepts one file.

The 1,000-file setup sample was slower than the 10,000-file sample, demonstrating host and filesystem noise in one-shot measurements. Treat the results as scale smoke tests, not a monotonic performance curve. Repeated samples and percentiles belong in a future performance harness if setup speed becomes a real user blocker.

## What each metric means

- **Workspace setup:** capture baseline, independent `--no-hardlinks` clone, dirty-state overlay, and private baseline commit.
- **Bookkeeping:** finalize transaction artifacts after five edits.
- **Diff:** inspect the stored repository result.
- **Rollback:** remove the transaction workspace and finalize state.
- **Commit transaction setup:** create a separate fresh transaction used for acceptance measurement.
- **Commit apply:** conflict-check the touched path and accept it into the original working tree.

## Reproduce

```bash
npm ci
npm run build
npm run benchmark
```

Run one size while iterating:

```bash
npm run benchmark:quick
```

The roadmap records evaluated Git worktree, reflink, or copy-on-write setup as a post-launch optimization, not a reason to weaken V0 rollback and object-separation semantics.
