// host/subscriptions.js
'use strict';

class SubscriptionManager {
  constructor() {
    this._map = new Map(); // `${tabId}:${event}` -> Set<client>
  }

  add(tabId, event, client) {
    const key = `${tabId}:${event}`;
    if (!this._map.has(key)) this._map.set(key, new Set());
    this._map.get(key).add(client);
  }

  remove(client) {
    for (const [key, clients] of this._map) {
      clients.delete(client);
      if (clients.size === 0) this._map.delete(key);
    }
  }

  getClients(tabId, event) {
    return this._map.get(`${tabId}:${event}`) || new Set();
  }
}

module.exports = SubscriptionManager;
