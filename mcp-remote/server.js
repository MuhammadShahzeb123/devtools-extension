#!/usr/bin/env node
'use strict';

// Remote MCP server — bridges Claude.ai to the local CDP bridge.
//
//   Claude.ai ──HTTPS──▶ mcp.fumblemap.com/mcp/<SECRET>   (Streamable HTTP MCP)
//                                    │
//                                    ▼
//                              server.js (this file, port 51882)
//                                    ▲
//                        WebSocket relay /ws  (laptop connects OUT to here)
//                                    │
//                                    ▼
//                        laptop relay-agent.js
//                                    │  HTTP localhost:1232
//                                    ▼
//                        Chrome CDP bridge + extension
//
// Env (see .env.example):
//   PORT          listen port (default 51882)
//   MCP_SECRET    path secret for the MCP endpoint  ->  /mcp/<MCP_SECRET>
//   RELAY_TOKEN   shared token the laptop relay must present on /ws
//   JOB_TIMEOUT_MS how long to wait for the laptop relay (default 90000)

const http = require('http');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { WebSocketServer, WebSocket } = require('ws');
const { Server } = require('@modelcontextprotocol/sdk/server/index.js');
const { StreamableHTTPServerTransport } = require('@modelcontextprotocol/sdk/server/streamableHttp.js');
const { ListToolsRequestSchema, CallToolRequestSchema, isInitializeRequest } = require('@modelcontextprotocol/sdk/types.js');
const { TOOLS } = require('../lib/tools.js');

loadEnv();

const PORT           = Number(process.env.PORT) || 51882;
const MCP_SECRET     = process.env.MCP_SECRET || '';
const RELAY_TOKEN    = process.env.RELAY_TOKEN || '';
const JOB_TIMEOUT_MS = Number(process.env.JOB_TIMEOUT_MS) || 90_000;

const MCP_PATH   = `/mcp/${MCP_SECRET}`;
const RELAY_PATH = '/ws';

// ── MCP server (Streamable HTTP) ──────────────────────────────────────────────

// One Server instance per MCP session (a Protocol can only connect to a single
// transport). Each session gets a fresh Server + transport; subsequent requests
// are routed to the stored transport via the Mcp-Session-Id header.

function createMcpServer() {
  const server = new Server(
    { name: 'cdp-bridge-remote', version: '1.0.0' },
    { capabilities: { tools: {} } }
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }));

  server.setRequestHandler(CallToolRequestSchema, async (req) => {
    const { name, arguments: args } = req.params;
    return dispatchViaRelay(name, args || {});
  });

  return server;
}

const transports = new Map(); // sessionId -> StreamableHTTPServerTransport

// ── Relay job dispatch ────────────────────────────────────────────────────────

const pending = new Map(); // jobId -> { resolve(toolResult), timer }

function dispatchViaRelay(tool, args) {
  if (!relayReady()) {
    return {
      content: [{
        type: 'text',
        text: 'Error: no laptop relay is connected. Start relay-agent.js on the laptop (and keep the CDP bridge host running).',
      }],
      isError: true,
    };
  }

  const jobId = crypto.randomUUID();
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      pending.delete(jobId);
      resolve({
        content: [{ type: 'text', text: `Error: relay timed out after ${JOB_TIMEOUT_MS / 1000}s waiting for the laptop.` }],
        isError: true,
      });
    }, JOB_TIMEOUT_MS);
    pending.set(jobId, { resolve, timer });
    relay.send(JSON.stringify({ type: 'job', jobId, tool, args }));
  });
}

function onRelayResult(msg) {
  const entry = pending.get(msg.jobId);
  if (!entry) return;
  pending.delete(msg.jobId);
  clearTimeout(entry.timer);

  if (msg.ok && msg.image) {
    entry.resolve({ content: [{ type: 'image', data: msg.image.data, mimeType: msg.image.mimeType }] });
  } else if (msg.ok) {
    entry.resolve({ content: [{ type: 'text', text: msg.text || '(no output)' }] });
  } else {
    entry.resolve({ content: [{ type: 'text', text: `Error: ${msg.error}` }], isError: true });
  }
}

function rejectAllPending(reason) {
  for (const { resolve, timer } of pending.values()) {
    clearTimeout(timer);
    resolve({
      content: [{ type: 'text', text: `Error: ${reason}` }],
      isError: true,
    });
  }
  pending.clear();
}

// ── HTTP server ───────────────────────────────────────────────────────────────

const server = http.createServer(async (req, res) => {
  const pathname = (req.url || '/').split('?')[0];

  if (req.method === 'GET' && pathname === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true, relayConnected: relayReady(), version: '1.0.0' }));
    return;
  }

  if (pathname === MCP_PATH) {
    await handleMcpRequest(req, res);
    return;
  }

  res.writeHead(404, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: 'Not found' }));
});

async function handleMcpRequest(req, res) {
  let body;
  if (req.method === 'POST') {
    try {
      body = await readBody(req);
    } catch {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ jsonrpc: '2.0', error: { code: -32700, message: 'Parse error' }, id: null }));
      return;
    }
  } else {
    // GET is only meaningful for SSE reconnects; we always use JSON responses.
    res.writeHead(405, { 'Content-Type': 'application/json', 'Allow': 'POST' });
    res.end(JSON.stringify({ jsonrpc: '2.0', error: { code: -32005, message: 'Method Not Allowed' }, id: null }));
    return;
  }

  const sessionId = req.headers['mcp-session-id'];
  let transport = sessionId ? transports.get(sessionId) : undefined;

  if (!transport) {
    if (!body || !isInitializeRequest(body)) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ jsonrpc: '2.0', error: { code: -32000, message: 'Bad Request: no valid session' }, id: null }));
      return;
    }

    transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: () => crypto.randomUUID(),
      enableJsonResponse: true,
      onsessioninitialized: (sid) => { transports.set(sid, transport); },
    });

    const server = createMcpServer();
    await server.connect(transport);
  }

  try {
    await transport.handleRequest(req, res, body);
  } catch (err) {
    console.error('[mcp] handleRequest error:', err);
    if (!res.headersSent) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ jsonrpc: '2.0', error: { code: -32603, message: 'Internal error' }, id: null }));
    }
  }
}

// ── WebSocket relay (laptop phones home here) ─────────────────────────────────

let relay = null;

const wss = new WebSocketServer({ noServer: true });

server.on('upgrade', (req, socket, head) => {
  const pathname = (req.url || '/').split('?')[0];
  if (pathname !== RELAY_PATH) {
    socket.destroy();
    return;
  }

  const query = new URL(req.url, 'http://localhost').searchParams;
  const token = query.get('token') || '';
  if (!RELAY_TOKEN || token !== RELAY_TOKEN) {
    socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
    socket.destroy();
    return;
  }

  wss.handleUpgrade(req, socket, head, (ws) => {
    wss.emit('connection', ws, req);
  });
});

wss.on('connection', (ws) => {
  if (relayReady()) {
    ws.send(JSON.stringify({ type: 'error', message: 'A laptop relay is already connected. Disconnect it first.' }));
    ws.close();
    return;
  }

  relay = ws;
  relay.isAlive = true;
  console.log(`[relay] laptop relay connected (${new Date().toISOString()})`);

  ws.on('pong', () => { relay.isAlive = true; });

  ws.on('message', (data) => {
    let msg;
    try { msg = JSON.parse(data.toString()); } catch { return; }
    if (msg.type === 'result') onRelayResult(msg);
  });

  ws.on('close', () => {
    if (relay === ws) {
      relay = null;
      console.log(`[relay] laptop relay disconnected (${new Date().toISOString()})`);
      rejectAllPending('laptop relay disconnected before the job completed');
    }
  });

  ws.on('error', (err) => console.error('[relay] websocket error:', err.message));
});

const heartbeat = setInterval(() => {
  if (relay && relayReady()) {
    if (relay.isAlive === false) {
      relay.terminate();
      return;
    }
    relay.isAlive = false;
    relay.ping();
  }
}, 30_000);

function relayReady() {
  return !!relay && relay.readyState === WebSocket.OPEN;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (c) => {
      data += c;
      if (data.length > 2_000_000) { req.destroy(); reject(new Error('Body too large')); }
    });
    req.on('end', () => {
      try { resolve(data ? JSON.parse(data) : {}); }
      catch (e) { reject(e); }
    });
    req.on('error', reject);
  });
}

function loadEnv() {
  const p = path.join(__dirname, '.env');
  if (!fs.existsSync(p)) return;
  for (const line of fs.readFileSync(p, 'utf8').split('\n')) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const eq = t.indexOf('=');
    if (eq === -1) continue;
    const k = t.slice(0, eq).trim();
    let v = t.slice(eq + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    if (!(k in process.env)) process.env[k] = v;
  }
}

// ── Start ─────────────────────────────────────────────────────────────────────

server.listen(PORT, () => {
  console.log(`[cdp-bridge-remote] MCP server listening on port ${PORT}`);
  console.log(`[cdp-bridge-remote] MCP endpoint:  ${MCP_PATH}`);
  console.log(`[cdp-bridge-remote] Relay websocket: ${RELAY_PATH} (token required)`);
  if (!MCP_SECRET)  console.warn('[cdp-bridge-remote] WARNING: MCP_SECRET is not set — the MCP endpoint is unauthenticated!');
  if (!RELAY_TOKEN) console.warn('[cdp-bridge-remote] WARNING: RELAY_TOKEN is not set — anyone can connect a relay!');
});
