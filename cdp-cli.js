#!/usr/bin/env node
const WebSocket = require('ws');

const ws = new WebSocket('ws://localhost:1232');
let messageId = 0;
const pending = new Map();

ws.on('open', () => console.log('Connected to CDP Bridge at ws://localhost:1232'));
ws.on('error', (err) => { console.error('Connection error:', err.message); process.exit(1); });
ws.on('close', () => { console.log('Disconnected'); process.exit(0); });

ws.on('message', (data) => {
  const msg = JSON.parse(data.toString());
  if (msg.type === 'result' || msg.type === 'error') {
    const p = pending.get(msg.id);
    if (p) { pending.delete(msg.id); p(msg.result || msg.error); }
  } else if (msg.type === 'event') {
    console.log('[EVENT]', msg.event, msg.params);
  } else if (msg.type === 'tabRemoved') {
    console.log('[TAB REMOVED]', msg.tabId);
  } else if (msg.result && Array.isArray(msg.result)) {
    console.log('[TABS]', msg.result.map(t => `${t.tabId}: ${t.title}`).join('\n  '));
    pending.get('__tabs')?.(msg.result);
  }
});

function send(type, payload = {}) {
  return new Promise((resolve, reject) => {
    const id = ++messageId;
    pending.set(id, (r) => { if (r instanceof Error) reject(r); else resolve(r); });
    ws.send(JSON.stringify({ id, type, ...payload }));
  });
}

if (process.argv[2] === '--tabs') {
  send('tabs').then(() => process.exit(0));
} else if (process.argv[2] === '--exec') {
  const [tabId, method, ...args] = process.argv.slice(3);
  send('command', { tabId: parseInt(tabId), method, params: JSON.parse(args[0] || '{}') }).then(r => console.log(JSON.stringify(r, null, 2))).then(() => process.exit(0));
} else if (process.argv[2] === '--eval') {
  const [tabId, code] = process.argv.slice(3);
  send('command', { tabId: parseInt(tabId), method: 'Runtime.evaluate', params: { expression: code, returnByValue: true } }).then(r => console.log(r.result?.value)).then(() => process.exit(0));
} else {
  console.log('Usage:');
  console.log('  cdp-cli --tabs                  List all tabs');
  console.log('  cdp-cli --exec <tabId> <method> <params>  Run CDP command');
  console.log('  cdp-cli --eval <tabId> <code>     Evaluate JS in tab');
  process.exit(1);
}