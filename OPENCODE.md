# CDP Bridge — MCP Integration

Control Chrome from any MCP-compatible client (OpenCode, Claude Code, Codex, Cursor, Synara) using native MCP tools.

---

## Quick Install

```bash
node install-mcp.js
```

This auto-detects which MCP clients are installed and registers the `cdp-bridge` MCP server for each one.

**Supported clients:**
| Client | Config file |
|--------|------------|
| OpenCode | `opencode.json` (project or `~/.config/opencode/`) |
| Claude Code | `~/.claude/settings.json` |
| Codex / Synara | `~/.synara/codex-home-overlay/config.toml` |
| Cursor | `.cursor/mcp.json` (project or `~/.cursor/`) |

To remove: `node install-mcp.js --uninstall`

---

## Manual Setup

### 1. Start the bridge

```bash
node host/host.js
```

The extension connects automatically. Keep this terminal open.

### 2. Configure your MCP client

**OpenCode** — merge into `opencode.json`:

```json
{
  "mcp": {
    "cdp-bridge": {
      "type": "local",
      "command": ["node", "mcp-server.js"],
      "enabled": true
    }
  }
}
```

**Claude Code** — merge into `~/.claude/settings.json`:

```json
{
  "mcpServers": {
    "cdp-bridge": {
      "command": "node",
      "args": ["/path/to/devtools-extension/mcp-server.js"]
    }
  }
}
```

**Codex / Synara** — merge into `~/.synara/codex-home-overlay/config.toml`:

```toml
[mcp_servers.cdp-bridge]
command = "node"
args = ['C:\path\to\devtools-extension\mcp-server.js']

# Per-tool approval (optional, defaults to "approve")
[mcp_servers.cdp-bridge.tools.browser_tabs]
approval_mode = "approve"
```

**Cursor** — merge into `.cursor/mcp.json`:

```json
{
  "mcpServers": {
    "cdp-bridge": {
      "command": "node",
      "args": ["/path/to/devtools-extension/mcp-server.js"]
    }
  }
}
```

### 3. Start your client

The `cdp-bridge` MCP server starts automatically when your client launches. You'll see 17 browser tools available.

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
