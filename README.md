# MyIDM

Windows-first personal download manager built with **Electron**, **React**, and **TypeScript**. Queue direct URLs, segmented range downloads when supported, pause/resume, and a persisted job list.


## Requirements

- Node.js 20+ (recommended)
- npm 10+

## Install and run (development)

```bash
npm install
npm run dev
```

Make sure port **5173** is free — Vite uses a fixed port for the renderer in dev.

## Build (production assets)

```bash
npm run build
```

## Windows installer

```bash
npm run package
```

Outputs under `release/`, including **`MyIDM Setup <version>.exe`** (NSIS).  
If packaging fails on symlink permissions, the project sets `win.signAndEditExecutable: false` in `package.json` so you can build without admin rights.

## Limitations

- **No automatic HTTP redirects** — use the final direct URL when a host uses 302 chains.
- Hosts that require **browser cookies**, complex auth, or non-standard APIs may not work with a pasted URL alone.

## Scripts

| Script            | Purpose                          |
|-------------------|----------------------------------|
| `npm run dev`     | Vite + main watch + Electron     |
| `npm run build`   | Renderer + main TypeScript build |
| `npm run package` | Build + `electron-builder` (win) |
| `npm test`        | Minimal smoke tests              |

## License

MIT — see `package.json`.
