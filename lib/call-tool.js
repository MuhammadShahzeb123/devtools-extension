'use strict';

// Bridge calling logic for the CDP Bridge HTTP API (localhost:1232).
// Shared by:
//   - mcp-server.js          (local stdio MCP server)
//   - mcp-remote/relay-agent.js (laptop relay: executes jobs against the local bridge)

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

async function network(tabId, args) {
  const r = await bridgePost('/network', { tabId, ...(args || {}) });
  return r.result;
}

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
  browser_network:       12_000,
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

    case 'browser_network': {
      const r = await network(tabId, {
        limit: rest.limit,
        onlyApi: rest.onlyApi,
        type: rest.type,
        urlIncludes: rest.urlIncludes,
        includeBodies: rest.includeBodies,
      });
      if (!r.entries || !r.entries.length) {
        return { text: 'No network requests recorded. Navigate or interact with the page, then call this again.' };
      }
      const lines = r.entries.map(formatNetworkEntry);
      return { text: truncate(name, `Showing ${r.count} of ${r.total} recorded request(s):\n\n${lines.join('\n\n')}`) };
    }

    case 'browser_network_clear': {
      await bridgePost('/network/clear', { tabId });
      return { text: 'Network trace cleared.' };
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

function formatNetworkEntry(e) {
  const url = e.url || e.responseUrl || '(unknown url)';
  const status = e.failed ? `FAILED ${e.errorText || ''}`.trim() : (e.status != null ? `${e.status} ${e.statusText || ''}`.trim() : 'pending');
  const bits = [
    `${e.method || 'GET'} ${url}`,
    `  status: ${status}`,
    `  type: ${e.type || 'unknown'}${e.mimeType ? `, mime: ${e.mimeType}` : ''}${e.durationMs != null ? `, ${e.durationMs}ms` : ''}`,
  ];
  if (e.initiator) {
    bits.push(`  initiator: ${formatInitiator(e.initiator)}`);
  }
  if (e.postData) {
    bits.push(`  request body: ${shorten(e.postData, 800)}`);
  }
  if (e.body) {
    const body = e.bodyBase64Encoded ? '[base64 response body captured]' : shorten(e.body, 1600);
    bits.push(`  response body${e.bodyTruncated ? ' (truncated)' : ''}: ${body}`);
  } else if (e.bodyError) {
    bits.push(`  response body: unavailable (${e.bodyError})`);
  }
  return bits.join('\n');
}

function formatInitiator(i) {
  if (i.stack && i.stack.length) {
    const frame = i.stack.find((f) => f.url) || i.stack[0];
    return `${i.type || 'script'} ${frame.functionName || '(anonymous)'} ${frame.url || ''}:${frame.lineNumber ?? ''}`;
  }
  return `${i.type || 'unknown'}${i.url ? ` ${i.url}:${i.lineNumber ?? ''}` : ''}`;
}

function shorten(text, limit) {
  const s = String(text).replace(/\s+/g, ' ').trim();
  return s.length <= limit ? s : s.slice(0, limit) + ` ... [${s.length - limit} chars omitted]`;
}

module.exports = { callTool, bridgeGet, bridgePost, action, network, truncate, LIMITS };
