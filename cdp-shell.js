#!/usr/bin/env node
const readline = require('readline');
const WebSocket = require('ws');

const ws = new WebSocket('ws://localhost:1232');
let messageId = 0;
let currentTabId = null;
let ready = false;
let commandQueue = [];
const pending = new Map();
const tabs = new Map();

ws.on('open', () => {
  ready = true;
  console.log('🔌 Connected to CDP Bridge (ws://localhost:1232)');
  console.log('Type "help" for commands, "tabs" to list open tabs\n');
  queryTabs();
});
ws.on('error', (err) => console.error('Error:', err.message));
ws.on('close', () => { console.log('Disconnected'); process.exit(0); });

ws.on('message', (data) => {
  const msg = JSON.parse(data.toString());
  if (msg.type === 'result' || msg.type === 'error') {
    const p = pending.get(msg.id);
    if (p) { pending.delete(msg.id); p(msg); }
  } else if (msg.type === 'event') {
    console.log(`[EVENT ${msg.event}]`);
  } else if (msg.type === 'tabRemoved') {
    if (tabs.has(msg.tabId)) { tabs.delete(msg.tabId); console.log(`Tab ${msg.tabId} closed`); }
  } else if (msg.result && Array.isArray(msg.result)) {
    tabs.clear();
    msg.result.forEach(t => tabs.set(t.tabId, t));
    console.log('\n📑 Open Tabs:');
    msg.result.forEach(t => console.log(`  ${t.tabId}: ${t.title.replace(/<[^>]*>/g,'').slice(0,60)}`));
    console.log('');
    if (currentTabId && !tabs.has(currentTabId)) currentTabId = null;
  }
});

const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: false });
rl.on('line', async (line) => {
  if (!ready) return console.log('Waiting for connection...');
  const [cmd, ...args] = line.trim().split(/\s+/);
  if (!cmd || cmd === 'help') return console.log('Commands:\n  tabs              List open tabs\n  use <id>          Select active tab\n  eval <js>         Run JavaScript in tab\n  navigate <url>   Navigate tab to URL\n  network          Enable network monitoring');
  if (cmd === 'tabs') return queryTabs();
  if (cmd === 'use') return useTab(parseInt(args[0]));
  if (cmd === 'eval') return evaluate(args.join(' '));
  if (cmd === 'navigate') return navigate(args.join(' '));
  if (cmd === 'network') return enableNetwork();
  console.log('Unknown command. Type "help".');
});

function send(type, payload = {}) {
  return new Promise((resolve, reject) => {
    const id = ++messageId;
    pending.set(id, (r) => { if (r.type === 'error') reject(new Error(r.error)); else resolve(r); });
    ws.send(JSON.stringify({ id, type, ...payload }));
  });
}

function queryTabs() { send('tabs'); }
function useTab(id) { if (tabs.has(id)) { currentTabId = id; console.log(`Using tab ${id}`); } else console.log('Tab not found'); }
async function evaluate(code) {
  if (!currentTabId) return console.log('No tab selected. Use "use <id>" first.');
  const r = await send('command', { tabId: currentTabId, method: 'Runtime.evaluate', params: { expression: code, returnByValue: true } });
  console.log(r.result?.value || r.result);
}
async function navigate(url) {
  if (!currentTabId) return console.log('No tab selected. Use "use <id>" first.');
  await send('command', { tabId: currentTabId, method: 'Page.navigate', params: { url } });
}
async function enableNetwork() {
  if (!currentTabId) return console.log('No tab selected. Use "use <id>" first.');
  await send('command', { tabId: currentTabId, method: 'Network.enable' });
}