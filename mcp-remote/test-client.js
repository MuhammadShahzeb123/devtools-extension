#!/usr/bin/env node
'use strict';

// Minimal MCP Streamable HTTP client for end-to-end testing of the remote server.
// Usage:
//   node test-client.js                                   # initialize + tools/list + browser_tabs
//   node test-client.js browser_navigate '{"tabId":N,"url":"https://example.com"}'
//   node test-client.js browser_read_text '{"tabId":N}'
//
// Env:
//   MCP_URL    e.g. http://127.0.0.1:51882/mcp/<secret>  or https://mcp.fumblemap.com/mcp/<secret>
//   MCP_VERSION   default 2025-06-18

const BASE_URL = process.env.MCP_URL || 'http://127.0.0.1:51882/mcp/test-secret';
const PROTOCOL_VERSION = process.env.MCP_VERSION || '2025-06-18';

const [,, toolName, toolArgsJson] = process.argv;

async function post(json) {
  const res = await fetch(BASE_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Accept': 'application/json, text/event-stream',
      'Mcp-Session-Id': sessionId,
      'MCP-Protocol-Version': PROTOCOL_VERSION,
    },
    body: JSON.stringify(json),
  });
  const sessionHeader = res.headers.get('mcp-session-id');
  if (sessionHeader) sessionId = sessionHeader;
  const text = await res.text();
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    parsed = parseSse(text) || { raw: text.slice(0, 500) };
  }
  return { status: res.status, parsed };
}

let sessionId = '';
let id = 0;
const nextId = () => ++id;

function parseSse(text) {
  if (!/^data:/m.test(text)) return null;
  const frames = text
    .split(/\r?\n\r?\n/)
    .map((block) => {
      const dataLine = block.split('\n').find((l) => l.startsWith('data:'));
      if (!dataLine) return null;
      try { return JSON.parse(dataLine.slice(5).trim()); } catch { return null; }
    })
    .filter(Boolean);
  if (!frames.length) return null;
  const last = frames[frames.length - 1];
  return last.data && typeof last.data === 'string' ? JSON.parse(last.data) : last;
}

function mcp(method, params = {}) {
  return post({ jsonrpc: '2.0', id: nextId(), method, params });
}

async function main() {
  console.log(`>> ${BASE_URL} (protocol ${PROTOCOL_VERSION})`);

  let r = await mcp('initialize', {
    protocolVersion: PROTOCOL_VERSION,
    capabilities: {},
    clientInfo: { name: 'test-client', version: '1.0.0' },
  });
  console.log('initialize:', r.status, JSON.stringify(r.parsed.result || r.parsed.error).slice(0, 300));
  if (r.parsed.error) process.exit(1);

  r = await mcp('notifications/initialized');
  console.log('notifications/initialized:', r.status);

  r = await mcp('tools/list', {});
  const tools = r.parsed.result?.tools || [];
  console.log(`tools/list: ${tools.length} tools`);
  if (tools.length) console.log('  names:', tools.map((t) => t.name).join(', '));
  if (r.parsed.error) process.exit(1);

  const name = toolName || 'browser_tabs';
  const args = toolArgsJson ? JSON.parse(toolArgsJson) : {};

  r = await mcp('tools/call', { name, arguments: args });
  const res = r.parsed.result;
  console.log(`tools/call ${name}:`, r.status, res ? (res.isError ? 'isError' : 'ok') : JSON.stringify(r.parsed.error).slice(0, 200));

  for (const block of res?.content || []) {
    if (block.type === 'text') console.log('  text:', block.text.slice(0, 1200));
    if (block.type === 'image') console.log(`  image: ${block.mimeType}, ${block.data.length} bytes`);
  }

  process.exit(res?.isError ? 2 : 0);
}

main().catch((e) => { console.error('FATAL:', e.message); process.exit(1); });
