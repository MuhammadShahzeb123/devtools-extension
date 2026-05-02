#!/usr/bin/env node
'use strict';

const readline = require('readline');

const BASE = 'http://127.0.0.1:1232';
let currentTabId = null;
const tabs = new Map();

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

async function queryTabs() {
  const r = await get('/tabs');
  if (r.error) { console.error('Error:', r.error); return; }
  tabs.clear();
  r.result.forEach(t => tabs.set(t.tabId, t));
  console.log('\nOpen Tabs:');
  r.result.forEach(t => console.log(`  ${t.tabId}: ${(t.title || t.url || '').slice(0, 60)}`));
  console.log('');
}

async function evaluate(code) {
  if (!currentTabId) return console.log('No tab selected. Use "use <id>" first.');
  const r = await post('/command', {
    tabId: currentTabId,
    method: 'Runtime.evaluate',
    params: { expression: code, returnByValue: true },
  });
  if (r.error) { console.error('Error:', r.error); return; }
  console.log(r.result?.result?.value ?? JSON.stringify(r.result));
}

async function navigate(url) {
  if (!currentTabId) return console.log('No tab selected. Use "use <id>" first.');
  const r = await post('/command', {
    tabId: currentTabId,
    method: 'Page.navigate',
    params: { url },
  });
  if (r.error) { console.error('Error:', r.error); return; }
  console.log('Navigated.');
}

function help() {
  console.log('Commands:');
  console.log('  tabs              List open tabs');
  console.log('  use <id>          Select active tab');
  console.log('  eval <js>         Run JavaScript in selected tab');
  console.log('  navigate <url>    Navigate selected tab to URL');
  console.log('  help              Show this help');
}

async function main() {
  try {
    await get('/health');
  } catch {
    console.error(`Cannot reach CDP Bridge at ${BASE}`);
    console.error('Start the host with:  node host/host.js');
    process.exit(1);
  }

  console.log(`Connected to CDP Bridge (${BASE})`);
  console.log('Type "help" for commands, "tabs" to list open tabs\n');
  await queryTabs();

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout, prompt: '> ' });
  rl.prompt();

  rl.on('line', async (line) => {
    const [cmd, ...args] = line.trim().split(/\s+/);
    if (!cmd || cmd === 'help') {
      help();
    } else if (cmd === 'tabs') {
      await queryTabs();
    } else if (cmd === 'use') {
      const id = parseInt(args[0]);
      if (tabs.has(id)) { currentTabId = id; console.log(`Using tab ${id}`); }
      else console.log('Tab not found. Run "tabs" first.');
    } else if (cmd === 'eval') {
      await evaluate(args.join(' '));
    } else if (cmd === 'navigate') {
      await navigate(args.join(' '));
    } else {
      console.log('Unknown command. Type "help".');
    }
    rl.prompt();
  });

  rl.on('close', () => process.exit(0));
}

main().catch(err => { console.error(err.message); process.exit(1); });