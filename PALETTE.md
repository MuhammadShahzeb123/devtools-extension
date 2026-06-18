# CDP Bridge — Command Palette for AI Agents

A high-level, **self-describing** command set for controlling Chrome. Instead of composing
raw Chrome DevTools Protocol calls by trial and error, you call **named actions** like
`click`, `read_text`, `find`, and `screenshot` — each one a single HTTP request.

> **New here? Do this once:** `GET http://localhost:1232/palette` returns the full machine-readable
> catalog (every command, its arguments, return shape, and an example). Fetch it, and you know the
> entire API. No guessing.

Base URL: `http://localhost:1232` · All bodies/responses are JSON · CORS open.

---

## The 3-step loop

```
1. GET  /tabs                                   → pick a tabId
2. GET  /palette                                → learn every command (once)
3. POST /action  { tabId, action, args }        → do things; repeat
```

That's it. `/palette` is the catalog; `/action` runs one command.

---

## Endpoints

### `GET /palette`
Returns the command catalog. **Fetch this first** so you never have to test what exists.

```json
{
  "actions": [
    {
      "name": "click",
      "summary": "Click an element (or x/y). Scrolls into view; glides the cursor when enabled.",
      "args": [
        { "name": "selector", "type": "string", "required": false, "desc": "CSS selector." },
        { "name": "xpath", "type": "string", "required": false, "desc": "XPath alternative." },
        { "name": "x", "type": "number", "required": false, "desc": "Raw viewport X (with y)." },
        { "name": "y", "type": "number", "required": false, "desc": "Raw viewport Y (with x)." },
        { "name": "button", "type": "string", "required": false, "desc": "left | right | middle." },
        { "name": "clickCount", "type": "number", "required": false, "desc": "Default 1." }
      ],
      "returns": "{ clicked, x, y }",
      "example": { "action": "click", "args": { "selector": "button#submit" } }
    }
    // … every other action
  ]
}
```

### `POST /action`
Run one palette command.

**Request**
```json
{ "tabId": 5, "action": "click", "args": { "selector": "button#submit" } }
```

**Success** → `{ "result": { … } }` (action-specific) · **Failure** → `{ "error": "…" }` (HTTP 500/503).

`GET /tabs` and `GET /health` are unchanged. `POST /command` (raw CDP) still exists as the
low-level escape hatch — see [README.md](README.md). You should rarely need it now.

---

## Targeting: how to point at an element

Every element-targeting action accepts **one of**:

| Field | Example | When |
|---|---|---|
| `selector` | `"button#submit"` | CSS selector (preferred) |
| `xpath` | `"//button[text()='OK']"` | When CSS can't express it |
| `x`, `y` | `640`, `380` | Raw viewport coordinates (CSS pixels) |

**Don't know the selector?** Discover it instead of guessing:

- `find { text: "Sign in" }` → every matching element with a ready-to-use **CSS selector AND XPath**, its text, and box.
- `find { role: "button" }` → all buttons (roles: `button`, `link`, `textbox`, `checkbox`, `radio`, `heading`, `image`).
- `list_interactive` → every clickable/typable element on the page, each with a selector.
- `selector_at { x, y }` → reverse lookup: what element is at this screen point (pair with a screenshot).

Typical flow: `find { text: "Add to cart" }` → take `matches[0].selector` → `click { selector }`.

---

## Command reference

All examples show the `args` object you put in `POST /action`. Coordinates are CSS pixels,
viewport-relative. Actions return `{ result: … }`; the shape shown is the inside of `result`.

### Navigation
| Action | Args | Returns |
|---|---|---|
| `navigate` | `{ url, wait? }` | `{ url }` — navigates and waits for load (unless `wait:false`) |
| `back` | `{}` | `{}` |
| `forward` | `{}` | `{}` |
| `reload` | `{}` | `{}` |
| `wait_for_load` | `{ timeoutMs? }` | `{ loaded }` — waits for `readyState==="complete"` |
| `wait_for` | `{ selector, timeoutMs? }` | `{ found }` — polls until the selector exists |

```json
{ "action": "navigate", "args": { "url": "https://example.com" } }
{ "action": "wait_for", "args": { "selector": ".results", "timeoutMs": 8000 } }
```

### Reading (text, not raw HTML)
| Action | Args | Returns |
|---|---|---|
| `read_text` | `{ selector?, xpath? }` | `{ text, length }` — visible text; whole page if no target |
| `get_html` | `{ selector? }` | `{ html }` — outerHTML |
| `get_attribute` | `{ selector, name }` | `{ name, value }` |
| `get_value` | `{ selector }` | `{ value }` — input/textarea/select value |
| `exists` | `{ selector? , xpath? }` | `{ exists }` |

```json
{ "action": "read_text" }                                  // whole page, as a human reads it
{ "action": "read_text", "args": { "selector": "article" } } // just that region
{ "action": "get_attribute", "args": { "selector": "a.more", "name": "href" } }
```

### Selector discovery
| Action | Args | Returns |
|---|---|---|
| `find` | `{ text?, role?, selector?, limit? }` | `{ matches: [{ selector, xpath, tag, text, box, visible }], count }` |
| `list_interactive` | `{ limit? }` | `{ elements: [{ selector, xpath, tag, type, text, box }] }` |
| `selector_at` | `{ x, y }` | `{ selector, xpath, tag, text, box }` |

```json
{ "action": "find", "args": { "text": "Sign in" } }
{ "action": "list_interactive", "args": { "limit": 30 } }
```

### Pointer
| Action | Args | Returns |
|---|---|---|
| `click` | `{ selector\|xpath\|x,y, button?, clickCount? }` | `{ clicked, x, y }` |
| `double_click` | `{ selector\|xpath\|x,y }` | `{ doubleClicked, x, y }` |
| `right_click` | `{ selector\|xpath\|x,y }` | `{ rightClicked, x, y }` |
| `hover` | `{ selector\|xpath\|x,y }` | `{ x, y }` |
| `drag` | `{ from:{…}, to:{…} }` | `{ from, to }` — each target is `{selector\|xpath\|x,y}` |

```json
{ "action": "click", "args": { "selector": "button#submit" } }
{ "action": "drag", "args": { "from": { "selector": ".handle" }, "to": { "x": 400, "y": 200 } } }
```

`click` scrolls the element into view first, so you don't have to.

### Scroll
| Action | Args | Returns |
|---|---|---|
| `scroll` | `{ to?:'top'\|'bottom', selector?, by?:{x,y} }` | `{ scrollX, scrollY }` |

```json
{ "action": "scroll", "args": { "by": { "y": 600 } } }   // down 600px
{ "action": "scroll", "args": { "to": "bottom" } }
{ "action": "scroll", "args": { "selector": "#section-3" } } // bring into view
```

### Keyboard & text
| Action | Args | Returns |
|---|---|---|
| `type` | `{ text, selector?, clear? }` | `{ typed }` — focuses `selector` first if given |
| `clear` | `{ selector }` | `{ cleared }` |
| `set_value` | `{ selector, value }` | `{ value }` — direct set, React-safe |
| `press_key` | `{ key, modifiers? }` | `{ key }` |

`press_key` keys: `Enter`, `Tab`, `Escape`, `Backspace`, `Delete`, `ArrowUp/Down/Left/Right`,
`Home`, `End`, `PageUp`, `PageDown`, `Space`, or any single character. `modifiers`: any of
`Ctrl`, `Shift`, `Alt`, `Meta`.

```json
{ "action": "type", "args": { "selector": "input[name=q]", "text": "hello", "clear": true } }
{ "action": "press_key", "args": { "key": "Enter" } }
{ "action": "press_key", "args": { "key": "a", "modifiers": ["Ctrl"] } }   // select-all
```

### Form controls
| Action | Args | Returns |
|---|---|---|
| `select_option` | `{ selector, value\|label\|index }` | `{ value, text }` |
| `check` | `{ selector }` | `{ checked: true }` |
| `uncheck` | `{ selector }` | `{ checked: false }` |
| `upload` | `{ selector, files:[paths] }` | `{ uploaded }` — paths must exist on Chrome's machine |

```json
{ "action": "select_option", "args": { "selector": "select#country", "label": "Canada" } }
{ "action": "check", "args": { "selector": "#agree" } }
```

### Capture
| Action | Args | Returns |
|---|---|---|
| `screenshot` | `{ selector?, xpath?, fullPage?, format?, quality? }` | `{ data, format }` — `data` is base64 |

```json
{ "action": "screenshot" }                                  // viewport
{ "action": "screenshot", "args": { "selector": "header" } } // just that element
{ "action": "screenshot", "args": { "fullPage": true, "format": "jpeg", "quality": 80 } }
```

### Visual cursor
A real, gliding cursor overlay so a human watching can see what the AI is doing.

| Action | Args | Returns |
|---|---|---|
| `set_cursor` | `{ enabled }` | `{ cursorEnabled }` — toggle (persisted) |
| `move_cursor` | `{ selector\|xpath\|x,y }` | `{ x, y }` — glide without clicking |

When the cursor is **enabled**, `click` / `double_click` / `right_click` / `hover` / `type` glide
the cursor to the target (with a click ripple) before the real input fires. The overlay uses
`pointer-events:none`, so it never blocks actual clicks, and re-injects itself after navigation.
Default is **off** (no page modification unless you ask).

```json
{ "action": "set_cursor", "args": { "enabled": true } }
{ "action": "click", "args": { "selector": "button#go" } }   // now visibly glides + clicks
```

---

## Worked examples

### Search a site
```json
{ "action": "navigate", "args": { "url": "https://duckduckgo.com" } }
{ "action": "type", "args": { "selector": "input[name=q]", "text": "chrome devtools protocol" } }
{ "action": "press_key", "args": { "key": "Enter" } }
{ "action": "wait_for", "args": { "selector": "[data-testid=result]" } }
{ "action": "read_text", "args": { "selector": "[data-testid=result]" } }
```

### Click something when you only know its label
```json
{ "action": "find", "args": { "text": "Add to cart" } }     // → matches[0].selector
{ "action": "click", "args": { "selector": "<matches[0].selector>" } }
```

### Fill and submit a form
```json
{ "action": "set_value", "args": { "selector": "#email", "value": "a@b.com" } }
{ "action": "type", "args": { "selector": "#password", "text": "hunter2" } }
{ "action": "check", "args": { "selector": "#remember" } }
{ "action": "click", "args": { "selector": "button[type=submit]" } }
```

### Read an article
```json
{ "action": "read_text", "args": { "selector": "article" } }
```

---

## From the shell (cdp-cli)

```bash
node cdp-cli.js --tabs                                  # pick a tabId
node cdp-cli.js --palette                               # list every command
node cdp-cli.js --do 5 read_text                        # whole-page text
node cdp-cli.js --do 5 find '{"text":"Sign in"}'        # discover a selector
node cdp-cli.js --do 5 click '{"selector":"button#go"}' # click it
node cdp-cli.js --do 5 set_cursor '{"enabled":true}'    # turn the cursor on
```

---

## Errors

| Status | `error` | Meaning |
|---|---|---|
| 400 | `Body must include numeric tabId and action string` | Missing/invalid `tabId` or `action` |
| 500 | `Unknown action: <x>. GET /palette for the catalog.` | Typo'd action name — re-check `/palette` |
| 500 | `Element not found: <selector>` | Target missing — try `find` / `wait_for` first |
| 500 | `Target required: provide selector, xpath, or x/y` | A pointer action got no target |
| 503 | `Extension did not respond within 30s` | Host up but extension not connected |

Each action has a 30-second hard timeout; keep steps small.

---

## Notes

- **Selectors over coordinates.** Prefer `selector`/`xpath`; use `x,y` only with a screenshot + `selector_at`.
- **`read_text` is what a human reads** — visible text, optionally scoped to any selector/region — not raw HTML.
- **Discovery beats guessing.** `find` and `list_interactive` hand you working selectors; use them instead of inventing CSS.
- **The catalog is authoritative.** `GET /palette` is generated from the same code that runs the actions, so it can't be stale.
