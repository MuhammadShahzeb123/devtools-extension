# CDP Bridge — Remote MCP Server (Claude.ai → your browser)

Bridges **Claude.ai (free, web UI)** to your local Chrome extension via your VPS.

```
Claude.ai ──HTTPS──▶ mcp.fumblemap.com/mcp/<MCP_SECRET>   (Streamable HTTP MCP)
                            │
                            ▼
              server.js (VPS, port 51882, behind Cloudflare Tunnel)
                            ▲
             WebSocket /ws (laptop dials OUT — no NAT/port-forwarding needed)
                            │
                            ▼
              relay-agent.js (your laptop)
                            │  HTTP 127.0.0.1:1232
                            ▼
              Chrome CDP bridge + extension (this repo)
```

## Two pieces

### 1. `server.js` — runs on the VPS (persistent, behind TLS)
- Serves the MCP endpoint at `/mcp/<MCP_SECRET>` (path secret = your password).
- Accepts the laptop relay over WebSocket at `/ws?token=<RELAY_TOKEN>`.
- Forwards `tools/call` jobs down the socket and returns the laptop's result.

Run it:
```bash
cd mcp-remote && npm install
cp .env.example .env   # fill in PORT, MCP_SECRET, RELAY_TOKEN
pm2 start server.js --name cdp-mcp && pm2 save && pm2 startup
```

### 2. `relay-agent.js` — runs on your laptop (only while you use it)
- Connects out to `wss://mcp.fumblemap.com/ws?token=<RELAY_TOKEN>` (auto-reconnects).
- Executes each job against the local CDP bridge (`http://127.0.0.1:1232`).
- Prereq: the bridge host must be running (open Chrome with the extension loaded).

Run it:
```bash
cd mcp-remote && npm install
# set RELAY_URL + RELAY_TOKEN (and optionally CDP_BRIDGE_BASE)
node relay-agent.js
```

## TLS (Cloudflare Tunnel)
`mcp.fumblemap.com` must be a CNAME to the tunnel. On the VPS:
```
~/.cloudflared/config.yml:
  tunnel: <tunnel-id>
  credentials-file: /home/shah/.cloudflared/<tunnel-id>.json
  ingress:
    - hostname: mcp.fumblemap.com
      service: http://localhost:51882
    - service: http_status:404
cloudflared tunnel run
```
Install as a service with `cloudflared service install` so it survives reboots.

## Claude.ai setup (free plan)
1. claude.ai → Settings → Connectors → **Add custom connector**.
2. Paste `https://mcp.fumblemap.com/mcp/<MCP_SECRET>` (no OAuth — personal connector).
3. The 17 `browser_*` tools appear. Start `relay-agent.js` on the laptop, then ask Claude
   to do things in your browser.

## Testing
- `node test-client.js` — handshake + `tools/list` + `browser_tabs` against
  `MCP_URL` (set it to the local or HTTPS endpoint).
- `node test-e2e.js [toolName] ['{"json":args}']` — spawns server + relay locally,
  then drives a full `browser_*` call through the whole chain. Requires the local
  bridge on 1232. (Pass tool/args via `TOOL_NAME`/`TOOL_ARGS` env vars on Windows.)

## Security
- `MCP_SECRET` and `RELAY_TOKEN` are long random strings (see `.env.example`).
  Keep them private — anyone with the MCP URL can drive your browser.
- Never commit `.env`.
