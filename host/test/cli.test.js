// host/test/cli.test.js
// Integration tests for cdp-cli.js @file and stdin input modes.
// Spins up a tiny mock HTTP server to capture what the CLI sends.
'use strict';

const { test, before, after } = require('node:test');
const assert   = require('node:assert');
const http     = require('node:http');
const { spawn } = require('node:child_process');
const fs       = require('node:fs');
const os       = require('node:os');
const path     = require('node:path');

const CLI = path.join(__dirname, '..', '..', 'cdp-cli.js');
let server, serverPort, lastBody;

// Capture the last POST body the mock server receives
before(() => new Promise((resolve) => {
  server = http.createServer((req, res) => {
    let data = '';
    req.on('data', (c) => { data += c; });
    req.on('end', () => {
      try { lastBody = JSON.parse(data || '{}'); } catch { lastBody = null; }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ result: { ok: true } }));
    });
  });
  server.listen(0, '127.0.0.1', () => {
    serverPort = server.address().port;
    resolve();
  });
}));

after(() => server.close());

// Helper: run cdp-cli.js with given args, optionally piping stdinText.
// Returns { code, stdout, stderr }.
function runCli(cliArgs, stdinText = null) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [CLI, ...cliArgs], {
      env: { ...process.env, CDP_BRIDGE_BASE: `http://127.0.0.1:${serverPort}` },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let stdout = '', stderr = '';
    child.stdout.on('data', (c) => { stdout += c; });
    child.stderr.on('data', (c) => { stderr += c; });
    if (stdinText !== null) {
      child.stdin.write(stdinText);
      child.stdin.end();
    } else {
      child.stdin.end();
    }
    child.on('close', (code) => resolve({ code, stdout, stderr }));
  });
}

// ── --do ─────────────────────────────────────────────────────────────────────

test('--do with inline JSON (baseline)', async () => {
  await runCli(['--do', '1', 'navigate', '{"url":"https://example.com"}']);
  assert.strictEqual(lastBody.action, 'navigate');
  assert.deepStrictEqual(lastBody.args, { url: 'https://example.com' });
});

test('--do with @file JSON arg', async () => {
  const tmp = path.join(os.tmpdir(), `cdp-test-${Date.now()}.json`);
  fs.writeFileSync(tmp, JSON.stringify({ url: 'https://file-arg.example.com' }));
  try {
    await runCli(['--do', '1', 'navigate', `@${tmp}`]);
    assert.strictEqual(lastBody.action, 'navigate');
    assert.deepStrictEqual(lastBody.args, { url: 'https://file-arg.example.com' });
  } finally {
    fs.unlinkSync(tmp);
  }
});

test('--do with stdin JSON arg (-)', async () => {
  const json = JSON.stringify({ url: 'https://stdin.example.com' });
  await runCli(['--do', '1', 'navigate', '-'], json);
  assert.strictEqual(lastBody.action, 'navigate');
  assert.deepStrictEqual(lastBody.args, { url: 'https://stdin.example.com' });
});

test('--do with no args defaults to empty object', async () => {
  await runCli(['--do', '1', 'reload']);
  assert.deepStrictEqual(lastBody.args, {});
});

// ── --exec ───────────────────────────────────────────────────────────────────

test('--exec with inline JSON params (baseline)', async () => {
  await runCli(['--exec', '1', 'Runtime.evaluate', '{"expression":"1+1","returnByValue":true}']);
  assert.strictEqual(lastBody.method, 'Runtime.evaluate');
  assert.deepStrictEqual(lastBody.params, { expression: '1+1', returnByValue: true });
});

test('--exec with @file params', async () => {
  const params = { expression: 'document.querySelector("textarea").value', returnByValue: true };
  const tmp = path.join(os.tmpdir(), `cdp-params-${Date.now()}.json`);
  fs.writeFileSync(tmp, JSON.stringify(params));
  try {
    await runCli(['--exec', '1', 'Runtime.evaluate', `@${tmp}`]);
    assert.strictEqual(lastBody.method, 'Runtime.evaluate');
    assert.deepStrictEqual(lastBody.params, params);
  } finally {
    fs.unlinkSync(tmp);
  }
});

test('--exec with stdin params (-)', async () => {
  const params = { expression: 'document.title', returnByValue: true };
  await runCli(['--exec', '1', 'Runtime.evaluate', '-'], JSON.stringify(params));
  assert.strictEqual(lastBody.method, 'Runtime.evaluate');
  assert.deepStrictEqual(lastBody.params, params);
});

// ── --eval ───────────────────────────────────────────────────────────────────

test('--eval with inline expression (baseline)', async () => {
  await runCli(['--eval', '1', 'document.title']);
  assert.strictEqual(lastBody.method, 'Runtime.evaluate');
  assert.strictEqual(lastBody.params.expression, 'document.title');
});

test('--eval with multi-word inline expression (baseline)', async () => {
  await runCli(['--eval', '1', 'document', 'title']);
  assert.strictEqual(lastBody.params.expression, 'document title');
});

test('--eval with @file expression', async () => {
  const expr = 'document.querySelector("textarea").value';
  const tmp = path.join(os.tmpdir(), `cdp-expr-${Date.now()}.js`);
  fs.writeFileSync(tmp, expr);
  try {
    await runCli(['--eval', '1', `@${tmp}`]);
    assert.strictEqual(lastBody.params.expression, expr);
  } finally {
    fs.unlinkSync(tmp);
  }
});

test('--eval with stdin expression (-)', async () => {
  const expr = 'document.querySelector("textarea").value';
  await runCli(['--eval', '1', '-'], expr);
  assert.strictEqual(lastBody.params.expression, expr);
});
