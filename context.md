# CDP Bridge — Project Context

## What It Is
Chrome extension + native messaging host that exposes an HTTP API (port 1232) for AI agents to control Chrome tabs via CDP. A high-level **command palette** (`POST /action` + self-describing `GET /palette`) sits on top of the raw CDP pass-through (`POST /command`).

## Architecture
```
AI Agent → HTTP (localhost:1232) → host.js → Native Messaging (stdin/stdout) → Chrome Extension → chrome.debugger API → Chrome Tabs
```

## Current State
- **install.js**: Fixed for cross-platform (Linux/macOS/Windows). Creates `run-host.sh` on Linux, uses symlink to `~/.config/google-chrome/NativeMessagingHosts/` instead of Windows registry.
- **Host server**: Working — Chrome auto-spawns it via native messaging. HTTP API on port 1232 confirmed functional.
- **Extension**: Loaded in Chrome. Extension ID: `feobjlhjpdepdljoopcbinjdkbiedefa`.
- **Native messaging**: Manifest symlinked and working. `allowed_origins` updated to correct extension ID.
- **Tested**: Navigated to ChatGPT, typed questions, clicked send, read responses, took screenshots — all via CDP bridge.

## Key Files
- `install.js` — Cross-platform installer (npm deps, icons, manifest path, host registration)
- `host/host.js` — HTTP server (port 1232); routes `/health`, `/tabs`, `/palette`, `/action`, `/command`
- `host/nm.js` — Native messaging protocol encoder/decoder
- `host/run-host.sh` — Linux launcher for native messaging
- `extension/background.js` — MV3 service worker, connects to host, manages debugger, routes `action`/`palette`
- `extension/palette.js` — High-level command palette: action registry + catalog (loaded via importScripts)
- `extension/manifest.json` — MV3 manifest with debugger/tabs/nativeMessaging/storage permissions
- `host/com.cdpbridge.host.json` — Native messaging host manifest (allowed_origins must match extension ID)
- `PALETTE.md` — AI-facing command palette reference

## Command Palette
- `GET /palette` → catalog of every action (name, args, returns, example), generated from the registry in `palette.js`.
- `POST /action` `{ tabId, action, args }` → runs one named action atomically (e.g. `click`, `read_text`, `find`, `screenshot`).
- Targeting: `selector` (CSS) | `xpath` | `x,y`. Discover selectors with `find` / `list_interactive` / `selector_at`.
- Visual cursor: `set_cursor {enabled}` toggles an injected overlay; when on, pointer/type actions glide it. Default off.

## Pending
- None — bridge + command palette operational. (Reload the extension in chrome://extensions after pulling palette.js / background.js changes.)
