import { createMcpExpressApp } from "@modelcontextprotocol/sdk/server/express.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import cors from "cors";
import type { Request, Response } from "express";
import { buildArticles, buildArticlesFromText, esearch, createServer } from "./server.js";

async function startStreamableHTTPServer(): Promise<void> {
  const port = parseInt(process.env.PORT ?? "3001", 10);
  const app  = createMcpExpressApp({ host: "0.0.0.0" });
  app.use(cors());

  // ── REST proxy — CORS-enabled, callable from Claude artifacts ────────────────
  app.get("/api/search", async (req: Request, res: Response) => {
    const q    = String(req.query.q ?? "").trim();
    const page = Math.max(1, parseInt(String(req.query.page ?? "1"), 10));
    if (!q) { res.status(400).json({ error: "q is required" }); return; }
    try {
      const PAGE_SIZE = 10;
      const allIds  = await esearch(q, PAGE_SIZE + 1, (page - 1) * PAGE_SIZE);
      const hasMore = allIds.length > PAGE_SIZE;
      const ids     = allIds.slice(0, PAGE_SIZE);
      const articles = ids.length ? await buildArticles(ids) : [];
      res.json({ articles, has_more: hasMore });
    } catch (e) {
      res.status(500).json({ error: String(e) });
    }
  });

  app.get("/api/lookup", async (req: Request, res: Response) => {
    const ids  = String(req.query.ids ?? "").trim();
    const text = String(req.query.text ?? "").trim();
    if (!ids && !text) { res.status(400).json({ error: "ids or text is required" }); return; }
    try {
      let articles;
      if (ids) {
        const pmids = ids.split(",").map(s => s.trim()).filter(Boolean);
        articles = await buildArticles(pmids);
      } else {
        articles = await buildArticlesFromText(text);
      }
      res.json({ articles });
    } catch (e) {
      res.status(500).json({ error: String(e) });
    }
  });

  app.all("/mcp", async (req: Request, res: Response) => {
    const server    = createServer();
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    res.on("close", () => {
      transport.close().catch(() => {});
      server.close().catch(() => {});
    });
    try {
      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
    } catch (error) {
      console.error("MCP error:", error);
      if (!res.headersSent) {
        res.status(500).json({
          jsonrpc: "2.0",
          error: { code: -32603, message: "Internal server error" },
          id: null,
        });
      }
    }
  });

  const httpServer = app.listen(port, () => {
    console.log(`PubMed Seed MCP App listening on http://localhost:${port}/mcp`);
  });

  const shutdown = () => {
    console.log("\nShutting down…");
    httpServer.close(() => process.exit(0));
  };
  process.on("SIGINT",  shutdown);
  process.on("SIGTERM", shutdown);
}

async function startStdioServer(): Promise<void> {
  await createServer().connect(new StdioServerTransport());
}

async function main() {
  if (process.argv.includes("--stdio")) {
    await startStdioServer();
  } else {
    await startStreamableHTTPServer();
  }
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
