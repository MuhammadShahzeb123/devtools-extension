const WebSocket = require('ws');

const ws = new WebSocket('ws://localhost:1232');
let messageId = 0;
let pending = new Map();
let instagramTabId = null;

ws.on('open', () => {
  console.log('[WS] Connected to localhost:1232');
  sendCommand('tabs');
});

ws.on('message', (data) => {
  const msg = JSON.parse(data.toString());
  console.log('[MSG]', JSON.stringify(msg, null, 2));

  if (msg.type === 'result' && Array.isArray(msg.result)) {
    console.log(`[TABS] Found ${msg.result.length} tabs`);
    
    const existingInstagram = msg.result.find(t => t.url && t.url.includes('instagram.com'));
    if (existingInstagram) {
      console.log(`[TABS] Found existing Instagram tab: ${existingInstagram.tabId}`);
      instagramTabId = existingInstagram.tabId;
      checkInstagramMessages(instagramTabId);
    } else {
      console.log('[CMD] No Instagram tab found. Attempting to navigate existing tab...');
      const tab = msg.result[0];
      navigateToInstagram(tab.tabId);
    }
  }

  if (msg.type === 'result' && msg.result && msg.result.targetId) {
    console.log('[CMD] New target created, waiting for extension to attach...');
    setTimeout(() => {
      sendCommand('tabs');
    }, 2000);
  }

  if (msg.type === 'error' && msg.error === 'Tab not attached') {
    console.log('[ERROR] Tab not attached yet. Checking tabs again...');
    setTimeout(() => {
      sendCommand('tabs');
    }, 1000);
  }
});

ws.on('error', (err) => {
  console.error('[ERROR]', err.message);
});

function sendCommand(type, payload = {}) {
  const id = ++messageId;
  const msg = { id, type, ...payload };
  ws.send(JSON.stringify(msg));
  console.log('[SEND]', JSON.stringify(msg));
}

function navigateToInstagram(tabId) {
  console.log(`[CMD] Navigating tab ${tabId} to Instagram...`);
  sendCommand('command', {
    tabId,
    method: 'Page.navigate',
    params: { url: 'https://www.instagram.com/' }
  });
  
  setTimeout(() => {
    sendCommand('tabs');
  }, 3000);
}

function checkInstagramMessages(tabId) {
  console.log(`[CMD] Extracting notifications from Instagram tab ${tabId}...`);
  
  sendCommand('command', {
    tabId,
    method: 'Runtime.evaluate',
    params: {
      expression: `
        (function() {
          const results = { dmCount: 0, notifications: 0, storyCount: 0 };
          
          const dmSelectors = [
            'a[href*="/direct/inbox"]',
            'a[aria-label="Messages"]',
            'svg[aria-label="Messages"]',
            'nav a[href*="direct"]'
          ];
          
          for (const sel of dmSelectors) {
            const el = document.querySelector(sel);
            if (el) {
              const badge = el.querySelector('[class*="12po"], [class*="unread"], [class*="count"]');
              const text = (badge?.textContent || el.textContent || '').trim();
              const match = text.match(/\\d+/);
              if (match) {
                results.dmCount = parseInt(match[0], 10);
                break;
              }
            }
          }
          
          const notifSelectors = [
            'button[aria-label="Notifications"]',
            'svg[aria-label="Activity"]',
            'a[href*="/activity"]'
          ];
          
          for (const sel of notifSelectors) {
            const el = document.querySelector(sel);
            if (el) {
              const badge = el.closest('button, a')?.querySelector('[class*="unread"], [class*="count"]');
              const text = (badge?.textContent || '').trim();
              const match = text.match(/\\d+/);
              if (match) {
                results.notifications = parseInt(match[0], 10);
                break;
              }
            }
          }
          
          const storyEl = document.querySelector('article, div[role="menu"] [class*="story"]');
          if (storyEl) {
            const storyCount = storyEl.querySelectorAll('[class*="seen"], [class*="unseen"]').length;
            if (storyCount > 0) results.storyCount = storyCount;
          }
          
          return results;
        })()
      `,
      returnByValue: true
    }
  });
}