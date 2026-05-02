// extension/background.js
'use strict';

const HOST_NAME       = 'com.cdpbridge.host';
const DEBUGGER_VERSION = '1.3';

let port      = null;
let backoffMs = 1000;
const attached = new Set(); // tabIds with chrome.debugger attached

// ── Native Messaging connection ───────────────────────────────────────────────

function connect() {
  try {
    port = chrome.runtime.connectNative(HOST_NAME);
  } catch (_) {
    scheduleReconnect();
    return;
  }

  port.onMessage.addListener(onHostMessage);

  port.onDisconnect.addListener(() => {
    port = null;
    void chrome.runtime.lastError; // consume to suppress console error
    scheduleReconnect();
  });

  backoffMs = 1000;
  attachAllTabs();
}

// Note: setTimeout may be cancelled if the service worker is suspended before it fires.
// The heartbeat alarm (every 30s) acts as a fallback — it calls connect() if port is null,
// bypassing the backoff. This is acceptable: after a long sleep, an immediate reconnect is fine.
function scheduleReconnect() {
  const delay = backoffMs;
  backoffMs   = Math.min(backoffMs * 2, 30000);
  setTimeout(connect, delay);
}

function sendToHost(msg) {
  if (port) try { port.postMessage(msg); } catch (_) {}
}

// ── Handle messages from host ─────────────────────────────────────────────────

async function onHostMessage(msg) {
  if      (msg.type === 'command')   await handleCommand(msg);
  else if (msg.type === 'subscribe')       handleSubscribe(msg);
  else if (msg.type === 'tabs')      await handleTabs(msg);
}

async function handleCommand({ id, tabId, method, params }) {
  if (!attached.has(tabId)) {
    return sendToHost({ id, type: 'error', error: 'Tab not attached' });
  }
  try {
    const result = await chrome.debugger.sendCommand({ tabId }, method, params || {});
    sendToHost({ id, type: 'result', result: result || {} });
  } catch (err) {
    sendToHost({ id, type: 'error', error: err.message });
  }
}

function handleSubscribe({ id, tabId }) {
  // Subscription tracking is done in the host. Extension just confirms the tab exists.
  if (!attached.has(tabId)) {
    return sendToHost({ id, type: 'error', error: 'Tab not attached' });
  }
  sendToHost({ id, type: 'result', result: {} });
}

async function handleTabs({ id }) {
  const tabs = await chrome.tabs.query({});
  sendToHost({
    id,
    type: 'result',
    result: tabs.map(t => ({
      tabId:    t.id,
      url:      t.url,
      title:    t.title,
      attached: attached.has(t.id)
    }))
  });
}

// ── Debugger management ───────────────────────────────────────────────────────

async function attachTab(tabId) {
  if (attached.has(tabId)) return;
  try {
    await chrome.debugger.attach({ tabId }, DEBUGGER_VERSION);
    attached.add(tabId);
  } catch (err) {
    if (err.message && err.message.includes('already attached')) {
      // Debugger survived a service worker restart — reclaim the session
      attached.add(tabId);
    }
    // Otherwise: chrome://, extension pages, PDFs — silently skip
  }
}

async function attachAllTabs() {
  const tabs = await chrome.tabs.query({});
  await Promise.all(tabs.filter(t => t.id).map(t => attachTab(t.id)));
}

// New tab: wait 500 ms for it to initialize before attaching
chrome.tabs.onCreated.addListener((tab) => {
  if (tab.id) setTimeout(() => attachTab(tab.id), 500);
});

chrome.tabs.onRemoved.addListener((tabId) => {
  attached.delete(tabId);
  sendToHost({ type: 'tabRemoved', tabId });
});

chrome.debugger.onDetach.addListener((source) => {
  if (source.tabId) attached.delete(source.tabId);
});

// Forward ALL CDP events to host; host filters by client subscriptions
chrome.debugger.onEvent.addListener((source, method, params) => {
  if (source.tabId) {
    sendToHost({ type: 'event', tabId: source.tabId, event: method, params });
  }
});

// ── Heartbeat: keep service worker alive and reconnect if needed ──────────────

chrome.alarms.create('heartbeat', { periodInMinutes: 0.5 });
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === 'heartbeat' && !port) connect();
});

// ── Popup status query ────────────────────────────────────────────────────────

chrome.runtime.onMessage.addListener((msg, _sender, reply) => {
  if (msg.type === 'status') {
    reply({ connected: !!port, attachedCount: attached.size });
    return true; // keep channel open for async reply
  }
});

connect();
