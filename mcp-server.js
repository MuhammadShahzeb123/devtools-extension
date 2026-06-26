#!/usr/bin/env node
'use strict';

// CDP Bridge — MCP Server
// Exposes Chrome browser control as MCP tools for OpenCode and other MCP clients.
// Transport: stdio (JSON-RPC 2.0, one message per line)
// Bridge:    http://127.0.0.1:1232 (set CDP_BRIDGE_BASE to override)

const BASE = process.env.CDP_BRIDGE_BASE || 'http://127.0.0.1:1232';

// ── Bridge HTTP helpers ───────────────────────────────────────────────────────

async function bridgeGet(path) {
  let r;
  try {
    r = await fetch(`${BASE}${path}`);
  } catch (e) {
    throw new Error(
      `Cannot reach CDP bridge at ${BASE}. Is the host running? (node host/host.js)`
    );
  }
  const json = await r.json();
  if (json.error) throw new Error(json.error);
  return json;
}

async function bridgePost(path, body) {
  let r;
  try {
    r = await fetch(`${BASE}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  } catch (e) {
    throw new Error(
      `Cannot reach CDP bridge at ${BASE}. Is the host running? (node host/host.js)`
    );
  }
  const json = await r.json();
  if (json.error) throw new Error(json.error);
  return json;
}

async function action(tabId, name, args) {
  const r = await bridgePost('/action', { tabId, action: name, args: args || {} });
  return r.result;
}

// ── Tool definitions ──────────────────────────────────────────────────────────

const TOOLS = [
  {
    name: 'browser_tabs',
    description:
      'List all open Chrome tabs with their IDs, titles, and URLs. ' +
      'Always call this first to get a tabId before using any other browser tool.',
    inputSchema: { type: 'object', properties: {}, required: [] },
  },
  {
    name: 'browser_navigate',
    description: 'Navigate a Chrome tab to a URL and wait for the page to finish loading.',
    inputSchema: {
      type: 'object',
      properties: {
        tabId:  { type: 'number', description: 'Tab ID from browser_tabs.' },
        url:    { type: 'string', description: 'Destination URL (include https://).' },
      },
      required: ['tabId', 'url'],
    },
  },
  {
    name: 'browser_read_text',
    description:
      'Read the visible text content of the whole page or a specific element. ' +
      'Use this to extract information after navigating.',
    inputSchema: {
      type: 'object',
      properties: {
        tabId:    { type: 'number', description: 'Tab ID from browser_tabs.' },
        selector: { type: 'string', description: 'CSS selector; omit for the whole page.' },
        xpath:    { type: 'string', description: 'XPath alternative to selector.' },
      },
      required: ['tabId'],
    },
  },
  {
    name: 'browser_find',
    description:
      'Find elements by visible text, ARIA role, or CSS selector. ' +
      'Returns CSS selectors, XPaths, positions, and visibility — use these for subsequent clicks. ' +
      'Prefer this over guessing selectors.',
    inputSchema: {
      type: 'object',
      properties: {
        tabId:    { type: 'number', description: 'Tab ID from browser_tabs.' },
        text:     { type: 'string', description: 'Visible text to match (case-insensitive substring).' },
        role:     { type: 'string', description: 'ARIA role: button | link | textbox | checkbox | radio | heading | image.' },
        selector: { type: 'string', description: 'CSS selector to enumerate.' },
        limit:    { type: 'number', description: 'Max results (default 20).' },
      },
      required: ['tabId'],
    },
  },
  {
    name: 'browser_click',
    description:
      'Click an element on the page. Provide a CSS selector (from browser_find), ' +
      'XPath, or raw x/y viewport coordinates.',
    inputSchema: {
      type: 'object',
      properties: {
        tabId:      { type: 'number', description: 'Tab ID from browser_tabs.' },
        selector:   { type: 'string', description: 'CSS selector of the element to click.' },
        xpath:      { type: 'string', description: 'XPath alternative to selector.' },
        x:          { type: 'number', description: 'Viewport X coordinate (use with y).' },
        y:          { type: 'number', description: 'Viewport Y coordinate (use with x).' },
        button:     { type: 'string', description: 'left (default) | right | middle.' },
        clickCount: { type: 'number', description: 'Number of clicks (default 1).' },
      },
      required: ['tabId'],
    },
  },
  {
    name: 'browser_type',
    description:
      'Type text into the page. Optionally focus a specific element first. ' +
      'Use clear:true to wipe existing content before typing.',
    inputSchema: {
      type: 'object',
      properties: {
        tabId:    { type: 'number', description: 'Tab ID from browser_tabs.' },
        text:     { type: 'string', description: 'Text to type.' },
        selector: { type: 'string', description: 'Focus this element before typing (optional).' },
        clear:    { type: 'boolean', description: 'Clear the field before typing (default false).' },
      },
      required: ['tabId', 'text'],
    },
  },
  {
    name: 'browser_press_key',
    description:
      'Press a keyboard key with optional modifier keys. ' +
      'Useful for Enter, Tab, Escape, arrow keys, and keyboard shortcuts.',
    inputSchema: {
      type: 'object',
      properties: {
        tabId:     { type: 'number', description: 'Tab ID from browser_tabs.' },
        key:       { type: 'string', description: 'Key name: Enter | Tab | Escape | Backspace | ArrowUp | ArrowDown | ArrowLeft | ArrowRight | Home | End | Delete | Space | or any character.' },
        modifiers: { type: 'array', items: { type: 'string' }, description: 'Modifier keys: Ctrl | Shift | Alt | Meta.' },
      },
      required: ['tabId', 'key'],
    },
  },
  {
    name: 'browser_scroll',
    description: "Scroll the page. Use to='top'/'bottom', by={y:600} for delta, or selector to scroll an element into view.",
    inputSchema: {
      type: 'object',
      properties: {
        tabId:    { type: 'number', description: 'Tab ID from browser_tabs.' },
        to:       { type: 'string', description: "'top' or 'bottom'." },
        by:       { type: 'object', description: 'Pixel delta, e.g. { y: 600 } to scroll down.', properties: { x: { type: 'number' }, y: { type: 'number' } } },
        selector: { type: 'string', description: 'Scroll this element into view.' },
      },
      required: ['tabId'],
    },
  },
  {
    name: 'browser_screenshot',
    description:
      'Take a screenshot of the current page or a specific element. ' +
      'Returns a PNG image you can see. Use this to visually verify page state.',
    inputSchema: {
      type: 'object',
      properties: {
        tabId:    { type: 'number', description: 'Tab ID from browser_tabs.' },
        selector: { type: 'string', description: 'Clip screenshot to this element (optional).' },
        fullPage: { type: 'boolean', description: 'Capture the full scrollable page (default false).' },
        format:   { type: 'string', description: 'png (default) or jpeg.' },
      },
      required: ['tabId'],
    },
  },
  {
    name: 'browser_wait_for',
    description: 'Wait until a CSS selector appears on the page. Polls every 300ms.',
    inputSchema: {
      type: 'object',
      properties: {
        tabId:     { type: 'number', description: 'Tab ID from browser_tabs.' },
        selector:  { type: 'string', description: 'CSS selector to wait for.' },
        timeoutMs: { type: 'number', description: 'Timeout in ms (default 10000).' },
      },
      required: ['tabId', 'selector'],
    },
  },
  {
    name: 'browser_eval',
    description:
      'Run arbitrary JavaScript in the page and return the result. ' +
      'Useful for reading complex data, checking state, or operations not covered by other tools.',
    inputSchema: {
      type: 'object',
      properties: {
        tabId:      { type: 'number', description: 'Tab ID from browser_tabs.' },
        expression: { type: 'string', description: 'JavaScript expression to evaluate. Return value must be JSON-serialisable.' },
      },
      required: ['tabId', 'expression'],
    },
  },
  {
    name: 'browser_get_html',
    description: 'Get the raw HTML of the page or a specific element.',
    inputSchema: {
      type: 'object',
      properties: {
        tabId:    { type: 'number', description: 'Tab ID from browser_tabs.' },
        selector: { type: 'string', description: 'CSS selector; omit for the whole document.' },
      },
      required: ['tabId'],
    },
  },
  {
    name: 'browser_list_interactive',
    description:
      'List all visible interactive elements on the page (links, buttons, inputs). ' +
      'Returns selectors and positions. Use when you need to discover what you can interact with.',
    inputSchema: {
      type: 'object',
      properties: {
        tabId:  { type: 'number', description: 'Tab ID from browser_tabs.' },
        limit:  { type: 'number', description: 'Max elements (default 50).' },
      },
      required: ['tabId'],
    },
  },
  {
    name: 'browser_set_value',
    description:
      'Set the value of an input or textarea directly (React-safe). ' +
      'Prefer this over browser_type when the field uses a JS framework.',
    inputSchema: {
      type: 'object',
      properties: {
        tabId:    { type: 'number', description: 'Tab ID from browser_tabs.' },
        selector: { type: 'string', description: 'CSS selector of the input/textarea.' },
        value:    { type: 'string', description: 'Value to set.' },
      },
      required: ['tabId', 'selector', 'value'],
    },
  },
  {
    name: 'browser_action',
    description:
      'Run any palette action by name. Use this for actions not covered by the other tools ' +
      '(e.g. drag, double_click, right_click, select_option, check, upload). ' +
      'Call GET http://127.0.0.1:1232/palette to see the full action catalog.',
    inputSchema: {
      type: 'object',
      properties: {
        tabId:  { type: 'number', description: 'Tab ID from browser_tabs.' },
        action: { type: 'string', description: 'Action name from GET /palette.' },
        args:   { type: 'object', description: 'Action-specific arguments.' },
      },
      required: ['tabId', 'action'],
    },
  },
];

// ── Tool execution ────────────────────────────────────────────────────────────

// Keep tool results small — every result lands in conversation history and is a
// cache miss. Large payloads (HTML, full-page text, long find lists) accumulate
// fast and waste tokens on every subsequent LLM call.
const LIMITS = {
  default:      8_000,
  browser_get_html:       5_000,  // raw HTML is extremely dense
  browser_read_text:      8_000,
  browser_find:          10_000,
  browser_list_interactive: 6_000,
  browser_eval:           6_000,
};

function truncate(name, text) {
  const limit = LIMITS[name] ?? LIMITS.default;
  if (typeof text !== 'string' || text.length <= limit) return text;
  return text.slice(0, limit) + `\n\n[truncated — ${text.length - limit} chars omitted. Use a narrower selector or paginate.]`;
}

async function callTool(name, args) {
  const { tabId, ...rest } = args || {};

  switch (name) {

    case 'browser_tabs': {
      const json = await bridgeGet('/tabs');
      const tabs = json.result;
      if (!tabs || !tabs.length) return { text: 'No tabs found.' };
      const lines = tabs.map(
        (t) => `tabId ${t.tabId}  [${t.attached ? 'attached' : 'detached'}]  ${t.title}\n  ${t.url}`
      );
      return { text: lines.join('\n\n') };
    }

    case 'browser_navigate': {
      const r = await action(tabId, 'navigate', { url: rest.url });
      return { text: `Navigated to: ${r.url}` };
    }

    case 'browser_read_text': {
      const r = await action(tabId, 'read_text', { selector: rest.selector, xpath: rest.xpath });
      return { text: truncate(name, r.text || '(page is empty)') };
    }

    case 'browser_find': {
      const r = await action(tabId, 'find', {
        text: rest.text,
        role: rest.role,
        selector: rest.selector,
        limit: rest.limit,
      });
      if (!r.count) return { text: 'No elements found.' };
      const lines = r.matches.map((m) =>
        `[${m.visible ? 'visible' : 'hidden'}] <${m.tag}> "${m.text}"\n  selector: ${m.selector}\n  xpath:    ${m.xpath}\n  box: x=${m.box.x} y=${m.box.y} w=${m.box.w} h=${m.box.h}`
      );
      return { text: truncate(name, `Found ${r.count} element(s):\n\n${lines.join('\n\n')}`) };
    }

    case 'browser_click': {
      const r = await action(tabId, 'click', {
        selector: rest.selector,
        xpath: rest.xpath,
        x: rest.x,
        y: rest.y,
        button: rest.button,
        clickCount: rest.clickCount,
      });
      return { text: `Clicked at (${r.x}, ${r.y})` };
    }

    case 'browser_type': {
      const r = await action(tabId, 'type', {
        text: rest.text,
        selector: rest.selector,
        clear: rest.clear,
      });
      return { text: `Typed ${r.typed} character(s)` };
    }

    case 'browser_press_key': {
      const r = await action(tabId, 'press_key', { key: rest.key, modifiers: rest.modifiers });
      return { text: `Pressed: ${r.key}` };
    }

    case 'browser_scroll': {
      const r = await action(tabId, 'scroll', { to: rest.to, by: rest.by, selector: rest.selector });
      return { text: `Scrolled — position: (${r.scrollX}, ${r.scrollY})` };
    }

    case 'browser_screenshot': {
      const r = await action(tabId, 'screenshot', {
        selector: rest.selector,
        fullPage: rest.fullPage,
        format: rest.format || 'png',
      });
      return { image: { data: r.data, mimeType: r.format === 'jpeg' ? 'image/jpeg' : 'image/png' } };
    }

    case 'browser_wait_for': {
      const r = await action(tabId, 'wait_for', { selector: rest.selector, timeoutMs: rest.timeoutMs });
      return { text: r.found ? `Element found: ${rest.selector}` : `Timed out waiting for: ${rest.selector}` };
    }

    case 'browser_eval': {
      const r = await bridgePost('/command', {
        tabId,
        method: 'Runtime.evaluate',
        params: { expression: rest.expression, returnByValue: true },
      });
      const val = r.result?.result?.value;
      const raw = val !== undefined ? String(val) : JSON.stringify(r.result, null, 2);
      return { text: truncate(name, raw) };
    }

    case 'browser_get_html': {
      const r = await action(tabId, 'get_html', { selector: rest.selector });
      return { text: truncate(name, r.html) };
    }

    case 'browser_list_interactive': {
      const r = await action(tabId, 'list_interactive', { limit: rest.limit });
      if (!r.elements || !r.elements.length) return { text: 'No interactive elements found.' };
      const lines = r.elements.map(
        (e) => `<${e.tag}${e.type ? ` type="${e.type}"` : ''}> "${e.text}"\n  selector: ${e.selector}`
      );
      return { text: truncate(name, `${r.elements.length} interactive element(s):\n\n${lines.join('\n\n')}`) };
    }

    case 'browser_set_value': {
      const r = await action(tabId, 'set_value', { selector: rest.selector, value: rest.value });
      return { text: `Set value to: ${r.value}` };
    }

    case 'browser_action': {
      const r = await action(tabId, rest.action, rest.args);
      return { text: truncate(name, JSON.stringify(r, null, 2)) };
    }

    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}

// ── MCP JSON-RPC stdio transport ──────────────────────────────────────────────

function send(msg) {
  process.stdout.write(JSON.stringify(msg) + '\n');
}

function respond(id, result) {
  send({ jsonrpc: '2.0', id, result });
}

function respondError(id, code, message) {
  send({ jsonrpc: '2.0', id, error: { code, message } });
}

let buf = '';

process.stdin.setEncoding('utf8');

process.stdin.on('data', async (chunk) => {
  buf += chunk;
  const lines = buf.split('\n');
  buf = lines.pop();

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    let msg;
    try { msg = JSON.parse(trimmed); } catch { continue; }

    const { id, method, params } = msg;

    try {
      switch (method) {

        case 'initialize':
          respond(id, {
            protocolVersion: '2024-11-05',
            capabilities: { tools: {} },
            serverInfo: { name: 'cdp-bridge', version: '1.0.0' },
          });
          break;

        case 'tools/list':
          respond(id, { tools: TOOLS });
          break;

        case 'tools/call': {
          const { name, arguments: toolArgs } = params;
          let out;
          try {
            out = await callTool(name, toolArgs || {});
          } catch (err) {
            respond(id, {
              content: [{ type: 'text', text: `Error: ${err.message}` }],
              isError: true,
            });
            break;
          }

          if (out.image) {
            respond(id, {
              content: [{ type: 'image', data: out.image.data, mimeType: out.image.mimeType }],
            });
          } else {
            respond(id, {
              content: [{ type: 'text', text: out.text }],
            });
          }
          break;
        }

        case 'ping':
          respond(id, {});
          break;

        default:
          if (id != null) respondError(id, -32601, `Method not found: ${method}`);
      }
    } catch (err) {
      if (id != null) respondError(id, -32603, err.message);
    }
  }
});

process.stdin.on('end', () => process.exit(0));

process.stderr.write(`[cdp-bridge-mcp] MCP server ready. Bridge: ${BASE}\n`);
