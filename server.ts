import {
  registerAppResource,
  registerAppTool,
  RESOURCE_MIME_TYPE,
} from "@modelcontextprotocol/ext-apps/server";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { DOMParser } from "@xmldom/xmldom";
import fs from "node:fs/promises";
import path from "node:path";
import { z } from "zod";

// When compiled, server.js lives inside dist/ alongside mcp-app.html
const DIST_DIR = import.meta.dirname.endsWith("dist")
  ? import.meta.dirname
  : path.join(import.meta.dirname, "dist");
const EUTILS   = "https://eutils.ncbi.nlm.nih.gov/entrez/eutils";
const NCBI_QS  = "tool=pubmed-seed-mcp&email=pubmedseed%40example.com";
const RESOURCE_URI = "ui://pubmed-seed/mcp-app.html";

// ── NCBI helpers ───────────────────────────────────────────────────────────────

async function eutils(endpoint: string, qs: string): Promise<Response> {
  const url = `${EUTILS}/${endpoint}?${NCBI_QS}&${qs}`;
  const res  = await fetch(url);
  if (!res.ok) throw new Error(`NCBI ${endpoint} returned HTTP ${res.status}`);
  return res;
}

interface Article {
  pmid: string;
  doi: string;
  title: string;
  authors: string[];
  moreAuth: boolean;
  year: string;
  journal: string;
  keywords: string[];
  mesh: string[];
}

async function fetchSummaries(ids: string[]): Promise<Article[]> {
  const res  = await eutils("esummary.fcgi", `db=pubmed&id=${ids.join(",")}&retmode=json`);
  const data = await res.json() as Record<string, unknown>;
  const result = data.result as Record<string, Record<string, unknown>> | undefined;

  return ids.map(id => {
    const doc    = result?.[id] ?? {};
    const aids   = (doc.articleids as Array<{ idtype: string; value: string }>) ?? [];
    const doi    = aids.find(x => x.idtype === "doi")?.value ?? "";
    const rawAuthors = (doc.authors as Array<{ name: string }>) ?? [];
    return {
      pmid:     id,
      doi,
      title:    stripHtml((doc.title as string) ?? "") || "Untitled",
      authors:  rawAuthors.slice(0, 3).map(a => a.name),
      moreAuth: rawAuthors.length > 3,
      year:     ((doc.pubdate as string) ?? "").match(/\d{4}/)?.[0] ?? "",
      journal:  (doc.source as string) ?? "",
      keywords: [],
      mesh:     [],
    };
  });
}

async function fetchFullXml(ids: string[]): Promise<Record<string, { mesh: string[]; keywords: string[] }>> {
  const res  = await eutils("efetch.fcgi", `db=pubmed&id=${ids.join(",")}&rettype=xml&retmode=xml`);
  const text = await res.text();
  const doc  = new DOMParser().parseFromString(text, "text/xml");
  const out: Record<string, { mesh: string[]; keywords: string[] }> = {};

  const articles = doc.getElementsByTagName("PubmedArticle");
  for (let i = 0; i < articles.length; i++) {
    const art    = articles[i];
    const pmidEl = art.getElementsByTagName("PMID")[0];
    const pmid   = pmidEl?.textContent?.trim();
    if (!pmid) continue;

    const mesh: string[] = [];
    const descriptors = art.getElementsByTagName("DescriptorName");
    for (let j = 0; j < descriptors.length; j++) {
      const t = descriptors[j].textContent?.trim();
      if (t) mesh.push(t);
    }

    const keywords: string[] = [];
    const kwEls = art.getElementsByTagName("Keyword");
    for (let j = 0; j < kwEls.length; j++) {
      const t = kwEls[j].textContent?.trim();
      if (t && t.length > 1) keywords.push(t);
    }

    out[pmid] = {
      mesh:     [...new Set(mesh)],
      keywords: [...new Set(keywords)],
    };
  }
  return out;
}

export async function buildArticles(ids: string[]): Promise<Article[]> {
  const [summaries, fullData] = await Promise.all([
    fetchSummaries(ids),
    fetchFullXml(ids),
  ]);
  return summaries.map(s => ({
    ...s,
    keywords: fullData[s.pmid]?.keywords ?? [],
    mesh:     fullData[s.pmid]?.mesh     ?? [],
  }));
}

export async function buildArticlesFromText(text: string): Promise<Article[]> {
  const found = new Set<string>();
  for (const m of text.matchAll(/(?:PMID|pmid)[:\s]*(\d{7,8})/g)) found.add(m[1]);
  for (const m of text.matchAll(/^\s*(\d{7,8})\s*$/gm)) found.add(m[1]);
  for (const m of text.matchAll(/10\.\d{4,}\/\S+/g)) {
    const ids = await esearch(`${m[0]}[doi]`, 1);
    if (ids[0]) found.add(ids[0]);
  }
  if (!found.size) {
    const lines = text.split(/\n+/).filter(l => l.trim().length > 40);
    for (const line of lines.slice(0, 10)) {
      const t = line.replace(/^\d+\.\s*/, "").split(/[.;]\s+\d{4}/)[0].trim().slice(0, 120);
      if (t.length < 15) continue;
      const ids = await esearch(`${t}[Title]`, 1);
      if (ids[0]) found.add(ids[0]);
    }
  }
  return found.size ? buildArticles([...found]) : [];
}

export async function esearch(term: string, retmax: number, retstart = 0): Promise<string[]> {
  const qs  = `db=pubmed&term=${encodeURIComponent(term)}&retmax=${retmax}&retstart=${retstart}&retmode=json`;
  const res  = await eutils("esearch.fcgi", qs);
  const data = await res.json() as { esearchresult?: { idlist?: string[] } };
  return data.esearchresult?.idlist ?? [];
}

function stripHtml(s: string): string {
  return s.replace(/<[^>]+>/g, "");
}

// ── Server factory ─────────────────────────────────────────────────────────────

export function createServer(): McpServer {
  const server = new McpServer({
    name: "PubMed Seed",
    version: "1.0.0",
  });

  // ── Trigger tool — Claude calls this to open the UI ──────────────────────────
  registerAppTool(
    server,
    "pubmed_seed_open",
    {
      title: "Open PubMed Seed",
      description:
        "Opens the PubMed Seed interface for building systematic review and scoping review search strings. " +
        "Use when the user wants to search PubMed, harvest MeSH headings and keywords from seed articles, " +
        "or build a Boolean or PICO search string.",
      inputSchema: {},
      _meta: { ui: { resourceUri: RESOURCE_URI } },
    },
    async () => ({
      content: [{ type: "text" as const, text: [
        "PubMed Seed is open.",
        "",
        "If the UI did not render inline, use these CORS-enabled REST endpoints to build an interactive artifact instead:",
        "  GET https://pubmed-seed-mcp-app.onrender.com/api/search?q=QUERY&page=1",
        "  GET https://pubmed-seed-mcp-app.onrender.com/api/lookup?ids=PMID1,PMID2",
        "",
        "Both return JSON: { articles: [{ pmid, doi, title, authors, moreAuth, year, journal, keywords, mesh }], has_more? }",
        "",
        "Build a React artifact with: search input → call /api/search → show article cards with MeSH chips → harvest terms → Boolean/PICO string builder.",
      ].join("\n") }],
    }),
  );

  // ── Search tool — called by the UI via app bridge ─────────────────────────────
  server.tool(
    "pubmed_seed_search",
    "Search PubMed and return article metadata including MeSH headings and author keywords.",
    {
      query:    z.string().describe("PubMed search query"),
      page:     z.number().int().min(1).default(1).describe("Page number (1-indexed)"),
      pageSize: z.number().int().min(1).max(25).default(10).describe("Results per page"),
    },
    async ({ query, page, pageSize }) => {
      try {
        const retstart = (page - 1) * pageSize;
        // Fetch one extra to detect hasMore
        const allIds = await esearch(query, pageSize + 1, retstart);
        const hasMore = allIds.length > pageSize;
        const ids = allIds.slice(0, pageSize);

        if (!ids.length) {
          return { content: [{ type: "text" as const, text: JSON.stringify({ articles: [], has_more: false }) }] };
        }

        const articles = await buildArticles(ids);
        return {
          content: [{
            type: "text" as const,
            text: JSON.stringify({ articles, has_more: hasMore }),
          }],
        };
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        return { content: [{ type: "text" as const, text: JSON.stringify({ error: msg }) }] };
      }
    },
  );

  // ── Lookup tool — called by the UI via app bridge ─────────────────────────────
  server.tool(
    "pubmed_seed_lookup",
    "Look up PubMed articles by pasted text containing PMIDs, DOIs, and/or titles.",
    {
      text: z.string().describe("Pasted reference list — may contain PMIDs (PMID: 12345678), DOIs (10.xxx/yyy), or title text"),
    },
    async ({ text }) => {
      try {
        const found = new Set<string>();

        // Extract PMIDs
        for (const m of text.matchAll(/(?:PMID|pmid)[:\s]*(\d{7,8})/g)) found.add(m[1]);
        // Plain bare PMIDs (8-digit numbers on their own line)
        for (const m of text.matchAll(/^\s*(\d{7,8})\s*$/gm)) found.add(m[1]);

        // Resolve DOIs
        for (const m of text.matchAll(/10\.\d{4,}\/\S+/g)) {
          const ids = await esearch(`${m[0]}[doi]`, 1);
          if (ids[0]) found.add(ids[0]);
        }

        // Title fallback if still empty
        if (!found.size) {
          const lines = text.split(/\n+/).filter(l => l.trim().length > 40);
          for (const line of lines.slice(0, 10)) {
            const t = line.replace(/^\d+\.\s*/, "").split(/[.;]\s+\d{4}/)[0].trim().slice(0, 120);
            if (t.length < 15) continue;
            const ids = await esearch(`${t}[Title]`, 1);
            if (ids[0]) found.add(ids[0]);
          }
        }

        if (!found.size) {
          return { content: [{ type: "text" as const, text: JSON.stringify({ articles: [], error: "No articles found" }) }] };
        }

        const articles = await buildArticles([...found]);
        return { content: [{ type: "text" as const, text: JSON.stringify({ articles }) }] };
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        return { content: [{ type: "text" as const, text: JSON.stringify({ error: msg }) }] };
      }
    },
  );

  // ── UI resource — serves the bundled HTML to the host ─────────────────────────
  registerAppResource(
    server,
    RESOURCE_URI,
    RESOURCE_URI,
    { mimeType: RESOURCE_MIME_TYPE },
    async () => {
      const html = await fs.readFile(path.join(DIST_DIR, "mcp-app.html"), "utf-8");
      return {
        contents: [{ uri: RESOURCE_URI, mimeType: RESOURCE_MIME_TYPE, text: html }],
      };
    },
  );

  return server;
}
