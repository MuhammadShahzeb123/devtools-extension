'use strict';

// Shared tool catalog for the CDP Bridge. Single source of truth used by:
//   - mcp-server.js          (local stdio MCP server)
//   - mcp-remote/server.js   (remote MCP server on the VPS)
//   - mcp-remote/relay-agent.js (schemas only used server-side; callTool is in call-tool.js)

const TOOLS = [
  {
    name: 'browser_tabs',
    description:
      'List all open Chrome tabs with their IDs, titles, and URLs. ' +
      'Always call this first to get a tabId before using any other browser tool.',
    inputSchema: { type: 'object', properties: {}, required: [] },
  },
  {
    name: 'browser_navigate',
    description: 'Navigate a Chrome tab to a URL and wait for the page to finish loading.',
    inputSchema: {
      type: 'object',
      properties: {
        tabId:  { type: 'number', description: 'Tab ID from browser_tabs.' },
        url:    { type: 'string', description: 'Destination URL (include https://).' },
      },
      required: ['tabId', 'url'],
    },
  },
  {
    name: 'browser_read_text',
    description:
      'Read the visible text content of the whole page or a specific element. ' +
      'Use this to extract information after navigating.',
    inputSchema: {
      type: 'object',
      properties: {
        tabId:    { type: 'number', description: 'Tab ID from browser_tabs.' },
        selector: { type: 'string', description: 'CSS selector; omit for the whole page.' },
        xpath:    { type: 'string', description: 'XPath alternative to selector.' },
      },
      required: ['tabId'],
    },
  },
  {
    name: 'browser_find',
    description:
      'Find elements by visible text, ARIA role, or CSS selector. ' +
      'Returns CSS selectors, XPaths, positions, and visibility — use these for subsequent clicks. ' +
      'Prefer this over guessing selectors.',
    inputSchema: {
      type: 'object',
      properties: {
        tabId:    { type: 'number', description: 'Tab ID from browser_tabs.' },
        text:     { type: 'string', description: 'Visible text to match (case-insensitive substring).' },
        role:     { type: 'string', description: 'ARIA role: button | link | textbox | checkbox | radio | heading | image.' },
        selector: { type: 'string', description: 'CSS selector to enumerate.' },
        limit:    { type: 'number', description: 'Max results (default 20).' },
      },
      required: ['tabId'],
    },
  },
  {
    name: 'browser_click',
    description:
      'Click an element on the page. Provide a CSS selector (from browser_find), ' +
      'XPath, or raw x/y viewport coordinates.',
    inputSchema: {
      type: 'object',
      properties: {
        tabId:      { type: 'number', description: 'Tab ID from browser_tabs.' },
        selector:   { type: 'string', description: 'CSS selector of the element to click.' },
        xpath:      { type: 'string', description: 'XPath alternative to selector.' },
        x:          { type: 'number', description: 'Viewport X coordinate (use with y).' },
        y:          { type: 'number', description: 'Viewport Y coordinate (use with x).' },
        button:     { type: 'string', description: 'left (default) | right | middle.' },
        clickCount: { type: 'number', description: 'Number of clicks (default 1).' },
      },
      required: ['tabId'],
    },
  },
  {
    name: 'browser_type',
    description:
      'Type text into the page. Optionally focus a specific element first. ' +
      'Use clear:true to wipe existing content before typing.',
    inputSchema: {
      type: 'object',
      properties: {
        tabId:    { type: 'number', description: 'Tab ID from browser_tabs.' },
        text:     { type: 'string', description: 'Text to type.' },
        selector: { type: 'string', description: 'Focus this element before typing (optional).' },
        clear:    { type: 'boolean', description: 'Clear the field before typing (default false).' },
      },
      required: ['tabId', 'text'],
    },
  },
  {
    name: 'browser_press_key',
    description:
      'Press a keyboard key with optional modifier keys. ' +
      'Useful for Enter, Tab, Escape, arrow keys, and keyboard shortcuts.',
    inputSchema: {
      type: 'object',
      properties: {
        tabId:     { type: 'number', description: 'Tab ID from browser_tabs.' },
        key:       { type: 'string', description: 'Key name: Enter | Tab | Escape | Backspace | ArrowUp | ArrowDown | ArrowLeft | ArrowRight | Home | End | Delete | Space | or any character.' },
        modifiers: { type: 'array', items: { type: 'string' }, description: 'Modifier keys: Ctrl | Shift | Alt | Meta.' },
      },
      required: ['tabId', 'key'],
    },
  },
  {
    name: 'browser_scroll',
    description: "Scroll the page. Use to='top'/'bottom', by={y:600} for delta, or selector to scroll an element into view.",
    inputSchema: {
      type: 'object',
      properties: {
        tabId:    { type: 'number', description: 'Tab ID from browser_tabs.' },
        to:       { type: 'string', description: "'top' or 'bottom'." },
        by:       { type: 'object', description: 'Pixel delta, e.g. { y: 600 } to scroll down.', properties: { x: { type: 'number' }, y: { type: 'number' } } },
        selector: { type: 'string', description: 'Scroll this element into view.' },
      },
      required: ['tabId'],
    },
  },
  {
    name: 'browser_screenshot',
    description:
      'Take a screenshot of the current page or a specific element. ' +
      'Returns a PNG image you can see. Use this to visually verify page state.',
    inputSchema: {
      type: 'object',
      properties: {
        tabId:    { type: 'number', description: 'Tab ID from browser_tabs.' },
        selector: { type: 'string', description: 'Clip screenshot to this element (optional).' },
        fullPage: { type: 'boolean', description: 'Capture the full scrollable page (default false).' },
        format:   { type: 'string', description: 'png (default) or jpeg.' },
      },
      required: ['tabId'],
    },
  },
  {
    name: 'browser_wait_for',
    description: 'Wait until a CSS selector appears on the page. Polls every 300ms.',
    inputSchema: {
      type: 'object',
      properties: {
        tabId:     { type: 'number', description: 'Tab ID from browser_tabs.' },
        selector:  { type: 'string', description: 'CSS selector to wait for.' },
        timeoutMs: { type: 'number', description: 'Timeout in ms (default 10000).' },
      },
      required: ['tabId', 'selector'],
    },
  },
  {
    name: 'browser_eval',
    description:
      'Run arbitrary JavaScript in the page and return the result. ' +
      'Useful for reading complex data, checking state, or operations not covered by other tools.',
    inputSchema: {
      type: 'object',
      properties: {
        tabId:      { type: 'number', description: 'Tab ID from browser_tabs.' },
        expression: { type: 'string', description: 'JavaScript expression to evaluate. Return value must be JSON-serialisable.' },
      },
      required: ['tabId', 'expression'],
    },
  },
  {
    name: 'browser_get_html',
    description: 'Get the raw HTML of the page or a specific element.',
    inputSchema: {
      type: 'object',
      properties: {
        tabId:    { type: 'number', description: 'Tab ID from browser_tabs.' },
        selector: { type: 'string', description: 'CSS selector; omit for the whole document.' },
      },
      required: ['tabId'],
    },
  },
  {
    name: 'browser_network',
    description:
      'Read the recent network trace for a tab. Use this to discover XHR/fetch APIs, request URLs, ' +
      'status codes, initiator JavaScript stack hints, and captured response bodies that populate the frontend.',
    inputSchema: {
      type: 'object',
      properties: {
        tabId:         { type: 'number', description: 'Tab ID from browser_tabs.' },
        limit:         { type: 'number', description: 'Max recent requests to return (default 50, max 300).' },
        onlyApi:       { type: 'boolean', description: 'Only XHR/fetch requests (default false).' },
        type:          { type: 'string', description: 'CDP resource type filter, e.g. XHR, Fetch, Script, Document.' },
        urlIncludes:   { type: 'string', description: 'Only requests whose URL contains this substring.' },
        includeBodies: { type: 'boolean', description: 'Include captured response body snippets (default true).' },
      },
      required: ['tabId'],
    },
  },
  {
    name: 'browser_network_clear',
    description: 'Clear the recorded network trace for a tab before a fresh navigation or interaction.',
    inputSchema: {
      type: 'object',
      properties: {
        tabId: { type: 'number', description: 'Tab ID from browser_tabs.' },
      },
      required: ['tabId'],
    },
  },
  {
    name: 'browser_list_interactive',
    description:
      'List all visible interactive elements on the page (links, buttons, inputs). ' +
      'Returns selectors and positions. Use when you need to discover what you can interact with.',
    inputSchema: {
      type: 'object',
      properties: {
        tabId:  { type: 'number', description: 'Tab ID from browser_tabs.' },
        limit:  { type: 'number', description: 'Max elements (default 50).' },
      },
      required: ['tabId'],
    },
  },
  {
    name: 'browser_set_value',
    description:
      'Set the value of an input or textarea directly (React-safe). ' +
      'Prefer this over browser_type when the field uses a JS framework.',
    inputSchema: {
      type: 'object',
      properties: {
        tabId:    { type: 'number', description: 'Tab ID from browser_tabs.' },
        selector: { type: 'string', description: 'CSS selector of the input/textarea.' },
        value:    { type: 'string', description: 'Value to set.' },
      },
      required: ['tabId', 'selector', 'value'],
    },
  },
  {
    name: 'browser_action',
    description:
      'Run any palette action by name. Use this for actions not covered by the other tools ' +
      '(e.g. drag, double_click, right_click, select_option, check, upload). ' +
      'Call GET http://127.0.0.1:1232/palette to see the full action catalog.',
    inputSchema: {
      type: 'object',
      properties: {
        tabId:  { type: 'number', description: 'Tab ID from browser_tabs.' },
        action: { type: 'string', description: 'Action name from GET /palette.' },
        args:   { type: 'object', description: 'Action-specific arguments.' },
      },
      required: ['tabId', 'action'],
    },
  },
];

module.exports = { TOOLS };
