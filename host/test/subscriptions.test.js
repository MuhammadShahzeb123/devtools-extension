// host/test/subscriptions.test.js
'use strict';
const { test } = require('node:test');
const assert   = require('node:assert');
const SubscriptionManager = require('../subscriptions.js');

test('add + getClients: registered client is returned', () => {
  const mgr = new SubscriptionManager();
  const client = {};
  mgr.add(123, 'Network.requestWillBeSent', client);
  assert.ok(mgr.getClients(123, 'Network.requestWillBeSent').has(client));
});

test('getClients: returns empty set for unknown key', () => {
  const mgr = new SubscriptionManager();
  assert.strictEqual(mgr.getClients(99, 'Page.loadEventFired').size, 0);
});

test('remove: clears all subscriptions for a given client', () => {
  const mgr = new SubscriptionManager();
  const client = {};
  mgr.add(123, 'Network.requestWillBeSent', client);
  mgr.add(456, 'Page.loadEventFired', client);
  mgr.remove(client);
  assert.strictEqual(mgr.getClients(123, 'Network.requestWillBeSent').size, 0);
  assert.strictEqual(mgr.getClients(456, 'Page.loadEventFired').size, 0);
});

test('remove: does not affect subscriptions of other clients', () => {
  const mgr = new SubscriptionManager();
  const a = {}, b = {};
  mgr.add(123, 'Network.requestWillBeSent', a);
  mgr.add(123, 'Network.requestWillBeSent', b);
  mgr.remove(a);
  const clients = mgr.getClients(123, 'Network.requestWillBeSent');
  assert.ok(!clients.has(a));
  assert.ok(clients.has(b));
});

test('fan-out: two clients for same event both appear in getClients', () => {
  const mgr = new SubscriptionManager();
  const a = {}, b = {};
  mgr.add(123, 'Page.loadEventFired', a);
  mgr.add(123, 'Page.loadEventFired', b);
  const clients = mgr.getClients(123, 'Page.loadEventFired');
  assert.strictEqual(clients.size, 2);
  assert.ok(clients.has(a) && clients.has(b));
});

test('remove: cleans up empty internal sets (no leaks)', () => {
  const mgr = new SubscriptionManager();
  const client = {};
  mgr.add(1, 'Page.loadEventFired', client);
  mgr.remove(client);
  assert.strictEqual(mgr.getClients(1, 'Page.loadEventFired').size, 0);
});
