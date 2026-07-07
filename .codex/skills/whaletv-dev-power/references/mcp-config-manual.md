# MCP Server Configuration Manual

## Background

Codex Desktop reads MCP server configuration from `%USERPROFILE%\.codex\config.toml`,
not from `.mcp.json`. This means installing or updating the whaletv-dev-power skill
requires a one-time manual sync step to register the MCP servers with Codex.

Unlike the skill files (which live under `%USERPROFILE%\.codex\skills\`),
the MCP server entries live in `config.toml` alongside Codex's own built-in
servers (e.g. `node_repl`). This file is NOT overwritten by skill installation,
so the MCP config survives skill updates but must be added explicitly on first
setup or after a Codex environment reset.

## MCP Servers Reference

| Server | Command | Arguments |
|--------|---------|-----------|
| zmind-mcp-server | npx | `-y @kk-irving/zmind-mcp-server@latest` |
| opengrok-mcp-server | npx | `-y @kk-irving/opengrok-mcp-server@latest` |
| gerrit-mcp-server | npx | `-y @kk-irving/gerrit-mcp-server@latest` |
| confluence-mcp-server | npx | `-y @kk-irving/confluence-mcp-server@latest` |
| knowledge-mcp-server | npx | `-y @kk-irving/knowledge-mcp-server@latest` |

All five servers read credentials from the shared YAML config file (whaletv.yaml),
so environment variables can be left empty.

## TOML Config Snippet

Append the following to `%USERPROFILE%\.codex\config.toml`:

```toml
[mcp_servers.zmind-mcp-server]
command = "npx"
args = ["-y", "@kk-irving/zmind-mcp-server@latest"]

[mcp_servers.opengrok-mcp-server]
command = "npx"
args = ["-y", "@kk-irving/opengrok-mcp-server@latest"]

[mcp_servers.gerrit-mcp-server]
command = "npx"
args = ["-y", "@kk-irving/gerrit-mcp-server@latest"]

[mcp_servers.confluence-mcp-server]
command = "npx"
args = ["-y", "@kk-irving/confluence-mcp-server@latest"]

[mcp_servers.knowledge-mcp-server]
command = "npx"
args = ["-y", "@kk-irving/knowledge-mcp-server@latest"]
```

Do NOT use `\"` escaping -- the values must contain literal double-quote characters.
If writing via PowerShell, use a StringBuilder or Python to avoid escape-character corruption.

## Sync on Skill Update / Install

When updating this skill or installing it on a new machine:

1. Copy the skill directory to `%USERPROFILE%\.codex\skills\whaletv-dev-power\`
2. Check `%USERPROFILE%\.codex\config.toml` for existing MCP server entries.
   If they are missing, append the TOML snippet above.
3. Restart Codex Desktop for changes to take effect.

### Automation Script (PowerShell)

Save the following as `sync-mcp-config.ps1` in the skill root. Run it after
updating the skill to ensure MCP servers are always registered:

```powershell
param(
    [string]$ConfigPath = "$env:USERPROFILE\.codex\config.toml"
)

$content = Get-Content $ConfigPath -Raw -ErrorAction SilentlyContinue
if ($content -match "zmind-mcp-server") {
    Write-Host "MCP servers already registered in config.toml"
    exit 0
}

$mcpBlock = @"

[mcp_servers.zmind-mcp-server]
command = "npx"
args = ["-y", "@kk-irving/zmind-mcp-server@latest"]

[mcp_servers.opengrok-mcp-server]
command = "npx"
args = ["-y", "@kk-irving/opengrok-mcp-server@latest"]

[mcp_servers.gerrit-mcp-server]
command = "npx"
args = ["-y", "@kk-irving/gerrit-mcp-server@latest"]

[mcp_servers.confluence-mcp-server]
command = "npx"
args = ["-y", "@kk-irving/confluence-mcp-server@latest"]

[mcp_servers.knowledge-mcp-server]
command = "npx"
args = ["-y", "@kk-irving/knowledge-mcp-server@latest"]
"@

Add-Content -Path $ConfigPath -Value $mcpBlock -Encoding UTF8
Write-Host "MCP servers added to config.toml. Restart Codex to activate."
```

## Verification

After restarting Codex:

1. Open Codex Settings - MCP Servers
2. Verify all 5 servers are listed with correct command and args
3. Optionally test connectivity by asking Codex to list MCP resources

If servers are missing:
- Check `%USERPROFILE%\.codex\config.toml` for syntax errors
- Confirm no duplicate `[mcp_servers.*]` sections
- Verify double-quote characters are literal, not escaped
