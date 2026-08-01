#!/usr/bin/env node
'use strict';

const fs   = require('fs');
const BASE = process.env.CDP_BRIDGE_BASE || 'http://127.0.0.1:1232';

async function get(path) {
  const r = await fetch(`${BASE}${path}`);
  return r.json();
}

async function post(path, body) {
  const r = await fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return r.json();
}

function readStdin() {
  return new Promise((resolve) => {
    const chunks = [];
    process.stdin.on('data', (c) => chunks.push(c));
    process.stdin.on('end', () => resolve(Buffer.concat(chunks).toString('utf8').trimEnd()));
  });
}

// Resolves a CLI arg that may be:
//   '-'       → read raw text from stdin, then JSON.parse
//   '@<path>' → read file at <path>, then JSON.parse
//   else      → JSON.parse directly (or {} if missing)
async function resolveJSON(str) {
  if (!str) return {};
  if (str === '-') return JSON.parse(await readStdin());
  if (str.startsWith('@')) return JSON.parse(fs.readFileSync(str.slice(1), 'utf8'));
  return JSON.parse(str);
}

// Same as resolveJSON but returns the raw string (for JS expressions in --eval).
async function resolveText(str) {
  if (!str) return '';
  if (str === '-') return readStdin();
  if (str.startsWith('@')) return fs.readFileSync(str.slice(1), 'utf8').trimEnd();
  return str;
}

async function main() {
  const args = process.argv.slice(2);
  const cmd  = args[0];

  if (cmd === '--tabs') {
    const r = await get('/tabs');
    if (r.error) { console.error('Error:', r.error); process.exit(1); }
    console.log(r.result.map(t => `${t.tabId}: ${t.title}`).join('\n'));

  } else if (cmd === '--exec') {
    const [tabId, method, paramsArg] = args.slice(1);
    const r = await post('/command', {
      tabId: parseInt(tabId),
      method,
      params: await resolveJSON(paramsArg),
    });
    if (r.error) { console.error('Error:', r.error); process.exit(1); }
    console.log(JSON.stringify(r.result, null, 2));

  } else if (cmd === '--eval') {
    const [tabId, exprArg, ...rest] = args.slice(1);
    let expression;
    if (exprArg === '-' || (exprArg && exprArg.startsWith('@'))) {
      expression = await resolveText(exprArg);
    } else {
      expression = [exprArg, ...rest].filter(Boolean).join(' ');
    }
    const r = await post('/command', {
      tabId: parseInt(tabId),
      method: 'Runtime.evaluate',
      params: { expression, returnByValue: true },
    });
    if (r.error) { console.error('Error:', r.error); process.exit(1); }
    console.log(r.result?.result?.value ?? JSON.stringify(r.result));

  } else if (cmd === '--palette') {
    const r = await get('/palette');
    if (r.error) { console.error('Error:', r.error); process.exit(1); }
    for (const a of r.actions) {
      const argNames = (a.args || []).map(x => (x.required ? x.name : x.name + '?')).join(', ');
      console.log(`${a.name}(${argNames})`);
      console.log(`    ${a.summary}`);
    }

  } else if (cmd === '--do') {
    const [tabId, action, argsArg] = args.slice(1);
    const r = await post('/action', {
      tabId: parseInt(tabId),
      action,
      args: await resolveJSON(argsArg),
    });
    if (r.error) { console.error('Error:', r.error); process.exit(1); }
    console.log(JSON.stringify(r.result, null, 2));

  } else if (cmd === '--network') {
    const [tabId, filtersArg] = args.slice(1);
    const r = await post('/network', {
      tabId: parseInt(tabId),
      ...(await resolveJSON(filtersArg)),
    });
    if (r.error) { console.error('Error:', r.error); process.exit(1); }
    console.log(JSON.stringify(r.result, null, 2));

  } else if (cmd === '--cookies') {
    const urls = args.slice(1);
    const r = await post('/cookies', { urls: urls.length ? urls : ['https://x.com'] });
    if (r.error) { console.error('Error:', r.error); process.exit(1); }
    console.log(JSON.stringify(r.result, null, 2));

  } else if (cmd === '--network-clear') {
    const [tabId] = args.slice(1);
    const r = await post('/network/clear', { tabId: tabId == null ? undefined : parseInt(tabId) });
    if (r.error) { console.error('Error:', r.error); process.exit(1); }
    console.log(JSON.stringify(r.result, null, 2));

  } else {
    console.log('Usage:');
    console.log('  cdp-cli --tabs                              List tabs');
    console.log('  cdp-cli --palette                           List palette commands');
    console.log('  cdp-cli --do  <id> <action> [JSON|-|@file]  Run a palette action');
    console.log('  cdp-cli --exec <id> <method> [JSON|-|@file] Run raw CDP method');
    console.log('  cdp-cli --eval <id> <js|-|@file>            Run JS in tab');
    console.log('  cdp-cli --cookies [url...]                  Dump all cookies (incl. HttpOnly)');
    console.log('  cdp-cli --network <id> [JSON|-|@file]       Show recorded network requests');
    console.log('  cdp-cli --network-clear [id]                Clear recorded network requests');
    console.log('');
    console.log('  JSON arg formats:');
    console.log("    inline:  '{\"url\":\"https://...\"}' (simple cases only on Windows)");
    console.log('    file:    @args.json              (avoids all shell escaping)');
    console.log('    stdin:   -                       (pipe JSON via PowerShell heredoc)');
  }
}

main().catch(err => { console.error(err.message); process.exit(1); });
