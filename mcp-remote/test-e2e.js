#!/usr/bin/env node
'use strict';

// Local end-to-end test: spawns server.js + relay-agent.js, then drives an MCP
// client through initialize / tools/list / tools/call and prints the result.
//
// Usage:
//   node test-e2e.js                          # browser_tabs
//   node test-e2e.js browser_navigate '{"tabId":1,"url":"https://example.com"}'
//   node test-e2e.js browser_read_text '{"tabId":1}'

const { spawn } = require('child_process');
const path = require('path');

const PORT = 51899; // test port, avoids clashing with anything on 51882
const MCP_SECRET = 'test-secret';
const RELAY_TOKEN = 'test-relay-token';

const [,, toolNameArg, toolArgsArg] = process.argv;
const toolName = process.env.TOOL_NAME || toolNameArg;
const toolArgsJson = process.env.TOOL_ARGS || toolArgsArg;

const base = path.join(__dirname);
const serverEnv = { ...process.env, PORT: String(PORT), MCP_SECRET, RELAY_TOKEN };
const relayEnv = { ...process.env, RELAY_URL: `ws://127.0.0.1:${PORT}/ws`, RELAY_TOKEN };

const procs = [];
function run(name, file, env) {
  const p = spawn(process.execPath, [file], { env, cwd: base });
  p.on('exit', (code) => console.log(`[${name}] exited code=${code}`));
  p.stdout.on('data', (d) => process.stdout.write(`[${name}] ${d}`));
  p.stderr.on('data', (d) => process.stderr.write(`[${name}ERR] ${d}`));
  procs.push(p);
  return p;
}

function cleanup() {
  for (const p of procs) { try { p.kill(); } catch {} }
}

async function main() {
  run('server', 'server.js', serverEnv);
  run('relay', 'relay-agent.js', relayEnv);

  await sleep(1800);

  const client = spawn(process.execPath, ['test-client.js', ...(toolName ? [toolName, toolArgsJson || '{}'] : [])], {
    env: { ...process.env, MCP_URL: `http://127.0.0.1:${PORT}/mcp/${MCP_SECRET}` },
    cwd: base,
  });
  client.stdout.on('data', (d) => process.stdout.write(d));
  client.stderr.on('data', (d) => process.stderr.write(d));
  client.on('exit', (code) => {
    console.log(`\n[client] exit code=${code}`);
    cleanup();
    process.exit(code);
  });
  setTimeout(() => { console.error('\n[client] TIMEOUT'); cleanup(); process.exit(3); }, 60_000);
}

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

main().catch((e) => { console.error(e); cleanup(); process.exit(1); });
