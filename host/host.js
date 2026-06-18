// host/host.js
'use strict';

const http = require('http');
const { readMessages, writeMessage } = require('./nm.js');

let msgId    = 0;
const pending = new Map(); // id -> { resolve, reject, timer }
let nmBuffer  = Buffer.alloc(0);

const PORT       = Number(process.env.CDP_BRIDGE_PORT) || 1232;
const TIMEOUT_MS = 30000;

// ── Helpers ───────────────────────────────────────────────────────────────────

function corsHeaders() {
  return {
    'Access-Control-Allow-Origin':  '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Type': 'application/json',
  };
}

function reply(res, status, body) {
  res.writeHead(status, corsHeaders());
  res.end(JSON.stringify(body));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (chunk) => { data += chunk; });
    req.on('end', () => {
      try { resolve(JSON.parse(data || '{}')); }
      catch { reject(new Error('Invalid JSON')); }
    });
    req.on('error', reject);
  });
}

function sendCommand(msg) {
  return new Promise((resolve, reject) => {
    const id = ++msgId;
    msg.id   = id;
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error('Extension did not respond within 30s'));
    }, TIMEOUT_MS);
    pending.set(id, { resolve, reject, timer });
    process.stdout.write(writeMessage(msg));
  });
}

// ── HTTP server ───────────────────────────────────────────────────────────────

const server = http.createServer(async (req, res) => {
  const { method, url } = req;

  // CORS preflight
  if (method === 'OPTIONS') {
    res.writeHead(204, corsHeaders());
    res.end();
    return;
  }

  if (method === 'GET' && url === '/health') {
    reply(res, 200, { ok: true });
    return;
  }

  if (method === 'GET' && url === '/tabs') {
    try {
      const result = await sendCommand({ type: 'tabs' });
      reply(res, 200, { result });
    } catch (err) {
      reply(res, 503, { error: err.message });
    }
    return;
  }

  // Self-describing command catalog — fetch once, no trial-and-error.
  if (method === 'GET' && url === '/palette') {
    try {
      const result = await sendCommand({ type: 'palette' });
      reply(res, 200, result); // { actions: [...] }
    } catch (err) {
      reply(res, 503, { error: err.message });
    }
    return;
  }

  // High-level palette action: { tabId, action, args }.
  if (method === 'POST' && url === '/action') {
    let body;
    try { body = await readBody(req); }
    catch { reply(res, 400, { error: 'Invalid JSON body' }); return; }

    const { tabId, action, args } = body;
    if (typeof tabId !== 'number' || typeof action !== 'string' || !action) {
      reply(res, 400, { error: 'Body must include numeric tabId and action string' });
      return;
    }

    try {
      const result = await sendCommand({ type: 'action', tabId, action, args: args || {} });
      reply(res, 200, { result });
    } catch (err) {
      reply(res, 500, { error: err.message });
    }
    return;
  }

  if (method === 'POST' && url === '/command') {
    let body;
    try { body = await readBody(req); }
    catch { reply(res, 400, { error: 'Invalid JSON body' }); return; }

    const { tabId, method: cdpMethod, params } = body;
    if (typeof tabId !== 'number' || !cdpMethod) {
      reply(res, 400, { error: 'Body must include numeric tabId and method string' });
      return;
    }

    try {
      const result = await sendCommand({ type: 'command', tabId, method: cdpMethod, params: params || {} });
      reply(res, 200, { result });
    } catch (err) {
      reply(res, 500, { error: err.message });
    }
    return;
  }

  reply(res, 404, { error: 'Not found' });
});

server.on('error', (err) => {
  process.stderr.write(`[cdp-bridge] HTTP server error: ${err.message}\n`);
  if (err.code === 'EADDRINUSE') {
    process.stderr.write('[cdp-bridge] Port 1232 already in use. Exiting gracefully.\n');
  }
  process.exit(1);
});

server.listen(PORT, () => {
  process.stderr.write(`[cdp-bridge] HTTP server listening on http://localhost:${PORT}\n`);
});

// ── Messages from the extension arrive on stdin ───────────────────────────────

process.stdin.on('data', (chunk) => {
  nmBuffer = Buffer.concat([nmBuffer, chunk]);
  const { messages, remaining } = readMessages(nmBuffer);
  nmBuffer = remaining;

  for (const msg of messages) {
    if (msg.type === 'result' || msg.type === 'error') {
      const entry = pending.get(msg.id);
      if (entry) {
        pending.delete(msg.id);
        clearTimeout(entry.timer);
        if (msg.type === 'error') entry.reject(new Error(msg.error));
        else entry.resolve(msg.result);
      }
    }
    // tabRemoved and CDP event messages are intentionally ignored
  }
});

process.stdin.on('end', () => process.exit(0));
