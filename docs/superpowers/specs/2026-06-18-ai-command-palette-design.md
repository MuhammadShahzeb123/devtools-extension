# AI Command Palette for the CDP Bridge — Design

**Date:** 2026-06-18
**Status:** Approved, implementing

## Problem

The bridge today exposes only a **raw CDP pass-through** (`POST /command`). Every human-level
action is a low-level ritual the AI must reconstruct from scratch each session:

- A click = `Runtime.evaluate` for `getBoundingClientRect()` → three separate
  `Input.dispatchMouseEvent` calls.
- Reading = knowing to evaluate `document.body.innerText`.
- Finding a target = hand-writing DOM-walking JavaScript.

There is no named, discoverable command set, so the AI rediscovers the API by trial and error
on every task. This is slow and error-prone.

## Solution

A high-level **action layer** on top of the raw pass-through, plus a **self-describing catalog**
the AI fetches once. `POST /command` stays as the low-level escape hatch.

```
POST /action   { "tabId": 5, "action": "click", "args": { "selector": "button#go" } }  → { "result": {…} }
GET  /palette  → { "actions": [ { name, summary, args, returns, example }, … ] }
```

`GET /palette` is the anti-trial-and-error feature: one fetch and the AI knows every command,
its arguments, return shape, and an example.

## Architecture decision

Action handlers live in the **extension** (`extension/palette.js`), not the host. A single
`click` composes 4–5 CDP calls (resolve selector → scroll into view → glide cursor → 3 `Input`
events). Running that inside the extension — which already owns the `chrome.debugger` session —
makes each action **one atomic HTTP round-trip** instead of five. The host stays a thin router.

The catalog is generated from the **same registry** that defines the handlers (metadata and
`run()` co-located per action), so documentation cannot drift from behavior. `GET /palette`
round-trips to the extension and returns 503 if it is disconnected (same as `/tabs`).

**Rejected:** chaining multiple Native-Messaging calls from `host.js`. Simpler to read, but 5×
the latency and it splits "what an action is" from "how it runs."

## Command catalog (comprehensive)

| Group | Actions |
|---|---|
| Navigate | `navigate {url}` · `back` · `forward` · `reload` · `wait_for_load` · `wait_for {selector}` |
| Read | `read_text {selector?\|xpath?}` · `get_html {selector?}` · `get_attribute {selector,name}` · `get_value {selector}` · `exists {selector\|xpath}` |
| Discover selectors | `find {text?\|role?\|selector?}` → CSS **and** XPath + box · `list_interactive` · `selector_at {x,y}` |
| Pointer | `click` · `double_click` · `right_click` · `hover` · `drag {from,to}` (each takes `selector\|xpath\|x,y`) |
| Scroll | `scroll {to:'top'\|'bottom', selector?, by:{x,y}}` |
| Keyboard/text | `type {text, selector?, clear?}` · `clear {selector}` · `set_value {selector,value}` · `press_key {key, modifiers?}` |
| Form controls | `select_option {selector, value\|label\|index}` · `check` · `uncheck` · `upload {selector, files[]}` |
| Capture | `screenshot {selector?, fullPage?, format?, quality?}` |
| Cursor | `set_cursor {enabled}` · `move_cursor {selector\|x,y}` |

Every action returns `{ result: … }` on success / `{ error }` on failure — the existing
`/command` convention.

## Selector model

Targeting actions accept **one of** `selector` (CSS), `xpath`, or raw `x`/`y`. A shared injected
resolver scrolls the element into view and returns its viewport box + center, which feeds CDP
`Input` directly. `find` / `list_interactive` run the other direction — returning robust CSS
selectors **and** XPaths by visible text/role, so the AI discovers targets instead of guessing.

## Visual cursor

A `__cdp_cursor__` overlay injected via `Runtime.evaluate`: `position:fixed`, max z-index,
`pointer-events:none` (never blocks real input), glides to targets via a CSS transition, ripple
on click. The injector is idempotent, so it self-heals after navigation. Toggle with
`set_cursor {enabled}` (persisted in `chrome.storage`); when on, `click`/`hover`/`type`/`move_cursor`
glide the cursor to the target before the real CDP input fires. **Default off** — zero page
modification unless asked for.

## Files

- **NEW** `extension/palette.js` — action registry (handlers + catalog metadata), CDP primitives, cursor injector.
- **EDIT** `extension/background.js` — `importScripts('palette.js')`; route `action` + `palette` message types.
- **EDIT** `host/host.js` — add `POST /action` + `GET /palette` (validate & forward).
- **NEW** `PALETTE.md` — AI-facing reference ("fetch `GET /palette` first") with every command + examples.
- **EDIT** `README.md`, `context.md` — point to the palette; note `/command` is the low-level escape hatch.
- **EDIT** `cdp-cli.js` — `--palette` and `--do <tabId> <action> [argsJSON]` to try it from the shell.

## Verification

- Host-level checks: `/action` body validation + `/palette` routing.
- Live smoke test against a real tab: `node cdp-cli.js --palette`, then `read_text`, `find`,
  `click`, `screenshot`, and cursor-on — confirming real results on a real page.

## Out of scope (v1)

Reader-mode Markdown and structured page outline. Easy to add later as `read_article` / `outline`.
