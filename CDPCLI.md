# CDP CLI — Browser Control for AI Agents

The CDP Bridge exposes an HTTP API on `localhost:1232`. The CLI (`cdp-cli.js`) is a thin
wrapper around that API so AI agents (and humans) can drive Chrome from the terminal.

---

## Quickstart

```bash
node cdp-cli.js --tabs                # see open tabs
node cdp-cli.js --palette             # list every palette action
node cdp-cli.js --do 5 read_text      # read page text
node cdp-cli.js --do 5 click '{"selector":"button#go"}'
```

---

## Commands

| Command | Purpose | Example |
|---|---|---|
| `--tabs` | List open tabs with IDs | `node cdp-cli.js --tabs` |
| `--palette` | List all available actions with args | `node cdp-cli.js --palette` |
| `--do <tabId> <action> [JSON]` | Run a palette action | `node cdp-cli.js --do 5 click {"selector":"#btn"}` |
| `--exec <tabId> <method> [JSON]` | Run a raw CDP method | `node cdp-cli.js --exec 5 Page.navigate {"url":"..."}` |
| `--eval <tabId> <expression>` | Run JS in the page context | `node cdp-cli.js --eval 5 "document.title"` |

### --do (palette actions)

Runs one high-level action from the palette. See `GET /palette` or `--palette` for the
complete catalog.

```bash
node cdp-cli.js --do 5 navigate '{"url":"https://example.com"}'
node cdp-cli.js --do 5 click '{"selector":"#submit"}'
node cdp-cli.js --do 5 type '{"text":"hello world","selector":"input[name=q]"}'
node cdp-cli.js --do 5 read_text '{"selector":"article"}'
node cdp-cli.js --do 5 screenshot '{"fullPage":true}'
node cdp-cli.js --do 5 find '{"text":"Sign in"}'
```

### --exec (raw CDP)

For anything the palette doesn't cover, send raw CDP commands:

```bash
node cdp-cli.js --exec 5 Page.navigate '{"url":"https://example.com"}'
node cdp-cli.js --exec 5 Runtime.evaluate '{"expression":"2+2","returnByValue":true}'
node cdp-cli.js --exec 5 Emulation.setGeolocationOverride '{"latitude":48.8566,"longitude":2.3522,"accuracy":100}'
```

### --eval (quick JavaScript)

Shorthand for `Runtime.evaluate`. Good for quick probes:

```bash
node cdp-cli.js --eval 5 "document.title"
node cdp-cli.js --eval 5 "navigator.userAgent"
node cdp-cli.js --eval 5 "document.querySelector('textarea')?.placeholder"
```

---

## JSON Argument Formats

The CLI accepts three formats for JSON arguments. **Use `@file` or `-` on Windows** to
avoid PowerShell quoting issues.

### 1. Inline JSON (simplest on Linux/macOS)

```bash
node cdp-cli.js --do 5 click '{"selector":"button#go"}'
```

**Windows/PowerShell caveat:** PowerShell strips double-quotes from arguments before
passing them to the process. The inline form `'{"key":"val"}'` arrives as `{key:val}` —
unparseable JSON. Avoid inline JSON on Windows.

### 2. File reference: `@file.json` (works everywhere)

Write your JSON to a file, then reference it with `@`:

```bash
echo {"url":"https://example.com"} > args.json
node cdp-cli.js --do 5 navigate @args.json
```

The JSON file is read synchronously by `cdp-cli.js`, so there is no quoting problem.
This is the **recommended approach on all platforms** for any nontrivial JSON.

### 3. Stdin pipe: `-` (works everywhere)

Pipe JSON via stdin:

**Linux/macOS:**
```bash
echo '{"url":"https://example.com"}' | node cdp-cli.js --do 5 navigate -
```

**Windows PowerShell:**
```powershell
$json = '{"url":"https://example.com"}'
$json | node cdp-cli.js --do 5 navigate -
```

Or with a here-string:
```powershell
@'
{"url":"https://example.com"}
'@ | node cdp-cli.js --do 5 navigate -
```

---

## Windows PowerShell Survival Guide

PowerShell 5.1 mangles inline JSON — it strips `"` from arguments. Never use inline
JSON on Windows. Use one of these instead:

### Method A: `@file` (cleanest)

```powershell
# Write JSON to a temp file
"{`"url`":`"https://example.com`"}" | Out-File -Encoding utf8 _args.json
node cdp-cli.js --do 5 navigate @_args.json
Remove-Item _args.json
```

### Method B: stdin pipe (best for automation)

```powershell
'{"url":"https://example.com"}' | node cdp-cli.js --do 5 navigate -
```

### Method C: `--%` stop-parsing (escape-hatch)

PowerShell's `--%` token tells it to stop interpreting and pass everything literally:

```powershell
node cdp-cli.js --do 5 navigate --% "{\"url\":\"https://example.com\"}"
```

Note: `--%` works for simple cases but breaks if the JSON contains spaces or
special characters. Prefer `@file` or `-`.

---

## Usage with `cdp-shell.js`

An interactive REPL is also available:

```bash
node cdp-shell.js
```

Commands: `tabs`, `use <id>`, `eval <js>`, `navigate <url>`, `help`.

---

## Environment

Set `CDP_BRIDGE_BASE` to point at a different host:

```bash
export CDP_BRIDGE_BASE=http://192.168.1.50:1232   # Linux/macOS
$env:CDP_BRIDGE_BASE = "http://192.168.1.50:1232"  # Windows PowerShell
```

Default: `http://127.0.0.1:1232`.

---

## Architecture

```
AI Agent → HTTP (localhost:1232) → host.js → Native Messaging → Chrome Extension → chrome.debugger API → Chrome Tabs
```

The CLI (`cdp-cli.js`) is just a convenient HTTP client. You can also use `curl`,
`fetch()`, or any HTTP library to talk to the bridge directly.

---

## API Directly (without CLI)

```javascript
const BASE = 'http://127.0.0.1:1232';

// List tabs
const tabs = await (await fetch(`${BASE}/tabs`)).json();

// Get palette
const palette = await (await fetch(`${BASE}/palette`)).json();

// Run an action
const result = await (await fetch(`${BASE}/action`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ tabId: 5, action: 'click', args: { selector: '#btn' } }),
})).json();

// Raw CDP command
const raw = await (await fetch(`${BASE}/command`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ tabId: 5, method: 'Page.navigate', params: { url: 'https://...' } }),
})).json();
```

---

## Typical Workflow for AI Agents

```javascript
// Step 1: Discover tabs → pick one
const { result: tabs } = await fetch(`${BASE}/tabs`).then(r => r.json());
const tabId = tabs[0].tabId;  // or choose by title

// Step 2: Navigate
await fetch(`${BASE}/action`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ tabId, action: 'navigate', args: { url: 'https://example.com' } }),
});

// Step 3: Discover elements instead of guessing selectors
const { result } = await fetch(`${BASE}/action`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ tabId, action: 'find', args: { text: 'Sign in' } }),
});
const selector = result.matches[0].selector;

// Step 4: Interact
await fetch(`${BASE}/action`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ tabId, action: 'click', args: { selector } }),
});

// Step 5: Read result
const { result: { text } } = await fetch(`${BASE}/action`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ tabId, action: 'read_text', args: {} }),
});
```
