// extension/background.js
'use strict';

// High-level command palette (defines self.Palette). Loaded synchronously so it
// is ready before any host message arrives.
importScripts('palette.js');

const HOST_NAME        = 'com.cdpbridge.host';
const DEBUGGER_VERSION = '1.3';

let port      = null;
let backoffMs = 1000;
let paused    = false;
const attached = new Set();

const NETWORK_MAX_ENTRIES = 300;
const NETWORK_BODY_LIMIT  = 120000;
const networkLogs = new Map(); // tabId -> [{...request lifecycle summary...}]
const networkByRequest = new Map(); // tabId -> Map(requestId -> entry)

// Load persisted paused state on startup, then connect if not paused
chrome.storage.local.get('paused', ({ paused: saved }) => {
  paused = !!saved;
  if (!paused) connect();
});

// ── Native Messaging connection ───────────────────────────────────────────────

function connect() {
  if (paused || port) return;
  try {
    port = chrome.runtime.connectNative(HOST_NAME);
  } catch (_) {
    scheduleReconnect();
    return;
  }

  port.onMessage.addListener(onHostMessage);

  port.onDisconnect.addListener(() => {
    port = null;
    void chrome.runtime.lastError;
    scheduleReconnect();
  });

  backoffMs = 1000;
  attachAllTabs();
}

function disconnect() {
  if (port) {
    try { port.disconnect(); } catch (_) {}
    port = null;
  }
}

// Note: setTimeout may be cancelled if the service worker is suspended before it fires.
// The heartbeat alarm acts as a fallback — if paused is false and port is null, it reconnects.
function scheduleReconnect() {
  if (paused) return;
  const delay = backoffMs;
  backoffMs   = Math.min(backoffMs * 2, 30000);
  setTimeout(connect, delay);
}

function sendToHost(msg) {
  if (port) try { port.postMessage(msg); } catch (_) {}
}

// ── Handle messages from host ─────────────────────────────────────────────────

async function onHostMessage(msg) {
  if (!msg || !msg.type) return;
  try {
    if      (msg.type === 'command')   await handleCommand(msg);
    else if (msg.type === 'action')    await handleAction(msg);
    else if (msg.type === 'palette')         handlePalette(msg);
    else if (msg.type === 'subscribe')       handleSubscribe(msg);
    else if (msg.type === 'tabs')      await handleTabs(msg);
    else if (msg.type === 'network')   await handleNetwork(msg);
    else if (msg.type === 'getCookies')  await handleGetCookies(msg);
    else if (msg.type === 'networkClear') handleNetworkClear(msg);
  } catch (err) {
    if (msg.id) sendToHost({ id: msg.id, type: 'error', error: err.message });
  }
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

// High-level command palette: one named action = one atomic call.
async function handleAction({ id, tabId, action, args }) {
  if (!attached.has(tabId)) {
    return sendToHost({ id, type: 'error', error: 'Tab not attached' });
  }
  try {
    const result = await self.Palette.execute(tabId, action, args || {});
    sendToHost({ id, type: 'result', result: result || {} });
  } catch (err) {
    sendToHost({ id, type: 'error', error: err.message });
  }
}

// Self-describing command catalog (no tab required).
function handlePalette({ id }) {
  sendToHost({ id, type: 'result', result: { actions: self.Palette.catalog() } });
}

function handleSubscribe({ id, tabId }) {
  if (!attached.has(tabId)) {
    return sendToHost({ id, type: 'error', error: 'Tab not attached' });
  }
  sendToHost({ id, type: 'result', result: {} });
}

function handleNetwork({ id, tabId, filters }) {
  if (!attached.has(tabId)) {
    return sendToHost({ id, type: 'error', error: 'Tab not attached' });
  }
  sendToHost({ id, type: 'result', result: getNetworkSnapshot(tabId, filters || {}) });
}

async function handleGetCookies({ id, urls }) {
  const targets = urls && urls.length ? urls : ['https://x.com'];
  const cookies = [];
  for (const url of targets) {
    const cs = await chrome.cookies.getAll({ url });
    cookies.push(...cs);
  }
  sendToHost({ id, type: 'result', result: { cookies } });
}

function handleNetworkClear({ id, tabId }) {
  if (typeof tabId === 'number') {
    networkLogs.delete(tabId);
    networkByRequest.delete(tabId);
  } else {
    networkLogs.clear();
    networkByRequest.clear();
  }
  sendToHost({ id, type: 'result', result: { cleared: true } });
}

async function handleTabs({ id }) {
  const tabs = await chrome.tabs.query({});
  sendToHost({
    id,
    type: 'result',
    result: tabs.filter(t => t.id && t.url).map(t => ({
      tabId:    t.id,
      url:      t.url,
      title:    t.title,
      attached: attached.has(t.id)
    }))
  });
}

// ── Debugger management ───────────────────────────────────────────────────────

async function attachTab(tabId) {
  if (!tabId || attached.has(tabId)) return;
  try {
    await chrome.debugger.attach({ tabId }, DEBUGGER_VERSION);
    attached.add(tabId);
    await enableNetwork(tabId);
  } catch (err) {
    if (err.message && err.message.includes('already attached')) {
      attached.add(tabId);
      await enableNetwork(tabId);
    }
  }
}

async function enableNetwork(tabId) {
  try {
    await chrome.debugger.sendCommand({ tabId }, 'Network.enable', {
      maxTotalBufferSize: 10000000,
      maxResourceBufferSize: 2000000,
    });
  } catch (_) {}
}

async function attachAllTabs() {
  const tabs = await chrome.tabs.query({});
  await Promise.all(tabs.filter(t => t.id).map(t => attachTab(t.id)));
}

chrome.tabs.onCreated.addListener((tab) => {
  if (tab.id) setTimeout(() => attachTab(tab.id), 500);
});

chrome.tabs.onRemoved.addListener((tabId) => {
  attached.delete(tabId);
  networkLogs.delete(tabId);
  networkByRequest.delete(tabId);
  sendToHost({ type: 'tabRemoved', tabId });
});

chrome.debugger.onDetach.addListener((source) => {
  if (source.tabId) attached.delete(source.tabId);
});

chrome.debugger.onEvent.addListener((source, method, params) => {
  if (source.tabId) {
    recordNetworkEvent(source.tabId, method, params || {});
    if (!method.startsWith('Network.')) {
      sendToHost({ type: 'event', tabId: source.tabId, event: method, params });
    }
  }
});

function tabNetworkState(tabId) {
  let list = networkLogs.get(tabId);
  let byRequest = networkByRequest.get(tabId);
  if (!list) {
    list = [];
    networkLogs.set(tabId, list);
  }
  if (!byRequest) {
    byRequest = new Map();
    networkByRequest.set(tabId, byRequest);
  }
  return { list, byRequest };
}

function ensureNetworkEntry(tabId, requestId) {
  const { list, byRequest } = tabNetworkState(tabId);
  let entry = byRequest.get(requestId);
  if (!entry) {
    entry = { requestId, startedAt: Date.now() };
    byRequest.set(requestId, entry);
    list.push(entry);
    while (list.length > NETWORK_MAX_ENTRIES) {
      const removed = list.shift();
      if (removed && removed.requestId) byRequest.delete(removed.requestId);
    }
  }
  return entry;
}

function recordNetworkEvent(tabId, method, params) {
  if (!method.startsWith('Network.')) return;

  if (method === 'Network.requestWillBeSent') {
    const entry = ensureNetworkEntry(tabId, params.requestId);
    entry.url = params.request && params.request.url;
    entry.method = params.request && params.request.method;
    entry.requestHeaders = params.request && params.request.headers;
    entry.postData = params.request && params.request.postData;
    entry.type = params.type;
    entry.initiator = summarizeInitiator(params.initiator);
    entry.documentURL = params.documentURL;
    entry.wallTime = params.wallTime;
    entry.startedAt = Date.now();
    entry.status = 'pending';
    return;
  }

  if (!params.requestId) return;
  const entry = ensureNetworkEntry(tabId, params.requestId);

  if (method === 'Network.responseReceived') {
    const response = params.response || {};
    entry.status = response.status;
    entry.statusText = response.statusText;
    entry.mimeType = response.mimeType;
    entry.responseHeaders = response.headers;
    entry.fromDiskCache = !!response.fromDiskCache;
    entry.fromServiceWorker = !!response.fromServiceWorker;
    entry.remoteIPAddress = response.remoteIPAddress;
    entry.responseUrl = response.url;
    entry.type = entry.type || params.type;
  } else if (method === 'Network.loadingFinished') {
    entry.finishedAt = Date.now();
    entry.encodedDataLength = params.encodedDataLength;
    entry.durationMs = entry.startedAt ? entry.finishedAt - entry.startedAt : undefined;
    entry.complete = true;
    maybeCaptureResponseBody(tabId, entry);
  } else if (method === 'Network.loadingFailed') {
    entry.finishedAt = Date.now();
    entry.durationMs = entry.startedAt ? entry.finishedAt - entry.startedAt : undefined;
    entry.failed = true;
    entry.errorText = params.errorText;
    entry.canceled = !!params.canceled;
  }
}

function summarizeInitiator(initiator) {
  if (!initiator) return undefined;
  const out = { type: initiator.type };
  if (initiator.url) out.url = initiator.url;
  if (initiator.lineNumber != null) out.lineNumber = initiator.lineNumber;
  if (initiator.columnNumber != null) out.columnNumber = initiator.columnNumber;
  if (initiator.stack && initiator.stack.callFrames && initiator.stack.callFrames.length) {
    out.stack = initiator.stack.callFrames.slice(0, 8).map((f) => ({
      functionName: f.functionName,
      url: f.url,
      lineNumber: f.lineNumber,
      columnNumber: f.columnNumber,
    }));
  }
  return out;
}

async function maybeCaptureResponseBody(tabId, entry) {
  if (!entry || entry.bodyCaptured || entry.bodyError) return;
  if (!['XHR', 'Fetch'].includes(entry.type)) return;
  if (entry.encodedDataLength && entry.encodedDataLength > NETWORK_BODY_LIMIT * 2) {
    entry.bodyError = `response too large (${entry.encodedDataLength} bytes)`;
    return;
  }
  try {
    const body = await chrome.debugger.sendCommand({ tabId }, 'Network.getResponseBody', {
      requestId: entry.requestId,
    });
    entry.bodyBase64Encoded = !!body.base64Encoded;
    entry.body = body.body || '';
    entry.bodyCaptured = true;
    if (!entry.bodyBase64Encoded && entry.body.length > NETWORK_BODY_LIMIT) {
      entry.body = entry.body.slice(0, NETWORK_BODY_LIMIT);
      entry.bodyTruncated = true;
    }
  } catch (err) {
    entry.bodyError = err && err.message ? err.message : 'body unavailable';
  }
}

function getNetworkSnapshot(tabId, filters) {
  const list = networkLogs.get(tabId) || [];
  const limit = Math.max(1, Math.min(Number(filters.limit) || 50, NETWORK_MAX_ENTRIES));
  const includeBodies = filters.includeBodies !== false;
  const urlIncludes = filters.urlIncludes ? String(filters.urlIncludes).toLowerCase() : null;
  const resourceType = filters.type ? String(filters.type).toLowerCase() : null;
  const onlyApi = !!filters.onlyApi;

  let entries = list;
  if (urlIncludes) entries = entries.filter((e) => String(e.url || e.responseUrl || '').toLowerCase().includes(urlIncludes));
  if (resourceType) entries = entries.filter((e) => String(e.type || '').toLowerCase() === resourceType);
  if (onlyApi) entries = entries.filter((e) => ['XHR', 'Fetch'].includes(e.type));
  entries = entries.slice(-limit).map((e) => {
    const out = { ...e };
    if (!includeBodies) {
      delete out.body;
      delete out.bodyBase64Encoded;
      delete out.bodyCaptured;
      delete out.bodyTruncated;
    }
    return out;
  });

  return { entries, count: entries.length, total: list.length };
}

// ── Heartbeat ─────────────────────────────────────────────────────────────────

chrome.alarms.create('heartbeat', { periodInMinutes: 0.5 });
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === 'heartbeat' && !paused && !port) connect();
});

// ── Messages from popup ───────────────────────────────────────────────────────

chrome.runtime.onMessage.addListener((msg, _sender, reply) => {
  if (msg.type === 'status') {
    reply({ connected: !!port, attachedCount: attached.size, paused });
    return true;
  }
  if (msg.type === 'setPaused') {
    paused = msg.value;
    chrome.storage.local.set({ paused });
    if (paused) {
      disconnect();
    } else {
      backoffMs = 1000;
      connect();
    }
    reply({ paused });
    return true;
  }
});
