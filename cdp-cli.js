#!/usr/bin/env node
const WebSocket = require('ws');

let ws, messageId = 0;
const pending = new Map();

function connect() {
  return new Promise((resolve) => {
    ws = new WebSocket('ws://localhost:1232');
    ws.on('open', resolve);
    ws.on('error', (err) => { console.error('Error:', err.message); process.exit(1); });
    ws.on('message', (data) => {
      const msg = JSON.parse(data);
      if (msg.type === 'result' || msg.type === 'error') {
        const p = pending.get(msg.id);
        if (p) { pending.delete(msg.id); p(msg); }
      } else if (msg.type === 'event') {
        console.log('[EVENT]', msg.event);
      } else if (msg.result && Array.isArray(msg.result)) {
        pending.get('__tabs')?.(msg.result);
      }
    });
  });
}

function send(type, payload = {}) {
  return new Promise((resolve, reject) => {
    const id = ++messageId;
    pending.set(id, (r) => { if (r.type === 'error') reject(new Error(r.error)); else resolve(r); });
    ws.send(JSON.stringify({ id, type, ...payload }));
  });
}

async function main() {
  await connect();
  console.log('Connected to CDP Bridge');
  
  const args = process.argv[2];
  if (args === '--tabs') {
    const r = await send('tabs');
    console.log(r.result.map(t => `${t.tabId}: ${t.title}`).join('\n  '));
  } else if (args === '--exec') {
    const [tabId, method, ...args2] = process.argv.slice(3);
    const r = await send('command', { tabId: parseInt(tabId), method, params: JSON.parse(args2[0] || '{}') });
    console.log(JSON.stringify(r.result, null, 2));
  } else if (args === '--eval') {
    const [tabId, code] = process.argv.slice(3);
    const r = await send('command', { tabId: parseInt(tabId), method: 'Runtime.evaluate', params: { expression: code, returnByValue: true } });
    console.log(r.result?.value);
  } else {
    console.log('Usage:');
    console.log('  cdp-cli --tabs                 List tabs');
    console.log('  cdp-cli --exec <id> <method>   Run CDP');
    console.log('  cdp-cli --eval <id> <js>      Run JS');
  }
  process.exit(0);
}

main();