const WebSocket = require('ws');
const ws = new WebSocket('ws://localhost:1232');
let id = 0;
const pending = new Map();

ws.on('open', async () => {
  console.log('Connected');
  const tabs = await send('tabs');
  console.log('Tabs:', tabs.result.map(t => `${t.tabId}: ${t.title.slice(0,50)}`).join('\n  '));
  process.exit(0);
});

ws.on('message', (data) => {
  const msg = JSON.parse(data);
  if (msg.type === 'result' || msg.type === 'error') {
    const p = pending.get(msg.id);
    if (p) { pending.delete(msg.id); p(msg); }
  }
});

function send(type, payload = {}) {
  return new Promise((resolve, reject) => {
    const i = ++id;
    pending.set(i, (r) => { if (r.type === 'error') reject(new Error(r.error)); else resolve(r); });
    ws.send(JSON.stringify({ id: i, type, ...payload }));
  });
}