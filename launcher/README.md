# Vision Dataset Studio Launcher

Lightweight cross-platform Tauri launcher for the existing local web app.

The launcher does not replace or modify the existing scripts. You can still use
`run.bat`, `run.sh`, or `start.sh` directly from the project root.

## What It Does

1. Finds the project root.
2. Starts the local backend quickly, preferring the existing `.venv` Python when available.
3. Falls back to the existing startup scripts through `scripts/run.bat` on Windows or
   `scripts/start.sh` on macOS/Linux.
4. Opens the Tauri WebView at `http://127.0.0.1:8100`.
5. Checks `origin/<branch>` for updates in the background after the page is reachable, and
   runs `git pull --ff-only` only when the worktree is clean. The current session keeps running;
   pulled updates are naturally used on the next launcher startup.

## Build

Install the Tauri prerequisites for your platform first:

- Node.js
- Rust
- Platform WebView dependencies

Then run from this `launcher` directory:

```bash
npm install
npm run build
```

For development:

```bash
npm run dev
```

## Environment Variables

- `VDS_REPO_ROOT`: override project root detection.
- `VDS_HOST`: backend host, default `127.0.0.1`.
- `VDS_PORT`: backend port, default `8100`.
- `VDS_SKIP_UPDATE=1`: skip git update check.
- `VDS_UPDATE_REMOTE`: git remote, default `origin`.
- `VDS_UPDATE_BRANCH`: git branch, default current branch or `main`.

## Notes

The launcher intentionally reuses the existing startup scripts so launcher
behavior stays close to normal script startup.
