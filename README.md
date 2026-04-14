# PubMed Seed MCP App

An MCP App that renders the full PubMed Seed interface inline inside a compatible host (such as Claude). Helps researchers build systematic review and scoping review search strings by searching PubMed, harvesting MeSH headings and keywords from seed articles, and assembling Boolean or PICO-structured search strings.

Built with the [MCP Apps framework](https://apps.extensions.modelcontextprotocol.io/api/) (`@modelcontextprotocol/ext-apps`).

---

## What it does

When Claude calls the `pubmed_seed_open` tool, the host renders the PubMed Seed UI inline:

1. **Search PubMed** or paste a reference list (PMIDs, DOIs, or titles)
2. **Harvest MeSH headings and author keywords** from selected seed articles
3. **Build a search string** using the Boolean Builder or PICO framework
4. **Copy or run** the finished string directly in PubMed

All NCBI E-utilities API calls go through the MCP server — the UI calls them via the app bridge.

---

## Architecture

```
Claude / Host
    │
    ├─ calls pubmed_seed_open
    │       └─ host fetches ui://pubmed-seed/mcp-app.html
    │               └─ renders PubMed Seed React UI (iframe)
    │
    └─ UI calls (via app bridge):
            ├─ pubmed_seed_search  → server hits NCBI esearch + efetch
            └─ pubmed_seed_lookup  → server resolves PMIDs/DOIs/titles
```

**Tools exposed:**

| Tool | Called by | Description |
|---|---|---|
| `pubmed_seed_open` | Claude | Opens the UI in the host |
| `pubmed_seed_search` | UI | Search PubMed by query string |
| `pubmed_seed_lookup` | UI | Look up articles by PMID, DOI, or title |

---

## Development

### Prerequisites

- Node.js 18+
- npm

### Install

```bash
cd pubmed-seed-mcp-app
npm install
```

### Dev mode (watch + rebuild)

```bash
npm start
```

This runs Vite in watch mode (rebuilds the UI on changes) and starts the MCP server with `tsx watch`.

### Production build

```bash
npm run build
```

Outputs:
- `dist/mcp-app.html` — bundled single-file React UI (served as the `ui://` resource)
- `dist/main.js` — compiled MCP server entry point
- `dist/server.js` — compiled server logic

### Start server (after build)

```bash
# HTTP transport (for remote/hosted use)
node dist/main.js

# stdio transport (for local Claude Desktop use)
node dist/main.js --stdio
```

HTTP server listens on `http://localhost:3001/mcp` by default. Override with the `PORT` environment variable.

---

## Connecting to Claude Desktop

### HTTP transport (local)

Run `node dist/main.js` then add to `~/Library/Application Support/Claude/claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "pubmed-seed": {
      "url": "http://localhost:3001/mcp"
    }
  }
}
```

### stdio transport (local, no server process)

```json
{
  "mcpServers": {
    "pubmed-seed": {
      "command": "node",
      "args": ["/absolute/path/to/pubmed-seed-mcp-app/dist/main.js", "--stdio"]
    }
  }
}
```

### Claude Code CLI

```bash
claude mcp add pubmed-seed --transport http http://localhost:3001/mcp
```

---

## Publishing to the MCP Registry

To list this server in the [MCP Registry](https://registry.modelcontextprotocol.io):

1. Deploy the server to a hosting provider (Railway, Fly.io, Render, etc.)
2. Install the registry publisher CLI: `make publisher` (see [registry repo](https://github.com/modelcontextprotocol/registry))
3. Run `./bin/mcp-publisher` and authenticate via GitHub OAuth or DNS verification
4. Provide your server's public URL (`https://your-app.example.com/mcp`)

---

## API

Uses the [NCBI E-utilities API](https://www.ncbi.nlm.nih.gov/books/NBK25500/) (free, no API key required for standard use). NCBI rate limits: 3 requests/second unauthenticated, 10/second with an API key.

To add an API key, set the `NCBI_API_KEY` environment variable and pass it in requests (update `NCBI_QS` in `server.ts`).

---

## License

MIT
