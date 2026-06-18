// host/test/action.test.js
// Integration test for the command-palette HTTP routes (/palette, /action).
// Spawns host.js and plays the role of the extension over Native Messaging
// stdio — so routing, validation, and the NM bridge are verified without Chrome.
'use strict';

const { test, before, after } = require('node:test');
const assert = require('node:assert');
const { spawn } = require('node:child_process');
const path = require('node:path');
const { readMessages, writeMessage } = require('../nm.js');

const HOST_DIR = path.join(__dirname, '..');
const HOST_JS = path.join(HOST_DIR, 'host.js');
const PORT = 12321;
const BASE = `http://127.0.0.1:${PORT}`;

let child;
let stdoutBuf = Buffer.alloc(0);

// Stand in for the extension: answer each message the host forwards to us.
function respondAsExtension(m) {
  if (!m || !m.id) return;
  let reply;
  if (m.type === 'palette') {
    reply = { id: m.id, type: 'result', result: { actions: [
      { name: 'click', summary: 'Click an element.', args: [], returns: '{ clicked }', example: null },
    ] } };
  } else if (m.type === 'action') {
    reply = { id: m.id, type: 'result', result: { ok: true, action: m.action, args: m.args } };
  } else if (m.type === 'tabs') {
    reply = { id: m.id, type: 'result', result: [{ tabId: 1, url: 'about:blank', title: 't', attached: true }] };
  } else {
    reply = { id: m.id, type: 'error', error: 'unhandled' };
  }
  child.stdin.write(writeMessage(reply));
}

before(() => new Promise((resolve, reject) => {
  child = spawn(process.execPath, [HOST_JS], {
    cwd: HOST_DIR,
    env: { ...process.env, CDP_BRIDGE_PORT: String(PORT) },
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  child.stdout.on('data', (chunk) => {
    stdoutBuf = Buffer.concat([stdoutBuf, chunk]);
    const { messages, remaining } = readMessages(stdoutBuf);
    stdoutBuf = remaining;
    for (const m of messages) respondAsExtension(m);
  });
  child.stderr.on('data', (d) => {
    if (String(d).includes('listening')) resolve();
  });
  child.on('error', reject);
  setTimeout(() => reject(new Error('host did not start')), 5000);
}));

after(() => { if (child) child.kill(); });

const postAction = (body) =>
  fetch(`${BASE}/action`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

test('GET /health responds without the extension', async () => {
  const r = await fetch(`${BASE}/health`);
  assert.strictEqual(r.status, 200);
  assert.deepStrictEqual(await r.json(), { ok: true });
});

test('GET /palette forwards to the extension and returns the catalog', async () => {
  const r = await fetch(`${BASE}/palette`);
  assert.strictEqual(r.status, 200);
  const body = await r.json();
  assert.ok(Array.isArray(body.actions), 'actions should be an array');
  assert.strictEqual(body.actions[0].name, 'click');
});

test('POST /action forwards action + args and returns the result', async () => {
  const r = await postAction({ tabId: 1, action: 'click', args: { selector: '#x' } });
  assert.strictEqual(r.status, 200);
  const body = await r.json();
  assert.strictEqual(body.result.ok, true);
  assert.strictEqual(body.result.action, 'click');
  assert.deepStrictEqual(body.result.args, { selector: '#x' });
});

test('POST /action rejects a missing action', async () => {
  const r = await postAction({ tabId: 1 });
  assert.strictEqual(r.status, 400);
  assert.match((await r.json()).error, /action string/);
});

test('POST /action rejects a non-numeric tabId', async () => {
  const r = await postAction({ tabId: 'nope', action: 'click' });
  assert.strictEqual(r.status, 400);
});
