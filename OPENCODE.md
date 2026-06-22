# CDP Bridge — OpenCode Integration

Control Chrome from OpenCode using native MCP tools. No shell escaping, no CLI, no PowerShell quirks — OpenCode calls browser tools directly via structured JSON.

---

## Setup (one time)

### 1. Start the bridge

```
node host/host.js
```

The extension connects automatically. Keep this terminal open.

### 2. Configure OpenCode

Copy `opencode.json` from this repo into your project root (or merge the `mcp` block into your existing `opencode.json`):

```json
{
  "$schema": "https://opencode.ai/config.json",
  "mcp": {
    "cdp-bridge": {
      "type": "local",
      "command": "node",
      "args": ["PATH/TO/devtools-extension/mcp-server.js"],
      "env": {}
    }
  }
}
```

> Replace `PATH/TO/devtools-extension/` with the absolute path to this repo, or use `mcp-server.js` directly if `opencode.json` is already in this folder.

### 3. Start OpenCode

```
opencode
```

The `cdp-bridge` MCP server starts automatically. You'll see browser tools available.

---

## Available Tools

| Tool | What it does |
|------|-------------|
| `browser_tabs` | List open Chrome tabs — **always call this first** to get a `tabId` |
| `browser_navigate` | Navigate to a URL, waits for full load |
| `browser_find` | Find elements by text, role, or CSS selector |
| `browser_click` | Click an element or coordinates |
| `browser_type` | Type text into the page |
| `browser_press_key` | Press Enter, Tab, Escape, arrow keys, shortcuts |
| `browser_read_text` | Read visible text from the page or an element |
| `browser_get_html` | Get raw HTML of the page or an element |
| `browser_screenshot` | Take a screenshot (returns an image you can see) |
| `browser_scroll` | Scroll to top/bottom or by pixel delta |
| `browser_wait_for` | Wait until a CSS selector appears |
| `browser_eval` | Run JavaScript in the page |
| `browser_set_value` | Set an input value (React-safe) |
| `browser_list_interactive` | List all clickable elements on the page |
| `browser_action` | Generic passthrough to any palette action |

---

## Typical workflow

```
1. browser_tabs               → get tabId
2. browser_navigate           → go to URL
3. browser_find / browser_screenshot → understand the page
4. browser_click / browser_type      → interact
5. browser_wait_for           → wait for result
6. browser_read_text / browser_screenshot → extract data
```

---

## Examples

### Search Google

```
browser_tabs         → { tabId: 1, title: "New Tab", ... }
browser_navigate     → { tabId: 1, url: "https://google.com" }
browser_find         → { tabId: 1, role: "textbox" }        // find the search box
browser_click        → { tabId: 1, selector: "textarea[name=q]" }
browser_type         → { tabId: 1, text: "opencode ai", selector: "textarea[name=q]" }
browser_press_key    → { tabId: 1, key: "Enter" }
browser_wait_for     → { tabId: 1, selector: "#search" }
browser_read_text    → { tabId: 1 }                          // read results
```

### Log into a site

```
browser_navigate     → { tabId: 1, url: "https://example.com/login" }
browser_set_value    → { tabId: 1, selector: "#email", value: "user@example.com" }
browser_set_value    → { tabId: 1, selector: "#password", value: "secret" }
browser_click        → { tabId: 1, selector: "button[type=submit]" }
browser_wait_for     → { tabId: 1, selector: ".dashboard" }
browser_screenshot   → { tabId: 1 }                          // verify login worked
```

### Extract data from a page

```
browser_navigate     → { tabId: 1, url: "https://news.ycombinator.com" }
browser_find         → { tabId: 1, role: "link", limit: 30 }  // get all links
browser_read_text    → { tabId: 1, selector: ".itemlist" }     // read content
```

---

## Troubleshooting

**"Cannot reach CDP bridge"** — Run `node host/host.js` and make sure the Chrome extension is loaded.

**"Tab not attached"** — The extension debugger isn't attached to that tab yet. Wait ~1 second and retry.

**"No tabs found"** — Open at least one tab in Chrome.

**Tool not working as expected** — Use `browser_screenshot` to see what's on screen, then `browser_find` to discover the right selector.

---

## Full palette reference

For advanced actions not in the tool list above (drag, double_click, right_click, file upload, select dropdown, etc.) — use `browser_action` with the action name from:

```
GET http://127.0.0.1:1232/palette
```

See also [PALETTE.md](PALETTE.md) for the full reference.
