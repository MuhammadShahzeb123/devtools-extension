#!/usr/bin/env node
'use strict';

// Laptop relay agent — phones home to the remote MCP server over WebSocket and
// executes browser jobs against the local CDP bridge (localhost:1232).
//
//   remote MCP server ──wss /ws──▶ relay-agent.js ──HTTP 127.0.0.1:1232──▶ Chrome
//
// Env (see .env.example):
//   RELAY_URL        e.g. wss://mcp.fumblemap.com/ws  (or ws://127.0.0.1:51882/ws locally)
//   RELAY_TOKEN      must match RELAY_TOKEN on the server
//   CDP_BRIDGE_BASE  override bridge base (default http://127.0.0.1:1232)

const fs = require('fs');
const path = require('path');
const WebSocket = require('ws');
const { callTool } = require('../lib/call-tool.js');

loadEnv();

const RELAY_URL   = process.env.RELAY_URL || 'ws://127.0.0.1:51882/ws';
const RELAY_TOKEN = process.env.RELAY_TOKEN || '';

let ws = null;
let closing = false;
let attempts = 0;

function log(...a) {
  console.log(`[relay] ${new Date().toISOString()}`, ...a);
}

function targetUrl() {
  const sep = RELAY_URL.includes('?') ? '&' : '?';
  return `${RELAY_URL}${sep}token=${encodeURIComponent(RELAY_TOKEN)}`;
}

function connect() {
  if (closing) return;
  ws = new WebSocket(targetUrl());

  ws.on('open', () => {
    attempts = 0;
    log(`connected to ${RELAY_URL}`);
  });

  ws.on('message', (data) => { void handleMessage(data); });

  ws.on('close', () => {
    log('disconnected');
    if (!closing) scheduleReconnect();
  });

  ws.on('error', (err) => log('websocket error:', err.message));
}

function scheduleReconnect() {
  const delay = Math.min(30_000, 1000 * 2 ** attempts++);
  log(`reconnecting in ${Math.round(delay / 1000)}s`);
  setTimeout(connect, delay);
}

async function handleMessage(data) {
  let msg;
  try { msg = JSON.parse(data.toString()); } catch { return; }
  if (msg.type !== 'job') return;

  const { jobId, tool, args } = msg;
  log(`job ${jobId} → ${tool}`);
  const started = Date.now();

  let reply;
  try {
    const out = await callTool(tool, args || {});
    if (out.image) {
      reply = { type: 'result', jobId, ok: true, image: { data: out.image.data, mimeType: out.image.mimeType } };
    } else {
      reply = { type: 'result', jobId, ok: true, text: out.text || '' };
    }
  } catch (err) {
    reply = { type: 'result', jobId, ok: false, error: err.message };
  }

  log(`job ${jobId} done in ${Date.now() - started}ms`);
  if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(reply));
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

process.on('SIGINT', () => { closing = true; if (ws) ws.close(); setTimeout(() => process.exit(0), 300); });
process.on('SIGTERM', () => { closing = true; if (ws) ws.close(); setTimeout(() => process.exit(0), 300); });

log(`relay agent starting — bridge base ${process.env.CDP_BRIDGE_BASE || 'http://127.0.0.1:1232'}`);
connect();
