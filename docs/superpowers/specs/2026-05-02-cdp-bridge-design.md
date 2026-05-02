# CDP Bridge — Design Spec
**Date:** 2026-05-02

## Overview

A Chrome extension that acts as a bridge between local AI tools and the live Chrome profile via the Chrome DevTools Protocol (CDP). The extension auto-spawns a Node.js WebSocket server on port 1232 using Native Messaging, allowing any AI client to send CDP commands and subscribe to CDP events against real open tabs — using the browser's existing cookies, sessions, and profile state.

---

## Architecture

```
AI Client  ──ws://localhost:1232──  Native Host (Node.js)  ──stdin/stdout──  Extension (background.js)  ──chrome.debugger──  Chrome Tabs
```

| Component | Responsibility |
|---|---|
| `extension/background.js` | Attaches `chrome.debugger` to all tabs; executes CDP commands; forwards CDP events |
| `host/host.js` | WebSocket server on port 1232; Native Messaging bridge; routes messages; manages subscriptions |
| `host/com.cdpbridge.host.json` | Native host manifest Chrome reads to know how to spawn `host.js` |
| `install.bat` | Runs `npm install`, writes manifest path to Windows registry, prints extension ID instructions |

### Startup Sequence

1. Chrome loads → extension service worker starts
2. Service worker calls `chrome.runtime.connectNative('com.cdpbridge.host')`
3. Chrome spawns `node host.js` as a child process
4. `host.js` opens WebSocket server on port 1232
5. Extension queries all open tabs → attaches `chrome.debugger` to each
6. AI connects to `ws://localhost:1232` — ready

---

## File Structure

```
dev-extension/
├── extension/
│   ├── manifest.json              # MV3, permissions: debugger, tabs, nativeMessaging
│   ├── background.js              # Service worker: NM connection, debugger attach, CDP relay
│   ├── popup.html                 # Status indicator (connected / disconnected)
│   ├── popup.js                   # Reads status from background via chrome.runtime.sendMessage
│   └── icons/
│       ├── icon16.png
│       ├── icon48.png
│       └── icon128.png
├── host/
│   ├── host.js                    # WebSocket server + Native Messaging bridge
│   ├── package.json               # One dependency: ws
│   └── com.cdpbridge.host.json    # Native host manifest (path filled in by install.bat)
└── install.bat                    # Setup: npm install, registry write, prints next steps
```

---

## Message Protocol

All messages are JSON over WebSocket. Every request from the AI includes an `id` for response matching.

### Execute a CDP command
```json
// AI → Host
{ "id": "1", "type": "command", "tabId": 123, "method": "Page.navigate", "params": { "url": "https://example.com" } }

// Host → AI (success)
{ "id": "1", "type": "result", "result": { "frameId": "ABC" } }

// Host → AI (error)
{ "id": "1", "type": "error", "error": "Tab not found" }
```

### Subscribe to a CDP event
```json
// AI → Host
{ "id": "2", "type": "subscribe", "tabId": 123, "event": "Network.requestWillBeSent" }

// Host → AI (pushed, no id)
{ "type": "event", "tabId": 123, "event": "Network.requestWillBeSent", "params": { ... } }
```

### List open tabs
```json
// AI → Host
{ "id": "3", "type": "tabs" }

// Host → AI
{ "id": "3", "type": "result", "result": [ { "tabId": 123, "url": "https://...", "title": "..." } ] }
```

### Native Messaging framing (extension ↔ host)
Standard Chrome Native Messaging format: 4-byte little-endian length prefix followed by UTF-8 JSON. The extension uses `chrome.runtime.connectNative` which handles framing automatically; `host.js` manually reads/writes the prefix on stdin/stdout.

---

## Error Handling & Edge Cases

| Scenario | Handling |
|---|---|
| Native host crashes | Service worker detects `onDisconnect`, retries `connectNative` with exponential backoff (1s, 2s, 4s, max 30s) |
| Extension service worker killed by Chrome | `chrome.alarms` heartbeat wakes the worker; reconnects to native host and re-attaches debugger to all tabs |
| Tab closed while debugger attached | `chrome.tabs.onRemoved` → remove tab from attached set; host clears subscriptions for that tabId |
| Tab navigates | Debugger stays attached; re-enabling domains is the AI's responsibility |
| AI client disconnects | Host drops all subscriptions for that WebSocket connection; pending command promises rejected |
| Command sent for unknown tabId | Extension returns `{ "type": "error", "error": "Tab not found" }` |
| Two AI clients subscribe to same event | Host fans out — both receive the event independently |
| `install.bat` run before extension loaded | Script prints: "Load extension in Chrome first, then update `allowed_origins` with your extension ID" |

---

## Installation Flow

1. Load `extension/` as an unpacked extension in `chrome://extensions`
2. Copy the extension ID shown in Chrome
3. Open `host/com.cdpbridge.host.json` and paste the ID into `allowed_origins`
4. Run `install.bat` — installs npm deps and registers the native host in `HKCU\Software\Google\Chrome\NativeMessagingHosts\com.cdpbridge.host`
5. Reload the extension — it auto-spawns the host and connects

No admin rights required (HKCU registry key).
