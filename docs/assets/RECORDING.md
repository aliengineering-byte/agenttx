# Record the 13.8-second launch demo

The production package has no recording dependency. The checked-in launch workflow runs the real deterministic demo, validates the seven-file transaction and rollback evidence, rejects private machine paths, and renders a GitHub-ready GIF plus static PNG.

```powershell
npm ci
npm run build
./launch/RECORD_DEMO.ps1
```

The renderer uses Python plus Pillow only as an external recording tool; neither is an AgentTX runtime dependency. Pass explicit executables or a monospace font when they are not on `PATH`:

```powershell
./launch/RECORD_DEMO.ps1 -Node /path/to/node -Python /path/to/python -Font /path/to/mono.ttf
```

Outputs:

- `docs/assets/agenttx-demo.gif` — six staged frames, 13.8 seconds;
- `docs/assets/agenttx-demo.png` — static launch screenshot;
- `docs/assets/terminal-demo.txt` — privacy-safe transcript.

The script does not configure a remote or send network writes. The fake agent changes real files only inside AgentTX's generated temporary repository, and its simulated `git push origin main` is gated by AgentTX. Rendering begins only after the real CLI reports `REVIEW`, `HIGH (7)`, seven changed files, a blocked push, rollback, and an unchanged original workspace.

The intended public frame is 1200×760 with a dark neutral background, monospace text, green for successful rollback, red for the blocked action, and no gradients or machine-specific paths.
