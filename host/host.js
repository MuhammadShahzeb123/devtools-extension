// host/host.js
'use strict';

const { WebSocketServer, WebSocket } = require('ws');
const { readMessages, writeMessage }  = require('./nm.js');
const SubscriptionManager             = require('./subscriptions.js');

const subs    = new SubscriptionManager();
const pending = new Map(); // id -> WebSocket client
let nmBuffer  = Buffer.alloc(0);

const wss = new WebSocketServer({ port: 1232 });

wss.on('connection', (ws) => {
  ws.on('message', (data) => {
    let msg;
    try { msg = JSON.parse(data); } catch { return; }

    if (msg.type === 'tabs' || msg.type === 'command') {
      pending.set(msg.id, ws);
      process.stdout.write(writeMessage(msg));
    } else if (msg.type === 'subscribe') {
      subs.add(msg.tabId, msg.event, ws);
      pending.set(msg.id, ws);
      process.stdout.write(writeMessage(msg));
    }
  });

  ws.on('close', () => {
    subs.remove(ws);
    for (const [id, client] of pending) {
      if (client === ws) pending.delete(id);
    }
  });

  ws.on('error', () => {}); // prevent unhandled error crashes
});

// Messages from the extension arrive on stdin
process.stdin.on('data', (chunk) => {
  nmBuffer = Buffer.concat([nmBuffer, chunk]);
  const { messages, remaining } = readMessages(nmBuffer);
  nmBuffer = remaining;

  for (const msg of messages) {
    if (msg.type === 'event') {
      for (const client of subs.getClients(msg.tabId, msg.event)) {
        if (client.readyState === WebSocket.OPEN) {
          client.send(JSON.stringify(msg));
        }
      }
    } else if (msg.type === 'result' || msg.type === 'error') {
      const client = pending.get(msg.id);
      if (client) {
        pending.delete(msg.id);
        if (client.readyState === WebSocket.OPEN) {
          client.send(JSON.stringify(msg));
        }
      }
    }
  }
});

process.stdin.on('end', () => process.exit(0));
