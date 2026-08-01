#!/usr/bin/env node
'use strict';

// CDP Bridge — MCP Server (local, stdio transport)
// Exposes Chrome browser control as MCP tools for OpenCode and other MCP clients.
// Transport: stdio (JSON-RPC 2.0, one message per line)
// Bridge:    http://127.0.0.1:1232 (set CDP_BRIDGE_BASE to override)
//
// Tool schemas and bridge logic live in lib/ so the same catalog is shared by
// the remote VPS server (mcp-remote/server.js) and the laptop relay
// (mcp-remote/relay-agent.js).

const { TOOLS } = require('./lib/tools.js');
const { callTool } = require('./lib/call-tool.js');

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

process.stderr.write(`[cdp-bridge-mcp] MCP server ready. Bridge: ${process.env.CDP_BRIDGE_BASE || 'http://127.0.0.1:1232'}\n`);
