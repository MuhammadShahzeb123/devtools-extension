#!/usr/bin/env node
'use strict';

const BASE = 'http://127.0.0.1:1232';

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

async function main() {
  const args = process.argv.slice(2);
  const cmd  = args[0];

  if (cmd === '--tabs') {
    const r = await get('/tabs');
    if (r.error) { console.error('Error:', r.error); process.exit(1); }
    console.log(r.result.map(t => `${t.tabId}: ${t.title}`).join('\n'));

  } else if (cmd === '--exec') {
    const [tabId, method, paramsStr] = args.slice(1);
    const r = await post('/command', {
      tabId: parseInt(tabId),
      method,
      params: JSON.parse(paramsStr || '{}'),
    });
    if (r.error) { console.error('Error:', r.error); process.exit(1); }
    console.log(JSON.stringify(r.result, null, 2));

  } else if (cmd === '--eval') {
    const [tabId, ...rest] = args.slice(1);
    const r = await post('/command', {
      tabId: parseInt(tabId),
      method: 'Runtime.evaluate',
      params: { expression: rest.join(' '), returnByValue: true },
    });
    if (r.error) { console.error('Error:', r.error); process.exit(1); }
    console.log(r.result?.result?.value ?? JSON.stringify(r.result));

  } else {
    console.log('Usage:');
    console.log('  cdp-cli --tabs                         List tabs');
    console.log('  cdp-cli --exec <id> <method> [params]  Run CDP method');
    console.log('  cdp-cli --eval <id> <js>               Run JS in tab');
  }
}

main().catch(err => { console.error(err.message); process.exit(1); });