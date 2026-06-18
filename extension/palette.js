// extension/palette.js
// High-level "command palette" for the CDP Bridge.
//
// Loaded into the MV3 service worker via importScripts('palette.js') from
// background.js. Exposes self.Palette with:
//   - execute(tabId, action, args) -> result | throws
//   - catalog()                    -> [{ name, summary, args, returns, example }]
//
// Each action's behavior (run) and its catalog metadata live together in the
// ACTIONS registry below, so GET /palette can never drift from what runs.
'use strict';

/* global chrome */

// ── Module state ──────────────────────────────────────────────────────────────

let cursorEnabled = false;
chrome.storage.local.get('cursorEnabled', ({ cursorEnabled: saved }) => {
  cursorEnabled = !!saved;
});

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ── CDP primitives ────────────────────────────────────────────────────────────

function cmd(tabId, method, params) {
  return chrome.debugger.sendCommand({ tabId }, method, params || {});
}

// Run JS in the page; return its value. Throws on a thrown exception.
async function evalJS(tabId, expression, { awaitPromise = false } = {}) {
  const res = await cmd(tabId, 'Runtime.evaluate', {
    expression,
    returnByValue: true,
    awaitPromise,
  });
  if (res && res.exceptionDetails) {
    const ex = res.exceptionDetails;
    const msg =
      (ex.exception && (ex.exception.description || ex.exception.value)) ||
      ex.text ||
      'evaluation error';
    throw new Error(String(msg).split('\n')[0]);
  }
  return res && res.result ? res.result.value : undefined;
}

const BTN_MASK = { none: 0, left: 1, right: 2, middle: 4 };

function mouse(tabId, type, x, y, button = 'none', clickCount = 0, buttons) {
  return cmd(tabId, 'Input.dispatchMouseEvent', {
    type,
    x: Math.round(x),
    y: Math.round(y),
    button,
    clickCount,
    buttons: buttons != null ? buttons : type === 'mousePressed' ? BTN_MASK[button] : 0,
  });
}

async function clickAt(tabId, x, y, button = 'left', clickCount = 1) {
  await mouse(tabId, 'mouseMoved', x, y, 'none', 0);
  for (let c = 1; c <= clickCount; c++) {
    await mouse(tabId, 'mousePressed', x, y, button, c);
    await mouse(tabId, 'mouseReleased', x, y, button, c);
  }
}

const KEY_MAP = {
  Enter: { key: 'Enter', code: 'Enter', keyCode: 13, text: '\r' },
  Tab: { key: 'Tab', code: 'Tab', keyCode: 9 },
  Escape: { key: 'Escape', code: 'Escape', keyCode: 27 },
  Esc: { key: 'Escape', code: 'Escape', keyCode: 27 },
  Backspace: { key: 'Backspace', code: 'Backspace', keyCode: 8 },
  Delete: { key: 'Delete', code: 'Delete', keyCode: 46 },
  ArrowUp: { key: 'ArrowUp', code: 'ArrowUp', keyCode: 38 },
  ArrowDown: { key: 'ArrowDown', code: 'ArrowDown', keyCode: 40 },
  ArrowLeft: { key: 'ArrowLeft', code: 'ArrowLeft', keyCode: 37 },
  ArrowRight: { key: 'ArrowRight', code: 'ArrowRight', keyCode: 39 },
  Home: { key: 'Home', code: 'Home', keyCode: 36 },
  End: { key: 'End', code: 'End', keyCode: 35 },
  PageUp: { key: 'PageUp', code: 'PageUp', keyCode: 33 },
  PageDown: { key: 'PageDown', code: 'PageDown', keyCode: 34 },
  Space: { key: ' ', code: 'Space', keyCode: 32, text: ' ' },
};

const MOD_MASK = { alt: 1, ctrl: 2, control: 2, meta: 4, cmd: 4, command: 4, shift: 8 };
const modMask = (mods) =>
  (mods || []).reduce((m, x) => m | (MOD_MASK[String(x).toLowerCase()] || 0), 0);

function charKey(ch) {
  const upper = ch.toUpperCase();
  let code = '';
  if (/[a-z]/i.test(ch)) code = 'Key' + upper;
  else if (/[0-9]/.test(ch)) code = 'Digit' + ch;
  return { key: ch, code, keyCode: upper.charCodeAt(0), text: ch };
}

async function press(tabId, key, modifiers) {
  const mods = modMask(modifiers);
  const def = KEY_MAP[key] || charKey(String(key));
  const hasCmdMod = (mods & (1 | 2 | 4)) !== 0; // alt/ctrl/meta suppress text
  const common = {
    modifiers: mods,
    key: def.key,
    code: def.code,
    windowsVirtualKeyCode: def.keyCode || 0,
    nativeVirtualKeyCode: def.keyCode || 0,
  };
  const down = { ...common, type: 'keyDown' };
  if (def.text && !hasCmdMod) down.text = def.text;
  await cmd(tabId, 'Input.dispatchKeyEvent', down);
  await cmd(tabId, 'Input.dispatchKeyEvent', { ...common, type: 'keyUp' });
}

// ── Injected-JS helpers ───────────────────────────────────────────────────────

// Defined once, embedded into element-discovery expressions.
const PATH_HELPERS = `
function cssPath(el){ if(!el||el.nodeType!==1) return ''; if(el.id) return '#'+CSS.escape(el.id);
  const parts=[]; while(el && el.nodeType===1 && el.nodeName!=='HTML'){ if(el.id){ parts.unshift('#'+CSS.escape(el.id)); break; }
    let n=1,s=el; while(s=s.previousElementSibling){ if(s.nodeName===el.nodeName) n++; }
    parts.unshift(el.nodeName.toLowerCase()+':nth-of-type('+n+')'); el=el.parentElement; } return parts.join(' > '); }
function xPath(el){ if(!el||el.nodeType!==1) return ''; if(el.id) return "//*[@id="+JSON.stringify(el.id)+"]";
  const parts=[]; while(el && el.nodeType===1){ let i=1,s=el; while(s=s.previousElementSibling){ if(s.nodeName===el.nodeName) i++; }
    parts.unshift(el.nodeName.toLowerCase()+'['+i+']'); el=el.parentElement; } return '/'+parts.join('/'); }
function vis(el){ const r=el.getBoundingClientRect(); const s=getComputedStyle(el);
  return r.width>0 && r.height>0 && s.visibility!=='hidden' && s.display!=='none' && s.opacity!=='0'; }
function boxOf(el){ const r=el.getBoundingClientRect(); return {x:Math.round(r.left),y:Math.round(r.top),w:Math.round(r.width),h:Math.round(r.height)}; }
`;

// Resolve a CSS/XPath target to viewport-centre coords (for Input events).
function resolverExpr(args) {
  const sel = args.selector != null ? JSON.stringify(String(args.selector)) : null;
  const xp = args.xpath != null ? JSON.stringify(String(args.xpath)) : null;
  return `(() => {
    let el = null;
    ${sel ? `el = document.querySelector(${sel});` : ''}
    ${xp ? `el = document.evaluate(${xp}, document, null, 9, null).singleNodeValue;` : ''}
    if (!el) return { found: false };
    if (el.scrollIntoView) el.scrollIntoView({ block: 'center', inline: 'center' });
    const r = el.getBoundingClientRect();
    return { found: true, x: r.left + r.width / 2, y: r.top + r.height / 2,
             box: { x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) } };
  })()`;
}

// Resolve a target to absolute page coords (for screenshot clip).
function pageBoxExpr(args) {
  const sel = args.selector != null ? JSON.stringify(String(args.selector)) : null;
  const xp = args.xpath != null ? JSON.stringify(String(args.xpath)) : null;
  return `(() => {
    let el = null;
    ${sel ? `el = document.querySelector(${sel});` : ''}
    ${xp ? `el = document.evaluate(${xp}, document, null, 9, null).singleNodeValue;` : ''}
    if (!el) return { found: false };
    if (el.scrollIntoView) el.scrollIntoView({ block: 'center', inline: 'center' });
    const r = el.getBoundingClientRect();
    return { found: true, x: r.left + window.scrollX, y: r.top + window.scrollY,
             w: r.width, h: r.height };
  })()`;
}

async function resolveTarget(tabId, args) {
  if (typeof args.x === 'number' && typeof args.y === 'number') {
    return { found: true, x: args.x, y: args.y, box: null };
  }
  if (args.selector == null && args.xpath == null) {
    throw new Error('Target required: provide selector, xpath, or x/y');
  }
  const t = await evalJS(tabId, resolverExpr(args));
  if (!t || !t.found) throw new Error(`Element not found: ${args.selector || args.xpath}`);
  return t;
}

function findExpr(args) {
  const text = args.text != null ? JSON.stringify(String(args.text)) : 'null';
  const role = args.role != null ? JSON.stringify(String(args.role)) : 'null';
  const sel = args.selector != null ? JSON.stringify(String(args.selector)) : 'null';
  const limit = Number(args.limit) > 0 ? Number(args.limit) : 20;
  return `(() => {
    ${PATH_HELPERS}
    const TEXT=${text}, ROLE=${role}, SEL=${sel}, LIMIT=${limit};
    const ROLE_SEL={
      button:'button,[role=button],input[type=submit],input[type=button],input[type=reset]',
      link:'a[href],[role=link]',
      textbox:'input:not([type=hidden]),textarea,[contenteditable=""],[contenteditable=true],[role=textbox]',
      checkbox:'input[type=checkbox],[role=checkbox]', radio:'input[type=radio],[role=radio]',
      heading:'h1,h2,h3,h4,h5,h6,[role=heading]', image:'img,[role=img]'
    };
    let c=[];
    if(SEL){ c=[...document.querySelectorAll(SEL)]; }
    else if(ROLE){ c=[...document.querySelectorAll(ROLE_SEL[ROLE]||ROLE)]; }
    else { c=[...document.querySelectorAll('body *')]; }
    if(TEXT){
      const t=TEXT.toLowerCase();
      c=c.filter(el=>{ const s=(el.innerText||el.value||el.getAttribute('aria-label')||''); return s && s.toLowerCase().includes(t); });
      c=c.filter(el=>!c.some(o=>o!==el && el.contains(o)));
    }
    const out=[];
    for(const el of c){ if(out.length>=LIMIT) break;
      out.push({ selector:cssPath(el), xpath:xPath(el), tag:el.nodeName.toLowerCase(),
        text:((el.innerText||el.value||'').trim().slice(0,80)), box:boxOf(el), visible:vis(el) });
    }
    return out;
  })()`;
}

function listInteractiveExpr(limit) {
  return `(() => {
    ${PATH_HELPERS}
    const LIMIT=${limit};
    const sel='a[href],button,input:not([type=hidden]),select,textarea,[role=button],[role=link],[role=textbox],[role=checkbox],[role=tab],[onclick],[contenteditable=""],[contenteditable=true],[tabindex]:not([tabindex="-1"])';
    const els=[...document.querySelectorAll(sel)].filter(vis);
    const out=[];
    for(const el of els){ if(out.length>=LIMIT) break;
      out.push({ selector:cssPath(el), xpath:xPath(el), tag:el.nodeName.toLowerCase(),
        type:el.getAttribute('type')||el.getAttribute('role')||null,
        text:((el.innerText||el.value||el.placeholder||el.getAttribute('aria-label')||'').trim().slice(0,80)),
        box:boxOf(el) });
    }
    return out;
  })()`;
}

function selectorAtExpr(x, y) {
  return `(() => {
    ${PATH_HELPERS}
    const el=document.elementFromPoint(${x},${y});
    if(!el) return null;
    return { selector:cssPath(el), xpath:xPath(el), tag:el.nodeName.toLowerCase(),
      text:(el.innerText||'').trim().slice(0,80), box:boxOf(el) };
  })()`;
}

// ── Visual cursor ─────────────────────────────────────────────────────────────

function cursorExpr(x, y, click) {
  const cx = Math.round(x);
  const cy = Math.round(y);
  return `(() => {
    const ID='__cdp_cursor__';
    let c=document.getElementById(ID);
    if(!c){
      c=document.createElement('div');
      c.id=ID;
      c.style.cssText='position:fixed;left:0;top:0;width:22px;height:22px;z-index:2147483647;pointer-events:none;margin:0;transition:transform .35s cubic-bezier(.22,1,.36,1);will-change:transform';
      c.innerHTML='<svg width="22" height="22" viewBox="0 0 22 22" style="filter:drop-shadow(0 1px 2px rgba(0,0,0,.5))"><path d="M2 2 L2 17 L6 13 L9 20 L12 19 L9 12 L15 12 Z" fill="#ffffff" stroke="#000000" stroke-width="1.2"/></svg>';
      (document.body||document.documentElement).appendChild(c);
    }
    c.style.transform='translate(${cx}px,${cy}px)';
    ${
      click
        ? `(function(){
      const r=document.createElement('div');
      r.style.cssText='position:fixed;left:${cx - 15}px;top:${cy - 15}px;width:30px;height:30px;border-radius:50%;border:2px solid #4f9cff;z-index:2147483646;pointer-events:none;opacity:.9;transform:scale(.3);transition:transform .45s ease-out,opacity .45s ease-out';
      (document.body||document.documentElement).appendChild(r);
      requestAnimationFrame(function(){ r.style.transform='scale(1.5)'; r.style.opacity='0'; });
      setTimeout(function(){ r.remove(); },480);
    })();`
        : ''
    }
    return true;
  })()`;
}

// Cosmetic only — must never fail the underlying action.
async function glide(tabId, x, y) {
  if (!cursorEnabled) return;
  try {
    await evalJS(tabId, cursorExpr(x, y, false));
    await sleep(360); // let the CSS transition play
  } catch (_) {}
}

async function clickFx(tabId, x, y) {
  if (!cursorEnabled) return;
  try {
    await evalJS(tabId, cursorExpr(x, y, true));
  } catch (_) {}
}

async function waitLoad(tabId, timeoutMs = 15000) {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    let rs;
    try {
      rs = await evalJS(tabId, 'document.readyState');
    } catch (_) {
      rs = null; // page may be mid-navigation
    }
    if (rs === 'complete') return true;
    await sleep(250);
  }
  return false;
}

const setChecked = (desired) => async (tabId, a) => {
  if (!a.selector) throw new Error('selector required');
  const s = JSON.stringify(String(a.selector));
  const ok = await evalJS(
    tabId,
    `(()=>{const el=document.querySelector(${s});if(!el)return false;if(el.checked!==${desired})el.click();return true;})()`
  );
  if (!ok) throw new Error(`Element not found: ${a.selector}`);
  return { checked: desired };
};

// ── Action registry (behavior + catalog metadata, co-located) ─────────────────

const ACTIONS = {
  // ---- Navigation ----
  navigate: {
    summary: 'Navigate the tab to a URL and wait for load.',
    args: [
      { name: 'url', type: 'string', required: true, desc: 'Destination URL.' },
      { name: 'wait', type: 'boolean', required: false, desc: 'Wait for load (default true).' },
    ],
    returns: '{ url }',
    example: { action: 'navigate', args: { url: 'https://example.com' } },
    run: async (tabId, a) => {
      if (!a.url) throw new Error('url required');
      await cmd(tabId, 'Page.navigate', { url: String(a.url) });
      if (a.wait !== false) await waitLoad(tabId, a.timeoutMs || 15000);
      return { url: await evalJS(tabId, 'location.href') };
    },
  },
  back: {
    summary: 'Go back one entry in history.',
    args: [],
    returns: '{}',
    example: { action: 'back' },
    run: async (tabId) => {
      await evalJS(tabId, 'history.back()');
      await sleep(300);
      return {};
    },
  },
  forward: {
    summary: 'Go forward one entry in history.',
    args: [],
    returns: '{}',
    example: { action: 'forward' },
    run: async (tabId) => {
      await evalJS(tabId, 'history.forward()');
      await sleep(300);
      return {};
    },
  },
  reload: {
    summary: 'Reload the tab and wait for load.',
    args: [],
    returns: '{}',
    example: { action: 'reload' },
    run: async (tabId) => {
      await cmd(tabId, 'Page.reload', {});
      await waitLoad(tabId);
      return {};
    },
  },
  wait_for_load: {
    summary: 'Wait until document.readyState is "complete".',
    args: [{ name: 'timeoutMs', type: 'number', required: false, desc: 'Default 15000.' }],
    returns: '{ loaded }',
    example: { action: 'wait_for_load' },
    run: async (tabId, a) => ({ loaded: await waitLoad(tabId, a.timeoutMs || 15000) }),
  },
  wait_for: {
    summary: 'Poll until a selector exists (or timeout).',
    args: [
      { name: 'selector', type: 'string', required: true, desc: 'CSS selector to wait for.' },
      { name: 'timeoutMs', type: 'number', required: false, desc: 'Default 10000.' },
    ],
    returns: '{ found }',
    example: { action: 'wait_for', args: { selector: '.results' } },
    run: async (tabId, a) => {
      if (!a.selector) throw new Error('selector required');
      const s = JSON.stringify(String(a.selector));
      const end = Date.now() + (a.timeoutMs || 10000);
      while (Date.now() < end) {
        if (await evalJS(tabId, `!!document.querySelector(${s})`)) return { found: true };
        await sleep(300);
      }
      return { found: false };
    },
  },

  // ---- Reading ----
  read_text: {
    summary: 'Read the visible text (innerText) of the page or any region.',
    args: [
      { name: 'selector', type: 'string', required: false, desc: 'CSS selector; omit for whole page.' },
      { name: 'xpath', type: 'string', required: false, desc: 'XPath alternative to selector.' },
    ],
    returns: '{ text, length }',
    example: { action: 'read_text', args: { selector: 'article' } },
    run: async (tabId, a) => {
      let expr;
      if (a.xpath) {
        const xp = JSON.stringify(String(a.xpath));
        expr = `(()=>{const el=document.evaluate(${xp},document,null,9,null).singleNodeValue;return el?el.innerText:null;})()`;
      } else if (a.selector) {
        const s = JSON.stringify(String(a.selector));
        expr = `(()=>{const el=document.querySelector(${s});return el?el.innerText:null;})()`;
      } else {
        expr = `document.body?document.body.innerText:''`;
      }
      const text = await evalJS(tabId, expr);
      if (text === null) throw new Error(`Element not found: ${a.selector || a.xpath}`);
      return { text, length: text ? text.length : 0 };
    },
  },
  get_html: {
    summary: 'Get outerHTML of the page or an element.',
    args: [{ name: 'selector', type: 'string', required: false, desc: 'CSS selector; omit for whole document.' }],
    returns: '{ html }',
    example: { action: 'get_html', args: { selector: '#main' } },
    run: async (tabId, a) => {
      const expr = a.selector
        ? `(()=>{const el=document.querySelector(${JSON.stringify(String(a.selector))});return el?el.outerHTML:null;})()`
        : `document.documentElement.outerHTML`;
      const html = await evalJS(tabId, expr);
      if (html === null) throw new Error(`Element not found: ${a.selector}`);
      return { html };
    },
  },
  get_attribute: {
    summary: 'Get an attribute (or property) of an element.',
    args: [
      { name: 'selector', type: 'string', required: true, desc: 'CSS selector.' },
      { name: 'name', type: 'string', required: true, desc: 'Attribute/property name, e.g. "href".' },
    ],
    returns: '{ name, value }',
    example: { action: 'get_attribute', args: { selector: 'a.more', name: 'href' } },
    run: async (tabId, a) => {
      if (!a.selector || !a.name) throw new Error('selector and name required');
      const s = JSON.stringify(String(a.selector));
      const n = JSON.stringify(String(a.name));
      const r = await evalJS(
        tabId,
        `(()=>{const el=document.querySelector(${s});if(!el)return {__nf:true};const v=el.getAttribute(${n});return {value:v!==null?v:(el[${n}]!==undefined?el[${n}]:null)};})()`
      );
      if (r && r.__nf) throw new Error(`Element not found: ${a.selector}`);
      return { name: a.name, value: r.value };
    },
  },
  get_value: {
    summary: 'Get the current value of an input/textarea/select.',
    args: [{ name: 'selector', type: 'string', required: true, desc: 'CSS selector.' }],
    returns: '{ value }',
    example: { action: 'get_value', args: { selector: 'input[name=q]' } },
    run: async (tabId, a) => {
      if (!a.selector) throw new Error('selector required');
      const s = JSON.stringify(String(a.selector));
      const r = await evalJS(
        tabId,
        `(()=>{const el=document.querySelector(${s});if(!el)return {__nf:true};return {value:'value' in el?el.value:el.textContent};})()`
      );
      if (r && r.__nf) throw new Error(`Element not found: ${a.selector}`);
      return { value: r.value };
    },
  },
  exists: {
    summary: 'Check whether an element exists.',
    args: [
      { name: 'selector', type: 'string', required: false, desc: 'CSS selector.' },
      { name: 'xpath', type: 'string', required: false, desc: 'XPath alternative.' },
    ],
    returns: '{ exists }',
    example: { action: 'exists', args: { selector: '.error' } },
    run: async (tabId, a) => {
      let expr;
      if (a.xpath) expr = `!!document.evaluate(${JSON.stringify(String(a.xpath))},document,null,9,null).singleNodeValue`;
      else if (a.selector) expr = `!!document.querySelector(${JSON.stringify(String(a.selector))})`;
      else throw new Error('selector or xpath required');
      return { exists: !!(await evalJS(tabId, expr)) };
    },
  },

  // ---- Selector discovery ----
  find: {
    summary: 'Find elements by visible text, ARIA role, or CSS; returns CSS selector AND XPath for each.',
    args: [
      { name: 'text', type: 'string', required: false, desc: 'Visible text to match (case-insensitive substring).' },
      { name: 'role', type: 'string', required: false, desc: 'button | link | textbox | checkbox | radio | heading | image.' },
      { name: 'selector', type: 'string', required: false, desc: 'CSS selector to enumerate.' },
      { name: 'limit', type: 'number', required: false, desc: 'Max matches (default 20).' },
    ],
    returns: '{ matches: [{ selector, xpath, tag, text, box, visible }], count }',
    example: { action: 'find', args: { text: 'Sign in' } },
    run: async (tabId, a) => {
      if (a.text == null && a.role == null && a.selector == null)
        throw new Error('Provide text, role, or selector');
      const matches = (await evalJS(tabId, findExpr(a))) || [];
      return { matches, count: matches.length };
    },
  },
  list_interactive: {
    summary: 'List visible interactive elements (links, buttons, inputs, …) with selectors and boxes.',
    args: [{ name: 'limit', type: 'number', required: false, desc: 'Max elements (default 50).' }],
    returns: '{ elements: [{ selector, xpath, tag, type, text, box }] }',
    example: { action: 'list_interactive' },
    run: async (tabId, a) => ({
      elements: (await evalJS(tabId, listInteractiveExpr(Number(a.limit) > 0 ? Number(a.limit) : 50))) || [],
    }),
  },
  selector_at: {
    summary: 'Reverse lookup: the element at viewport point (x, y) and its selector/XPath.',
    args: [
      { name: 'x', type: 'number', required: true, desc: 'Viewport X (CSS px).' },
      { name: 'y', type: 'number', required: true, desc: 'Viewport Y (CSS px).' },
    ],
    returns: '{ selector, xpath, tag, text, box }',
    example: { action: 'selector_at', args: { x: 640, y: 380 } },
    run: async (tabId, a) => {
      if (typeof a.x !== 'number' || typeof a.y !== 'number') throw new Error('x and y required');
      const el = await evalJS(tabId, selectorAtExpr(Math.round(a.x), Math.round(a.y)));
      if (!el) throw new Error('No element at point');
      return el;
    },
  },

  // ---- Pointer ----
  click: {
    summary: 'Click an element (or x/y). Scrolls into view; glides the cursor when enabled.',
    args: [
      { name: 'selector', type: 'string', required: false, desc: 'CSS selector.' },
      { name: 'xpath', type: 'string', required: false, desc: 'XPath alternative.' },
      { name: 'x', type: 'number', required: false, desc: 'Raw viewport X (with y).' },
      { name: 'y', type: 'number', required: false, desc: 'Raw viewport Y (with x).' },
      { name: 'button', type: 'string', required: false, desc: 'left | right | middle (default left).' },
      { name: 'clickCount', type: 'number', required: false, desc: 'Default 1.' },
    ],
    returns: '{ clicked, x, y }',
    example: { action: 'click', args: { selector: 'button#submit' } },
    run: async (tabId, a) => {
      const t = await resolveTarget(tabId, a);
      await glide(tabId, t.x, t.y);
      await clickFx(tabId, t.x, t.y);
      await clickAt(tabId, t.x, t.y, a.button || 'left', a.clickCount || 1);
      return { clicked: true, x: Math.round(t.x), y: Math.round(t.y) };
    },
  },
  double_click: {
    summary: 'Double-click an element (or x/y).',
    args: [
      { name: 'selector', type: 'string', required: false, desc: 'CSS selector.' },
      { name: 'xpath', type: 'string', required: false, desc: 'XPath alternative.' },
      { name: 'x', type: 'number', required: false, desc: 'Raw viewport X.' },
      { name: 'y', type: 'number', required: false, desc: 'Raw viewport Y.' },
    ],
    returns: '{ doubleClicked, x, y }',
    example: { action: 'double_click', args: { selector: '.cell' } },
    run: async (tabId, a) => {
      const t = await resolveTarget(tabId, a);
      await glide(tabId, t.x, t.y);
      await clickFx(tabId, t.x, t.y);
      await clickAt(tabId, t.x, t.y, 'left', 2);
      return { doubleClicked: true, x: Math.round(t.x), y: Math.round(t.y) };
    },
  },
  right_click: {
    summary: 'Right-click (context menu) an element (or x/y).',
    args: [
      { name: 'selector', type: 'string', required: false, desc: 'CSS selector.' },
      { name: 'xpath', type: 'string', required: false, desc: 'XPath alternative.' },
      { name: 'x', type: 'number', required: false, desc: 'Raw viewport X.' },
      { name: 'y', type: 'number', required: false, desc: 'Raw viewport Y.' },
    ],
    returns: '{ rightClicked, x, y }',
    example: { action: 'right_click', args: { selector: '.row' } },
    run: async (tabId, a) => {
      const t = await resolveTarget(tabId, a);
      await glide(tabId, t.x, t.y);
      await clickFx(tabId, t.x, t.y);
      await clickAt(tabId, t.x, t.y, 'right', 1);
      return { rightClicked: true, x: Math.round(t.x), y: Math.round(t.y) };
    },
  },
  hover: {
    summary: 'Move the mouse over an element (or x/y).',
    args: [
      { name: 'selector', type: 'string', required: false, desc: 'CSS selector.' },
      { name: 'xpath', type: 'string', required: false, desc: 'XPath alternative.' },
      { name: 'x', type: 'number', required: false, desc: 'Raw viewport X.' },
      { name: 'y', type: 'number', required: false, desc: 'Raw viewport Y.' },
    ],
    returns: '{ x, y }',
    example: { action: 'hover', args: { selector: '.menu' } },
    run: async (tabId, a) => {
      const t = await resolveTarget(tabId, a);
      await glide(tabId, t.x, t.y);
      await mouse(tabId, 'mouseMoved', t.x, t.y, 'none', 0);
      return { x: Math.round(t.x), y: Math.round(t.y) };
    },
  },
  drag: {
    summary: 'Press at one target and release at another.',
    args: [
      { name: 'from', type: 'object', required: true, desc: 'Target {selector|xpath|x,y}.' },
      { name: 'to', type: 'object', required: true, desc: 'Target {selector|xpath|x,y}.' },
    ],
    returns: '{ from, to }',
    example: { action: 'drag', args: { from: { selector: '.handle' }, to: { x: 400, y: 200 } } },
    run: async (tabId, a) => {
      if (!a.from || !a.to) throw new Error('from and to required');
      const f = await resolveTarget(tabId, a.from);
      const g = await resolveTarget(tabId, a.to);
      await mouse(tabId, 'mouseMoved', f.x, f.y, 'none', 0);
      await mouse(tabId, 'mousePressed', f.x, f.y, 'left', 1);
      await glide(tabId, g.x, g.y);
      await mouse(tabId, 'mouseMoved', g.x, g.y, 'left', 0, 1);
      await mouse(tabId, 'mouseReleased', g.x, g.y, 'left', 1);
      return {
        from: { x: Math.round(f.x), y: Math.round(f.y) },
        to: { x: Math.round(g.x), y: Math.round(g.y) },
      };
    },
  },

  // ---- Scroll ----
  scroll: {
    summary: "Scroll to 'top'/'bottom', scroll an element into view, or scroll by a delta.",
    args: [
      { name: 'to', type: 'string', required: false, desc: "'top' or 'bottom'." },
      { name: 'selector', type: 'string', required: false, desc: 'Scroll this element into view.' },
      { name: 'by', type: 'object', required: false, desc: 'Delta { x, y } in pixels.' },
    ],
    returns: '{ scrollX, scrollY }',
    example: { action: 'scroll', args: { by: { y: 600 } } },
    run: async (tabId, a) => {
      let expr;
      if (a.to === 'top') expr = 'window.scrollTo(0,0)';
      else if (a.to === 'bottom') expr = 'window.scrollTo(0,document.body.scrollHeight)';
      else if (a.selector)
        expr = `(()=>{const el=document.querySelector(${JSON.stringify(String(a.selector))});if(el)el.scrollIntoView({block:'center'});return !!el;})()`;
      else if (a.by) expr = `window.scrollBy(${Number(a.by.x) || 0},${Number(a.by.y) || 0})`;
      else throw new Error('Provide to, selector, or by');
      await evalJS(tabId, expr);
      const pos = await evalJS(tabId, '({x:window.scrollX,y:window.scrollY})');
      return { scrollX: pos.x, scrollY: pos.y };
    },
  },

  // ---- Keyboard / text ----
  type: {
    summary: 'Type text into the focused element (focuses selector first if given).',
    args: [
      { name: 'text', type: 'string', required: true, desc: 'Text to insert.' },
      { name: 'selector', type: 'string', required: false, desc: 'Focus this element first.' },
      { name: 'clear', type: 'boolean', required: false, desc: 'Clear the field before typing.' },
    ],
    returns: '{ typed }',
    example: { action: 'type', args: { selector: 'input[name=q]', text: 'hello', clear: true } },
    run: async (tabId, a) => {
      if (a.text == null) throw new Error('text required');
      if (a.selector) {
        const s = JSON.stringify(String(a.selector));
        const ok = await evalJS(tabId, `(()=>{const el=document.querySelector(${s});if(!el)return false;el.focus();return true;})()`);
        if (!ok) throw new Error(`Element not found: ${a.selector}`);
        if (a.clear)
          await evalJS(
            tabId,
            `(()=>{const el=document.querySelector(${s});if(el&&'value' in el){el.value='';el.dispatchEvent(new Event('input',{bubbles:true}));}})()`
          );
        if (cursorEnabled) {
          try {
            const t = await resolveTarget(tabId, { selector: a.selector });
            await glide(tabId, t.x, t.y);
          } catch (_) {}
        }
      }
      await cmd(tabId, 'Input.insertText', { text: String(a.text) });
      return { typed: String(a.text).length };
    },
  },
  clear: {
    summary: 'Clear an input/textarea/contenteditable and fire input/change.',
    args: [{ name: 'selector', type: 'string', required: true, desc: 'CSS selector.' }],
    returns: '{ cleared }',
    example: { action: 'clear', args: { selector: 'input[name=q]' } },
    run: async (tabId, a) => {
      if (!a.selector) throw new Error('selector required');
      const s = JSON.stringify(String(a.selector));
      const ok = await evalJS(
        tabId,
        `(()=>{const el=document.querySelector(${s});if(!el)return false;el.focus();if('value' in el){el.value='';}else{el.textContent='';}el.dispatchEvent(new Event('input',{bubbles:true}));el.dispatchEvent(new Event('change',{bubbles:true}));return true;})()`
      );
      if (!ok) throw new Error(`Element not found: ${a.selector}`);
      return { cleared: true };
    },
  },
  set_value: {
    summary: 'Set an input/textarea value directly (React-safe) and fire input/change.',
    args: [
      { name: 'selector', type: 'string', required: true, desc: 'CSS selector.' },
      { name: 'value', type: 'string', required: true, desc: 'New value.' },
    ],
    returns: '{ value }',
    example: { action: 'set_value', args: { selector: 'input[name=email]', value: 'a@b.com' } },
    run: async (tabId, a) => {
      if (!a.selector || a.value == null) throw new Error('selector and value required');
      const s = JSON.stringify(String(a.selector));
      const v = JSON.stringify(String(a.value));
      const ok = await evalJS(
        tabId,
        `(()=>{const el=document.querySelector(${s});if(!el)return false;const proto=el instanceof HTMLTextAreaElement?HTMLTextAreaElement.prototype:HTMLInputElement.prototype;const d=Object.getOwnPropertyDescriptor(proto,'value');if(d&&d.set){d.set.call(el,${v});}else{el.value=${v};}el.dispatchEvent(new Event('input',{bubbles:true}));el.dispatchEvent(new Event('change',{bubbles:true}));return true;})()`
      );
      if (!ok) throw new Error(`Element not found: ${a.selector}`);
      return { value: String(a.value) };
    },
  },
  press_key: {
    summary: 'Press a key (with optional modifiers), e.g. Enter, Tab, or "a" with ["Ctrl"].',
    args: [
      { name: 'key', type: 'string', required: true, desc: 'Enter, Tab, Escape, Arrow*, or a character.' },
      { name: 'modifiers', type: 'array', required: false, desc: 'Any of Ctrl, Shift, Alt, Meta.' },
    ],
    returns: '{ key }',
    example: { action: 'press_key', args: { key: 'Enter' } },
    run: async (tabId, a) => {
      if (!a.key) throw new Error('key required');
      await press(tabId, a.key, a.modifiers);
      return { key: a.key };
    },
  },

  // ---- Form controls ----
  select_option: {
    summary: 'Select an <option> in a <select> by value, label, or index.',
    args: [
      { name: 'selector', type: 'string', required: true, desc: 'CSS selector of the <select>.' },
      { name: 'value', type: 'string', required: false, desc: 'Option value.' },
      { name: 'label', type: 'string', required: false, desc: 'Visible option text.' },
      { name: 'index', type: 'number', required: false, desc: 'Option index.' },
    ],
    returns: '{ value, text }',
    example: { action: 'select_option', args: { selector: 'select#country', label: 'Canada' } },
    run: async (tabId, a) => {
      if (!a.selector) throw new Error('selector required');
      if (a.value == null && a.label == null && a.index == null)
        throw new Error('Provide value, label, or index');
      const s = JSON.stringify(String(a.selector));
      const expr = `(()=>{const el=document.querySelector(${s});if(!el)return {__nf:true};let idx=-1;
        ${a.value != null ? `idx=[...el.options].findIndex(o=>o.value===${JSON.stringify(String(a.value))});` : ''}
        ${a.label != null ? `idx=[...el.options].findIndex(o=>o.text===${JSON.stringify(String(a.label))});` : ''}
        ${a.index != null ? `idx=${Number(a.index)};` : ''}
        if(idx<0||idx>=el.options.length)return {__no:true};
        el.selectedIndex=idx;el.dispatchEvent(new Event('input',{bubbles:true}));el.dispatchEvent(new Event('change',{bubbles:true}));
        return {value:el.value,text:el.options[idx].text};})()`;
      const r = await evalJS(tabId, expr);
      if (r && r.__nf) throw new Error(`Element not found: ${a.selector}`);
      if (r && r.__no) throw new Error('Option not found');
      return r;
    },
  },
  check: {
    summary: 'Ensure a checkbox/radio is checked.',
    args: [{ name: 'selector', type: 'string', required: true, desc: 'CSS selector.' }],
    returns: '{ checked }',
    example: { action: 'check', args: { selector: '#agree' } },
    run: setChecked(true),
  },
  uncheck: {
    summary: 'Ensure a checkbox is unchecked.',
    args: [{ name: 'selector', type: 'string', required: true, desc: 'CSS selector.' }],
    returns: '{ checked }',
    example: { action: 'uncheck', args: { selector: '#subscribe' } },
    run: setChecked(false),
  },
  upload: {
    summary: 'Set files on a file input (paths must exist on the machine running Chrome).',
    args: [
      { name: 'selector', type: 'string', required: true, desc: 'CSS selector of the file input.' },
      { name: 'files', type: 'array', required: true, desc: 'Absolute file paths.' },
    ],
    returns: '{ uploaded }',
    example: { action: 'upload', args: { selector: 'input[type=file]', files: ['C:/tmp/a.png'] } },
    run: async (tabId, a) => {
      if (!a.selector || !Array.isArray(a.files) || !a.files.length)
        throw new Error('selector and non-empty files[] required');
      await cmd(tabId, 'DOM.enable', {});
      const doc = await cmd(tabId, 'DOM.getDocument', { depth: 0 });
      const q = await cmd(tabId, 'DOM.querySelector', { nodeId: doc.root.nodeId, selector: a.selector });
      if (!q || !q.nodeId) throw new Error(`Element not found: ${a.selector}`);
      await cmd(tabId, 'DOM.setFileInputFiles', { files: a.files, nodeId: q.nodeId });
      return { uploaded: a.files.length };
    },
  },

  // ---- Capture ----
  screenshot: {
    summary: 'Capture a screenshot of the viewport, a single element, or the full page (base64).',
    args: [
      { name: 'selector', type: 'string', required: false, desc: 'Clip to this element.' },
      { name: 'xpath', type: 'string', required: false, desc: 'XPath alternative to selector.' },
      { name: 'fullPage', type: 'boolean', required: false, desc: 'Capture beyond the viewport.' },
      { name: 'format', type: 'string', required: false, desc: 'png (default) or jpeg.' },
      { name: 'quality', type: 'number', required: false, desc: 'JPEG quality 0–100.' },
    ],
    returns: '{ data, format }  // data is base64',
    example: { action: 'screenshot', args: { selector: 'header' } },
    run: async (tabId, a) => {
      const params = { format: a.format || 'png' };
      if (params.format === 'jpeg' && a.quality != null) params.quality = a.quality;
      if (a.selector || a.xpath) {
        const t = await evalJS(tabId, pageBoxExpr({ selector: a.selector, xpath: a.xpath }));
        if (!t || !t.found) throw new Error(`Element not found: ${a.selector || a.xpath}`);
        params.clip = { x: t.x, y: t.y, width: t.w, height: t.h, scale: 1 };
        params.captureBeyondViewport = true;
      } else if (a.fullPage) {
        const dim = await evalJS(
          tabId,
          '({w:Math.max(document.documentElement.scrollWidth,document.body?document.body.scrollWidth:0),h:Math.max(document.documentElement.scrollHeight,document.body?document.body.scrollHeight:0)})'
        );
        params.clip = { x: 0, y: 0, width: dim.w, height: dim.h, scale: 1 };
        params.captureBeyondViewport = true;
      }
      const r = await cmd(tabId, 'Page.captureScreenshot', params);
      return { data: r.data, format: params.format };
    },
  },

  // ---- Cursor ----
  set_cursor: {
    summary: 'Enable/disable the visual cursor overlay (persisted). When on, pointer actions glide it.',
    args: [{ name: 'enabled', type: 'boolean', required: true, desc: 'true to show, false to hide.' }],
    returns: '{ cursorEnabled }',
    example: { action: 'set_cursor', args: { enabled: true } },
    run: async (tabId, a) => {
      cursorEnabled = !!a.enabled;
      try {
        await chrome.storage.local.set({ cursorEnabled });
      } catch (_) {}
      try {
        if (cursorEnabled) await evalJS(tabId, cursorExpr(8, 8, false));
        else await evalJS(tabId, `(()=>{const c=document.getElementById('__cdp_cursor__');if(c)c.remove();return true;})()`);
      } catch (_) {}
      return { cursorEnabled };
    },
  },
  move_cursor: {
    summary: 'Glide the visual cursor to a target without clicking (shows it even if disabled).',
    args: [
      { name: 'selector', type: 'string', required: false, desc: 'CSS selector.' },
      { name: 'xpath', type: 'string', required: false, desc: 'XPath alternative.' },
      { name: 'x', type: 'number', required: false, desc: 'Raw viewport X.' },
      { name: 'y', type: 'number', required: false, desc: 'Raw viewport Y.' },
    ],
    returns: '{ x, y }',
    example: { action: 'move_cursor', args: { selector: 'button#go' } },
    run: async (tabId, a) => {
      const t = await resolveTarget(tabId, a);
      await evalJS(tabId, cursorExpr(t.x, t.y, false));
      return { x: Math.round(t.x), y: Math.round(t.y) };
    },
  },
};

// ── Public surface ────────────────────────────────────────────────────────────

self.Palette = {
  async execute(tabId, action, args) {
    const entry = ACTIONS[action];
    if (!entry) throw new Error(`Unknown action: ${action}. GET /palette for the catalog.`);
    return await entry.run(tabId, args || {});
  },
  catalog() {
    return Object.keys(ACTIONS).map((name) => {
      const e = ACTIONS[name];
      return {
        name,
        summary: e.summary,
        args: e.args || [],
        returns: e.returns || '',
        example: e.example || null,
      };
    });
  },
};
