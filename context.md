# CDP Bridge — Project Context

## What It Is
Chrome extension + native messaging host that exposes an HTTP API (port 1232) for AI agents to control Chrome tabs via CDP.

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
- `host/host.js` — HTTP server (port 1232), bridges HTTP to native messaging
- `host/nm.js` — Native messaging protocol encoder/decoder
- `host/run-host.sh` — Linux launcher for native messaging
- `extension/background.js` — MV3 service worker, connects to host, manages debugger
- `extension/manifest.json` — MV3 manifest with debugger/tabs/nativeMessaging permissions
- `host/com.cdpbridge.host.json` — Native messaging host manifest (allowed_origins must match extension ID)

## Pending
- None — bridge is fully operational.
