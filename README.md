# CDP Bridge — AI Browser Control via HTTP

A Chrome extension that exposes a local **HTTP API on `http://localhost:1232`** so AI agents (Claude Code, OpenCode, curl, scripts) can directly control any Chrome tab via the Chrome DevTools Protocol (CDP).

> **Using an MCP client?** See **[OPENCODE.md](OPENCODE.md)** — run `node install-mcp.js` to auto-register with OpenCode, Claude Code, Codex, Cursor, or Synara.
>
> **Other AI agents:** use the **[Command Palette](PALETTE.md)**. High-level named actions (`click`, `read_text`, `find`, `scroll`, `screenshot`, …) discoverable at runtime via `GET /palette`. The raw `POST /command` is a low-level escape hatch.

---

## Architecture

```
AI Agent (Claude Code / OpenCode / curl)
    │
    │  HTTP  http://localhost:1232
    ▼
HTTP Server  (host/host.js — Node.js built-in http)
    │
    │  Native Messaging  stdin/stdout
    ▼
Chrome Extension  (extension/background.js — MV3 service worker)
    │
    │  chrome.debugger API
    ▼
Chrome Tabs  (any open tab, fully automated)
```

**No WebSocket. No extra processes.** The extension connects to the host on startup and stays connected. An optional [MCP server](mcp-server.js) layer wraps the HTTP API for clients that speak the Model Context Protocol. Run `node install-mcp.js` to register it.

---

## One-Time Setup

### 1. Install Node.js
Download from https://nodejs.org (v18 or later — needed for built-in `fetch`).

### 2. Run the installer (Windows)
```
install.bat
```
This installs host npm dependencies, generates icons, writes the native host manifest, and registers the Windows registry key.

### 3. Load the extension in Chrome
1. Open `chrome://extensions`
2. Enable **Developer mode** (toggle, top-right)
3. Click **Load unpacked** → select the `extension/` folder
4. Copy the **Extension ID** shown under the extension card

### 4. Authorize the extension as a Native Messaging client
Pass your Extension ID to the installer:
```
node install.js --id YOUR_EXTENSION_ID_HERE
```
Or set it via environment variable:
```
set CDP_BRIDGE_EXT_ID=YOUR_EXTENSION_ID_HERE && node install.js
```
Then click the **reload icon (↺)** on the extension card in `chrome://extensions`.

### 5. Start the host
```
node host/host.js
```
Output: `[cdp-bridge] HTTP server listening on http://localhost:1232`

The extension connects automatically on load. Once the host is running and the extension is loaded, you are ready.

---

## HTTP API Reference

Base URL: `http://localhost:1232`

All responses are JSON. All POST bodies are JSON (`Content-Type: application/json`). CORS is open — any origin can call the API.

---

### GET /health

Liveness check.

**Response**
```json
{ "ok": true }
```

---

### GET /tabs

List all open Chrome tabs that the extension is attached to.

**Response**
```json
{
  "result": [
    { "tabId": 1, "url": "https://example.com", "title": "Example Domain", "attached": true },
    { "tabId": 2, "url": "https://google.com",  "title": "Google",          "attached": true }
  ]
}
```

Use `tabId` from this response in all subsequent `/command` calls.

---

### GET /palette

Returns the high-level **command catalog** — every action, its arguments, return shape, and an
example. Fetch this once and you know the entire high-level API. Full reference and examples in
**[PALETTE.md](PALETTE.md)**.

**Response**
```json
{ "actions": [ { "name": "click", "summary": "…", "args": [ … ], "returns": "{ clicked, x, y }", "example": { … } }, … ] }
```

---

### POST /action

Run one high-level palette command — **the recommended interface for AI agents.**

**Request body**
```json
{
  "tabId":  <number>,   // required — from GET /tabs
  "action": "<string>", // required — e.g. "click", "read_text", "find"
  "args":   { ... }     // action-specific (see PALETTE.md)
}
```

**Success** → `{ "result": { ... } }` · **Error** → `{ "error": "..." }` (HTTP 500/503).

Examples:
```bash
curl -X POST http://localhost:1232/action \
  -H "Content-Type: application/json" \
  -d '{"tabId":1,"action":"read_text","args":{"selector":"article"}}'

curl -X POST http://localhost:1232/action \
  -H "Content-Type: application/json" \
  -d '{"tabId":1,"action":"find","args":{"text":"Sign in"}}'
```

---

### POST /network

Read the recent CDP network trace captured for a tab. The extension automatically enables the
`Network` domain when it attaches to a tab and records a bounded in-memory log. XHR/fetch response
bodies are captured when Chrome makes them available.

**Request body**
```json
{
  "tabId":  <number>,
  "limit":  50,
  "onlyApi": true,
  "urlIncludes": "/api/",
  "includeBodies": true
}
```

All fields except `tabId` are optional. Useful filters:

- `onlyApi: true` returns only XHR/fetch requests.
- `type: "Script"` or `"XHR"` filters by CDP resource type.
- `urlIncludes` filters by URL substring.
- `includeBodies: false` returns metadata only.

**Response**
```json
{
  "result": {
    "entries": [
      {
        "requestId": "1234.5",
        "method": "GET",
        "url": "https://example.com/api/items",
        "type": "Fetch",
        "status": 200,
        "mimeType": "application/json",
        "initiator": { "type": "script", "stack": [] },
        "body": "{\"items\":[]}"
      }
    ],
    "count": 1,
    "total": 12
  }
}
```

Recommended workflow for studying frontend data loading:

```bash
node cdp-cli.js --network-clear 1
node cdp-cli.js --do 1 navigate "{\"url\":\"https://example.com\"}"
node cdp-cli.js --network 1 "{\"onlyApi\":true,\"limit\":25}"
```

---

### POST /network/clear

Clear recorded network entries before a fresh navigation or interaction.

```json
{ "tabId": 1 }
```

If `tabId` is omitted, all tab traces are cleared.

---

### POST /command

Execute any **raw CDP** command in a specific tab. Low-level escape hatch — prefer `/action` above.

**Request body**
```json
{
  "tabId":  <number>,   // required — from GET /tabs
  "method": "<string>", // required — CDP method, e.g. "Runtime.evaluate"
  "params": { ... }     // optional — CDP params object (defaults to {})
}
```

**Success response**
```json
{ "result": { ... } }  // CDP result object (method-specific)
```

**Error response** (HTTP 500 or 503)
```json
{ "error": "Tab not attached" }
```

---

## Quick-Start Examples (curl)

```bash
# Check the server is up
curl http://localhost:1232/health

# List open tabs
curl http://localhost:1232/tabs

# Navigate tab 1 to a URL
curl -X POST http://localhost:1232/command \
  -H "Content-Type: application/json" \
  -d '{"tabId":1,"method":"Page.navigate","params":{"url":"https://example.com"}}'

# Read the page title
curl -X POST http://localhost:1232/command \
  -H "Content-Type: application/json" \
  -d '{"tabId":1,"method":"Runtime.evaluate","params":{"expression":"document.title","returnByValue":true}}'

# Take a screenshot (returns base64 PNG)
curl -X POST http://localhost:1232/command \
  -H "Content-Type: application/json" \
  -d '{"tabId":1,"method":"Page.captureScreenshot","params":{"format":"png"}}'
```

---

## CDP Command Cookbook for AI Agents

Every action below is a single `POST /command` call unless noted.

### Navigate to URL
```json
{
  "method": "Page.navigate",
  "params": { "url": "https://example.com" }
}
```
The extension attaches the Page domain automatically. No `Page.enable` needed for navigation.

---

### Wait for page to finish loading
Poll with `Runtime.evaluate` until `document.readyState` is `"complete"`:
```json
{
  "method": "Runtime.evaluate",
  "params": { "expression": "document.readyState", "returnByValue": true }
}
```
Keep calling until `result.result.value === "complete"`.

---

### Read page text content
```json
{
  "method": "Runtime.evaluate",
  "params": {
    "expression": "document.body.innerText",
    "returnByValue": true
  }
}
```
Result: `result.result.value` is the visible text of the page.

---

### Execute arbitrary JavaScript
```json
{
  "method": "Runtime.evaluate",
  "params": {
    "expression": "window.location.href",
    "returnByValue": true
  }
}
```
For async code, set `"awaitPromise": true`:
```json
{
  "method": "Runtime.evaluate",
  "params": {
    "expression": "fetch('/api/data').then(r=>r.json())",
    "returnByValue": true,
    "awaitPromise": true
  }
}
```
Result value is at `result.result.value`.

---

### Find element position (for clicking)
```json
{
  "method": "Runtime.evaluate",
  "params": {
    "expression": "(() => { const el = document.querySelector('button#submit'); if (!el) return null; const r = el.getBoundingClientRect(); return { x: r.left + r.width/2, y: r.top + r.height/2 }; })()",
    "returnByValue": true
  }
}
```
Result: `result.result.value` → `{ "x": 640, "y": 380 }` (center of element).

Replace `'button#submit'` with any valid CSS selector. Returns `null` if not found.

---

### Click at coordinates
Three sequential calls — mouseMoved, mousePressed, mouseReleased (all on the same `x`, `y`):

**Step 1 — Move mouse**
```json
{
  "method": "Input.dispatchMouseEvent",
  "params": { "type": "mouseMoved", "x": 640, "y": 380, "button": "none" }
}
```

**Step 2 — Press mouse button**
```json
{
  "method": "Input.dispatchMouseEvent",
  "params": { "type": "mousePressed", "x": 640, "y": 380, "button": "left", "clickCount": 1 }
}
```

**Step 3 — Release mouse button**
```json
{
  "method": "Input.dispatchMouseEvent",
  "params": { "type": "mouseReleased", "x": 640, "y": 380, "button": "left", "clickCount": 1 }
}
```

**Workflow to click a button by selector:**
1. Get coordinates with `Runtime.evaluate` using `getBoundingClientRect()`
2. Send the three mouse events above using those coordinates

---

### Type text into a focused input
First click the input to focus it (using mouse events above), then:
```json
{
  "method": "Input.insertText",
  "params": { "text": "hello world" }
}
```

---

### Press a special key
```json
{
  "method": "Input.dispatchKeyEvent",
  "params": { "type": "keyDown", "key": "Enter", "code": "Enter", "keyCode": 13 }
}
```
Then a matching `keyUp`:
```json
{
  "method": "Input.dispatchKeyEvent",
  "params": { "type": "keyUp", "key": "Enter", "code": "Enter", "keyCode": 13 }
}
```

Common key mappings:

| Key      | `key`      | `code`      | `keyCode` |
|----------|-----------|-------------|-----------|
| Enter    | Enter     | Enter       | 13        |
| Tab      | Tab       | Tab         | 9         |
| Escape   | Escape    | Escape      | 27        |
| Backspace| Backspace | Backspace   | 8         |
| Delete   | Delete    | Delete      | 46        |
| ArrowUp  | ArrowUp   | ArrowUp     | 38        |
| ArrowDown| ArrowDown | ArrowDown   | 40        |
| ArrowLeft| ArrowLeft | ArrowLeft   | 37        |
| ArrowRight|ArrowRight| ArrowRight  | 39        |
| Space    | Space     | Space       | 32        |
| Home     | Home      | Home        | 36        |
| End      | End       | End         | 35        |

---

### Scroll the page
```json
{
  "method": "Runtime.evaluate",
  "params": {
    "expression": "window.scrollBy(0, 500)",
    "returnByValue": true
  }
}
```
`scrollBy(x_pixels, y_pixels)` — use positive y to scroll down, negative to scroll up.

Scroll to the very top:
```json
{ "expression": "window.scrollTo(0, 0)" }
```

Scroll to the very bottom:
```json
{ "expression": "window.scrollTo(0, document.body.scrollHeight)" }
```

---

### Take a screenshot
```json
{
  "method": "Page.captureScreenshot",
  "params": { "format": "png", "quality": 100 }
}
```
Response:
```json
{
  "result": {
    "data": "<base64-encoded PNG string>"
  }
}
```
Decode `result.data` from base64 to get the PNG bytes.

For JPEG (smaller):
```json
{ "format": "jpeg", "quality": 80 }
```

---

### Get all links on a page
```json
{
  "method": "Runtime.evaluate",
  "params": {
    "expression": "Array.from(document.querySelectorAll('a[href]')).map(a=>({text:a.innerText.trim(),href:a.href})).slice(0,50)",
    "returnByValue": true
  }
}
```
Result: `result.result.value` → array of `{ text, href }` objects.

---

### Fill and submit a form
```javascript
// Example: fill a search input and press Enter
// 1. Focus and fill the input
{ "method": "Runtime.evaluate", "params": { "expression": "document.querySelector('input[name=q]').focus()" } }
{ "method": "Input.insertText", "params": { "text": "my search query" } }

// 2. Press Enter to submit
{ "method": "Input.dispatchKeyEvent", "params": { "type": "keyDown", "key": "Enter", "code": "Enter", "keyCode": 13 } }
{ "method": "Input.dispatchKeyEvent", "params": { "type": "keyUp",   "key": "Enter", "code": "Enter", "keyCode": 13 } }
```

---

### Check if an element exists
```json
{
  "method": "Runtime.evaluate",
  "params": {
    "expression": "!!document.querySelector('.my-element')",
    "returnByValue": true
  }
}
```
Result: `result.result.value` is `true` or `false`.

---

### Wait for an element to appear (polling)
Poll this expression until `result.result.value` is `true`:
```json
{
  "method": "Runtime.evaluate",
  "params": {
    "expression": "!!document.querySelector('.results-loaded')",
    "returnByValue": true
  }
}
```
Recommended: poll every 500ms, timeout after 30 seconds.

---

### Get cookies for current page
```json
{
  "method": "Runtime.evaluate",
  "params": {
    "expression": "document.cookie",
    "returnByValue": true
  }
}
```

---

### Open a new tab
```json
{
  "method": "Runtime.evaluate",
  "params": {
    "expression": "window.open('https://example.com', '_blank')"
  }
}
```
Then call `GET /tabs` to get the new tab's `tabId`.

---

## Standard AI Agent Workflow

The recommended sequence for any browser automation task:

```
1.  GET  /tabs                    → discover tabId of the target tab
2.  POST /command Page.navigate   → navigate to starting URL
3.  POST /command Runtime.evaluate (poll readyState) → wait for load
4.  POST /command Runtime.evaluate → read page content / find elements
5.  POST /command Input.*         → interact (click, type, key press)
6.  POST /command Runtime.evaluate (poll) → wait for result
7.  POST /command Page.captureScreenshot → visually verify if needed
8.  Repeat steps 4-7 for each action
```

---

## CLI Tools

These are convenience wrappers around the HTTP API.

### cdp-cli.js — one-shot commands

```bash
# List tabs
node cdp-cli.js --tabs

# Execute a CDP method
node cdp-cli.js --exec <tabId> <Method.name> [paramsJSON]
# Example:
node cdp-cli.js --exec 1 Page.navigate '{"url":"https://example.com"}'

# Evaluate JavaScript
node cdp-cli.js --eval <tabId> <expression>
# Example:
node cdp-cli.js --eval 1 document.title
```

### cdp-shell.js — interactive REPL

```bash
node cdp-shell.js

# Commands inside the shell:
tabs              # list open tabs
use <id>          # select a tab as active
eval <js>         # run JS in the selected tab
navigate <url>    # navigate selected tab
help              # show command list
```

---

## Error Reference

| HTTP Status | `error` field | Cause |
|-------------|--------------|-------|
| 400 | `Invalid JSON body` | POST body is not valid JSON |
| 400 | `Body must include numeric tabId and method string` | Missing/wrong-type fields |
| 500 | `Tab not attached` | `tabId` exists but debugger isn't attached yet (retry after ~1s) |
| 500 | `<CDP error message>` | CDP command rejected by Chrome |
| 503 | `Extension did not respond within 30s` | Extension disconnected from host |
| 503 | `Extension did not respond within 30s` | Host started but extension not loaded/connected |

---

## File Structure

```
extension/
  background.js     Service worker — connects to host via Native Messaging,
                    executes CDP commands via chrome.debugger API; routes /action + /palette
  palette.js        High-level command palette — action registry (click, read_text, find,
                    screenshot, cursor, …) + self-describing catalog, loaded by background.js
  manifest.json     MV3 manifest — permissions: debugger, tabs, nativeMessaging, alarms
  popup.html/js     Extension popup — shows connection status and HTTP endpoint
  icons/            PNG icons (generated by install.js)

host/
  host.js           HTTP server (port 1232) + Native Messaging bridge
  nm.js             Native Messaging codec (4-byte LE length prefix + JSON)
  com.cdpbridge.host.json   Native Messaging host manifest (Windows)
  run-host.bat      Launcher — called by Chrome when extension connects
  package.json      No external dependencies (uses Node.js builtins only)
  test/
    nm.test.js      Unit tests for the NM codec

install.js          One-time installer (deps, icons, registry key)
install.bat         Windows launcher for install.js
cdp-cli.js          One-shot HTTP CLI wrapper (--palette, --do, --exec, --eval)
cdp-shell.js        Interactive REPL over HTTP
PALETTE.md          Command palette reference for AI agents (high-level actions)
```

---

## Notes for AI Agents

- **One tabId per session** — call `GET /tabs` once at the start, pick the tab you want, and use that `tabId` for all subsequent commands.
- **Navigation is async** — after `Page.navigate`, poll `Runtime.evaluate` with `document.readyState` until it returns `"complete"`.
- **Clicking requires coordinates** — use `Runtime.evaluate` + `getBoundingClientRect()` to get the center `(x, y)` of any element, then send three mouse events (moved → pressed → released).
- **Typing requires focus** — click the input element first, then use `Input.insertText` for regular text or `Input.dispatchKeyEvent` for special keys.
- **CDP results are nested** — for `Runtime.evaluate`, the JavaScript return value is at `result.result.value` (not `result.value`).
- **No authentication** — the server binds to `127.0.0.1` only by default (loopback). Any process on the machine can call it.
- **30-second timeout** — each command has a 30-second hard timeout. For long operations, break them into smaller steps.
- **Parallel tabs** — you can control multiple tabs simultaneously by sending concurrent requests with different `tabId` values.
