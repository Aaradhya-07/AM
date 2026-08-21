# Anvilmark MCP server

Build the monorepo before launching the server:

```sh
pnpm build
```

## Claude Code

Add the local server from the Anvilmark repository root:

```sh
claude mcp add --transport stdio anvilmark -- pnpm --filter @anvilmark/mcp start
```

Equivalent JSON configuration:

```json
{
  "mcpServers": {
    "anvilmark": {
      "command": "pnpm",
      "args": [
        "--dir",
        "/absolute/path/to/anvilmark",
        "--filter",
        "@anvilmark/mcp",
        "start"
      ]
    }
  }
}
```

## Cursor

Add this to `.cursor/mcp.json`, replacing the repository path:

```json
{
  "mcpServers": {
    "anvilmark": {
      "command": "node",
      "args": ["/absolute/path/to/anvilmark/packages/mcp/dist/index.js"]
    }
  }
}
```

The server uses stdio. Do not write logs to standard output; it is reserved for MCP messages.
