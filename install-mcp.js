#!/usr/bin/env node
'use strict';

const fs   = require('fs');
const path = require('path');
const os   = require('os');

const MCP_SERVER_PATH = path.join(__dirname, 'mcp-server.js');
const SERVER_NAME = 'cdp-bridge';

const isUninstall = process.argv.includes('--uninstall');

const GREEN  = '\x1b[32m';
const YELLOW = '\x1b[33m';
const CYAN   = '\x1b[36m';
const RED    = '\x1b[31m';
const RESET  = '\x1b[0m';

function ok(msg)  { console.log(`  ${GREEN}✓${RESET} ${msg}`); }
function skip(msg){ console.log(`  ${YELLOW}−${RESET} ${msg}`); }
function info(msg){ console.log(`  ${CYAN}i${RESET} ${msg}`); }
function fail(msg){ console.log(`  ${RED}✗${RESET} ${msg}`); }

// ── Helpers ──────────────────────────────────────────────────────────────────

function tomlQuote(val) {
  if (typeof val === 'string') {
    if (val.includes("'")) return JSON.stringify(val);
    return `'${val}'`;
  }
  return String(val);
}

function writeTomlKey(pathParts, value) {
  const parts = pathParts.map((p) =>
    p.includes(' ') || p.includes('.') ? `"${p}"` : p
  );
  return `[${parts.join('.')}]\n${value}`;
}

// ── OpenCode ─────────────────────────────────────────────────────────────────

function opencodeConfigPath() {
  const candidates = [
    path.join(__dirname, 'opencode.json'),
    path.join(os.homedir(), '.config', 'opencode', 'opencode.json'),
  ];
  return candidates.find((p) => fs.existsSync(p));
}

function installOpenCode(filePath) {
  const action = isUninstall ? 'remove' : 'add';
  let cfg = {};

  try {
    cfg = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    cfg = { $schema: 'https://opencode.ai/config.json', mcp: {} };
  }

  if (!cfg.mcp) cfg.mcp = {};

  if (isUninstall) {
    if (!cfg.mcp[SERVER_NAME]) { skip(`OpenCode: ${SERVER_NAME} not configured`); return; }
    delete cfg.mcp[SERVER_NAME];
    if (!Object.keys(cfg.mcp).length) delete cfg.mcp;
  } else {
    if (cfg.mcp[SERVER_NAME]) { skip(`OpenCode: ${SERVER_NAME} already configured`); return; }
    cfg.mcp[SERVER_NAME] = {
      type: 'local',
      command: ['node', MCP_SERVER_PATH],
      enabled: true,
      env: {},
    };
  }

  fs.writeFileSync(filePath, JSON.stringify(cfg, null, 2) + '\n');
  ok(`OpenCode: ${action === 'add' ? 'added' : 'removed'} ${SERVER_NAME} in ${filePath}`);
}

// ── Claude Code ──────────────────────────────────────────────────────────────

function claudeConfigPath() {
  const p = path.join(os.homedir(), '.claude', 'settings.json');
  return fs.existsSync(p) ? p : null;
}

function installClaude(filePath) {
  const action = isUninstall ? 'remove' : 'add';
  let cfg = {};

  try {
    cfg = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    cfg = {};
  }

  if (!cfg.mcpServers) cfg.mcpServers = {};

  if (isUninstall) {
    if (!cfg.mcpServers[SERVER_NAME]) { skip(`Claude Code: ${SERVER_NAME} not configured`); return; }
    delete cfg.mcpServers[SERVER_NAME];
    if (!Object.keys(cfg.mcpServers).length) delete cfg.mcpServers;
  } else {
    if (cfg.mcpServers[SERVER_NAME]) { skip(`Claude Code: ${SERVER_NAME} already configured`); return; }
    cfg.mcpServers[SERVER_NAME] = {
      command: 'node',
      args: [MCP_SERVER_PATH],
    };
  }

  fs.writeFileSync(filePath, JSON.stringify(cfg, null, 2) + '\n');
  ok(`Claude Code: ${action === 'add' ? 'added' : 'removed'} ${SERVER_NAME} in ${filePath}`);
}

// ── Codex / Synara (config.toml) ─────────────────────────────────────────────

function codexConfigPaths() {
  const candidates = [
    path.join(os.homedir(), '.synara', 'codex-home-overlay', 'config.toml'),
    path.join(os.homedir(), '.config', 'codex', 'config.toml'),
  ];
  return candidates.filter((p) => fs.existsSync(p) || p.includes('synara'));
}

function parseToml(text) {
  const result = { root: {}, sections: {} };
  let currentSection = 'root';
  const keyPattern = /^\[(.+)\]$/;

  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    if (trimmed.startsWith('[')) {
      const m = trimmed.match(keyPattern);
      if (m) currentSection = m[1];
      continue;
    }
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx === -1) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    const val = trimmed.slice(eqIdx + 1).trim();

    const obj = currentSection === 'root' ? result.root : (result.sections[currentSection] = result.sections[currentSection] || {});
    obj[key] = val;
  }

  return result;
}

function tomlNeedsArray(args) {
  return args.length > 1 || args.some((a) => a.includes(' '));
}

function installCodex() {
  const targets = codexConfigPaths();
  if (!targets.length) {
    fail('Codex/Synara: no config.toml found');
    return;
  }

  for (const filePath of targets) {
    if (!fs.existsSync(filePath)) {
      skip(`Codex/Synara: ${filePath} does not exist yet — creating`);
    }

    let text = '';
    try {
      text = fs.readFileSync(filePath, 'utf8');
    } catch {
      text = '';
    }

    const config = parseToml(text);
    const sectionKey = `mcp_servers.${SERVER_NAME}`;
    const already = config.sections[sectionKey];

    if (isUninstall) {
      if (!already) { skip(`Codex/Synara: ${SERVER_NAME} not configured in ${filePath}`); continue; }
      const lines = text.split('\n');
      const filtered = [];
      let inSection = false;
      for (const line of lines) {
        if (line.trim() === `[${sectionKey}]` || line.trim().startsWith(`[${sectionKey}.`)) {
          inSection = true;
          continue;
        }
        if (inSection) {
          if (line.trim().startsWith('[')) inSection = false;
          else continue;
        }
        filtered.push(line);
      }
      fs.writeFileSync(filePath, filtered.join('\n').replace(/\n{3,}/g, '\n\n').trim() + '\n');
      ok(`Codex/Synara: removed ${SERVER_NAME} from ${filePath}`);
      continue;
    }

    if (already) {
      const hasCommand = Object.keys(config.sections).some(
        (k) => k === sectionKey && config.sections[k].command
      );
      if (hasCommand) {
        skip(`Codex/Synara: ${SERVER_NAME} already configured in ${filePath}`);
        continue;
      }
    }

    if (text && !text.endsWith('\n')) text += '\n';

    const args = [MCP_SERVER_PATH];
    const argsLine = tomlNeedsArray(args)
      ? `args = [${args.map(tomlQuote).join(', ')}]`
      : `args = ${tomlQuote(args[0])}`;

    text += `\n[mcp_servers.${SERVER_NAME}]\ncommand = "node"\n${argsLine}\n`;

    const tools = [
      'browser_tabs', 'browser_navigate', 'browser_read_text', 'browser_find',
      'browser_click', 'browser_type', 'browser_press_key', 'browser_scroll',
      'browser_screenshot', 'browser_wait_for', 'browser_eval', 'browser_get_html',
      'browser_network', 'browser_network_clear', 'browser_list_interactive',
      'browser_set_value', 'browser_action',
    ];
    for (const tool of tools) {
      text += `[mcp_servers.${SERVER_NAME}.tools.${tool}]\napproval_mode = "approve"\n`;
    }

    fs.writeFileSync(filePath, text);
    ok(`Codex/Synara: added ${SERVER_NAME} to ${filePath}`);
  }
}

// ── Cursor ───────────────────────────────────────────────────────────────────

function cursorConfigPath() {
  const projectMcp = path.join(__dirname, '.cursor', 'mcp.json');
  if (fs.existsSync(projectMcp)) return projectMcp;

  const globalDir = path.join(os.homedir(), '.cursor');
  if (fs.existsSync(globalDir)) return path.join(globalDir, 'mcp.json');

  return null;
}

function installCursor(filePath) {
  const action = isUninstall ? 'remove' : 'add';
  let cfg = {};

  try {
    cfg = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    cfg = { mcpServers: {} };
  }

  if (!cfg.mcpServers) cfg.mcpServers = {};

  if (isUninstall) {
    if (!cfg.mcpServers[SERVER_NAME]) { skip(`Cursor: ${SERVER_NAME} not configured`); return; }
    delete cfg.mcpServers[SERVER_NAME];
  } else {
    if (cfg.mcpServers[SERVER_NAME]) { skip(`Cursor: ${SERVER_NAME} already configured`); return; }
    cfg.mcpServers[SERVER_NAME] = {
      command: 'node',
      args: [MCP_SERVER_PATH],
    };
  }

  fs.writeFileSync(filePath, JSON.stringify(cfg, null, 2) + '\n');
  ok(`Cursor: ${action === 'add' ? 'added' : 'removed'} ${SERVER_NAME} in ${filePath}`);
}

// ── Main ─────────────────────────────────────────────────────────────────────

function main() {
  console.log(`\n  CDP Bridge — MCP Installer\n`);

  let any = false;

  const ocPath = opencodeConfigPath();
  if (ocPath) { installOpenCode(ocPath); any = true; }
  else info('OpenCode: no opencode.json found (skip)');

  const clPath = claudeConfigPath();
  if (clPath) { installClaude(clPath); any = true; }
  else info('Claude Code: no settings.json found (skip)');

  installCodex();
  any = true;

  const cuPath = cursorConfigPath();
  if (cuPath) { installCursor(cuPath); any = true; }
  else info('Cursor: no mcp.json found (skip)');

  if (!any) {
    fail('No supported MCP client found. Try running from within a project directory.');
    process.exit(1);
  }

  if (!isUninstall) {
    console.log(`\n  ${CYAN}To start the CDP bridge host:  node host/host.js${RESET}`);
    console.log(`  ${CYAN}Or run the MCP server directly:  node mcp-server.js${RESET}\n`);
  }
}

main();
