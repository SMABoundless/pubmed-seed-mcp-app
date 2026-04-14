// PubMed Seed — MCP App UI
// Adapted from pubmed-seed-v2.jsx for the MCP App framework.
// API calls route through the MCP server via app.callServerTool() instead of
// direct browser fetch() to NCBI E-utilities.

import { App } from "@modelcontextprotocol/ext-apps";
import { useState, useEffect, useRef } from "react";
import { createRoot } from "react-dom/client";

// ── MCP App instance (module-level, shared across renders) ─────────────────────
const mcpApp = new App({ name: "PubMed Seed", version: "1.0.0" });

// ── Constants ──────────────────────────────────────────────────────────────────
const NU_PURPLE  = "#4E2A84";
const NU_DARK    = "#3b1f63";
const NU_LIGHT   = "#E8E3F0";
const NU_MID     = "#B6A6D0";
const GREEN_DARK = "#1a6b3a";
const GREEN_BG   = "#e3f2ec";
const GREEN_MID  = "#7dba9a";
const PAGE_SIZE  = 10;
const MAX_PAGES  = 5;
const PICO_CATS  = ["Population", "Intervention", "Comparison", "Outcome"] as const;
const KW_FIELDS  = [
  { label: "Title/Abstract", tag: "tiab" },
  { label: "Title",          tag: "ti"   },
  { label: "Abstract",       tag: "ab"   },
  { label: "All Fields",     tag: "all"  },
];

const ABOUT_TEXT = `PubMed Seed grew out of a frustration familiar to anyone who has tried to build a systematic literature search from scratch. The standard advice — define your PICO, identify MeSH terms, expand with keywords — is sound in theory, but in practice researchers often already have a handful of articles they know are relevant. The question is how to work backwards from those articles to a search string rigorous enough to find everything like them. PubMed Seed automates that pipeline. You bring your seed articles — whether found through a quick search or pasted from a reference list — and the tool harvests their real, NLM-indexed MeSH headings and author keywords directly from PubMed. From there, an interactive term pool lets you curate exactly what you want, and either a Boolean Builder or a PICO-structured builder assembles a search string ready to run.`;

const GUIDE = [
  {
    heading: "Step 1 — Find Articles",
    body: `Search PubMed: Type any search terms and press Enter or click Search. Results appear 10 at a time; use Prev / Next to browse up to 50 results.

Paste Citations: Paste a reference list and click Look Up Citations. The tool identifies articles by:
• PMIDs — most reliable. Format as PMID: 12345678
• DOIs — reliable. Paste the DOI directly, e.g. 10.1001/jama.2020.1234
• Titles — best-effort fallback

You can mix all three formats in the same paste.`,
  },
  {
    heading: "Step 2 — Select Articles and Harvest",
    body: `Each result card shows the title, authors, journal, year, PMID, MeSH headings, and keywords.

Select articles by clicking anywhere on a card. Use Select All or Clear to manage the full page.

Harvest terms two ways:
• Individually — click any green keyword chip or purple MeSH chip on a card.
• In bulk — click 🌱 Harvest from X selected to add all terms at once.

Terms accumulate in the pool across multiple searches.`,
  },
  {
    heading: "Step 3 — Review and Manage Your Term Pool",
    body: `Click 🌱 Harvested Terms to see everything collected:
• Keywords — author-supplied terms (green chips)
• MeSH Headings — controlled vocabulary indexed by NLM (purple chips)

Remove any term by clicking × on its chip. Set the search field for any keyword using the dropdown — options are Title/Abstract (default), Title, Abstract, or All Fields. MeSH headings always use [MeSH Terms].`,
  },
  {
    heading: "Step 4 — Build Your Search String",
    body: `Choose either the Boolean Builder or the PICO Builder.

Boolean Builder: Click terms to include them. Three operator controls shape the logic — Keyword operator (OR/AND), MeSH operator (OR/AND), and how the two blocks join. The string updates live. Click Copy or Run in PubMed.

PICO Builder: Drag terms into four buckets — Population, Intervention, Comparison, Outcome. Terms within a bucket are OR'd; buckets are AND'd. Click Copy PICO String or Run in PubMed when ready.`,
  },
  {
    heading: "Tips",
    body: `• Run several searches and keep harvesting — the pool grows with each session.
• MeSH headings give high precision. Keywords give higher recall.
• A strong systematic search combines both.
• Add filters in PubMed Advanced Search, e.g. AND "Randomized Controlled Trial"[pt] or a date range.`,
  },
];

// ── Types ──────────────────────────────────────────────────────────────────────
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

interface Harvested {
  keywords: string[];
  mesh: string[];
}

// ── MCP server call helper ─────────────────────────────────────────────────────
async function callTool<T>(name: string, args: Record<string, unknown>): Promise<T> {
  const result = await mcpApp.callServerTool({ name, arguments: args });
  const text   = result.content?.find((c: { type: string }) => c.type === "text") as { text: string } | undefined;
  if (!text) throw new Error(`No text content in ${name} response`);
  return JSON.parse(text.text) as T;
}

// ── Utility ────────────────────────────────────────────────────────────────────
const stripHtml = (s: string) => s?.replace(/<[^>]+>/g, "") || "";

// ── Guide Modal ────────────────────────────────────────────────────────────────
function GuideModal({ onClose }: { onClose: () => void }) {
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div role="dialog" aria-modal="true" aria-labelledby="guide-title"
      style={{ position: "fixed", inset: 0, zIndex: 1000,
        display: "flex", alignItems: "flex-start", justifyContent: "center",
        background: "rgba(30,15,50,0.55)", padding: "40px 16px 24px", overflowY: "auto" }}>
      <div style={{ background: "#fff", borderRadius: 12, width: "100%", maxWidth: 680,
        boxShadow: "0 8px 40px rgba(78,42,132,0.25)", position: "relative" }}>
        <div style={{ background: NU_PURPLE, borderRadius: "12px 12px 0 0",
          padding: "18px 24px", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <h2 id="guide-title" style={{ margin: 0, color: "#fff", fontSize: 20, fontWeight: 800 }}>User Guide</h2>
          <button ref={closeRef} onClick={onClose} aria-label="Close user guide"
            style={{ background: "rgba(255,255,255,0.15)", border: "2px solid rgba(255,255,255,0.4)",
              color: "#fff", borderRadius: 6, width: 36, height: 36, fontSize: 20, lineHeight: 1,
              cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}>×</button>
        </div>
        <div style={{ padding: "24px 28px 32px", overflowY: "auto", maxHeight: "75vh" }}>
          {GUIDE.map((section, i) => (
            <section key={i} style={{ marginBottom: 28 }}>
              <h3 style={{ margin: "0 0 10px", color: NU_PURPLE, fontSize: 16, fontWeight: 700,
                borderBottom: `2px solid ${NU_LIGHT}`, paddingBottom: 6 }}>{section.heading}</h3>
              <p style={{ margin: 0, fontSize: 14, color: "#2d2d2d", lineHeight: 1.75, whiteSpace: "pre-line" }}>
                {section.body}
              </p>
            </section>
          ))}
          <div style={{ marginTop: 16, padding: "12px 16px", background: NU_LIGHT,
            borderRadius: 8, fontSize: 13, color: NU_DARK, lineHeight: 1.6 }}>
            <strong>About:</strong> PubMed Seed queries PubMed's public E-utilities API via the MCP server. No data is stored.
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Chip ───────────────────────────────────────────────────────────────────────
interface ChipProps {
  term: string;
  type: "mesh" | "keyword";
  selected?: boolean;
  onClick?: () => void;
  draggable?: boolean;
  onDragStart?: (e: React.DragEvent) => void;
  field?: string;
  onFieldChange?: (term: string, field: string) => void;
  onRemove?: (term: string) => void;
}

function Chip({ term, type, selected, onClick, draggable, onDragStart, field, onFieldChange, onRemove }: ChipProps) {
  const isMesh  = type === "mesh";
  const bg      = selected ? (isMesh ? NU_PURPLE : GREEN_DARK) : (isMesh ? NU_LIGHT : GREEN_BG);
  const color   = selected ? "#fff" : (isMesh ? NU_DARK : GREEN_DARK);
  const border  = isMesh ? `1.5px solid ${NU_MID}` : `1.5px solid ${GREEN_MID}`;
  const typeLabel = isMesh ? "MeSH heading" : "keyword";

  const handleKey = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onClick?.(); }
  };

  return (
    <span draggable={draggable} onDragStart={onDragStart}
      role="checkbox" aria-checked={selected} aria-label={`${term} (${typeLabel})`}
      tabIndex={0} onKeyDown={handleKey}
      style={{ display: "inline-flex", alignItems: "center", margin: "3px", borderRadius: 20,
        fontSize: 13, background: bg, color, border, userSelect: "none", overflow: "hidden", outline: "none" }}
      onFocus={e => (e.currentTarget.style.boxShadow = `0 0 0 3px ${NU_MID}`)}
      onBlur={e =>  (e.currentTarget.style.boxShadow = "none")}>
      <span onClick={onClick} style={{ padding: "4px 8px 4px 10px", cursor: "pointer" }}>
        {isMesh ? "⬡ " : "# "}{term}
      </span>
      {!isMesh && onFieldChange && (
        <select value={field || "tiab"} aria-label={`Search field for ${term}`}
          onChange={e => { e.stopPropagation(); onFieldChange(term, e.target.value); }}
          onClick={e => e.stopPropagation()}
          style={{ fontSize: 11, border: "none",
            borderLeft: `1px solid ${selected ? "rgba(255,255,255,0.4)" : GREEN_MID}`,
            background: selected ? "rgba(0,0,0,0.15)" : "#d4edda",
            color: selected ? "#fff" : GREEN_DARK,
            padding: "0 4px", cursor: "pointer", height: "100%", outline: "none",
            borderRadius: "0 20px 20px 0" }}>
          {KW_FIELDS.map(f => <option key={f.tag} value={f.tag}>{f.label}</option>)}
        </select>
      )}
      {onRemove && (
        <button onClick={e => { e.stopPropagation(); onRemove(term); }}
          aria-label={`Remove ${term}`}
          style={{ padding: "0 8px 0 2px", cursor: "pointer", background: "none", border: "none",
            color: "inherit", fontSize: 15, lineHeight: 1, opacity: 0.7 }}>×</button>
      )}
    </span>
  );
}

// ── Boolean Builder ────────────────────────────────────────────────────────────
interface BooleanBuilderProps {
  keywords: string[];
  meshTerms: string[];
  kwFields: Record<string, string>;
  onFieldChange: (term: string, field: string) => void;
}

function BooleanBuilder({ keywords, meshTerms, kwFields, onFieldChange }: BooleanBuilderProps) {
  const [selKw,   setSelKw]   = useState(new Set<string>());
  const [selMesh, setSelMesh] = useState(new Set<string>());
  const [kwOp,    setKwOp]    = useState("OR");
  const [meshOp,  setMeshOp]  = useState("OR");
  const [joinOp,  setJoinOp]  = useState("AND");
  const [copied,  setCopied]  = useState(false);

  const toggle = (setter: React.Dispatch<React.SetStateAction<Set<string>>>) => (t: string) =>
    setter(p => { const n = new Set(p); n.has(t) ? n.delete(t) : n.add(t); return n; });

  const buildQuery = () => {
    const parts: string[] = [];
    if (selKw.size) {
      const inner = [...selKw].map(t => `"${t}"[${kwFields[t] || "tiab"}]`).join(` ${kwOp} `);
      parts.push(selKw.size > 1 ? `(${inner})` : inner);
    }
    if (selMesh.size) {
      const inner = [...selMesh].map(t => `"${t}"[MeSH Terms]`).join(` ${meshOp} `);
      parts.push(selMesh.size > 1 ? `(${inner})` : inner);
    }
    return parts.join(` ${joinOp} `);
  };

  const query = buildQuery();
  const copy  = async () => {
    try { await navigator.clipboard.writeText(query); setCopied(true); setTimeout(() => setCopied(false), 2000); } catch { /* ignore */ }
  };

  const OpSelect = ({ id, label, value, onChange, opts }: {
    id: string; label: string; value: string; onChange: (v: string) => void; opts: string[];
  }) => (
    <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
      <label htmlFor={id} style={{ fontSize: 12, color: "#444", fontWeight: 600 }}>{label}</label>
      <select id={id} value={value} onChange={e => onChange(e.target.value)}
        style={{ borderRadius: 4, border: `1.5px solid ${NU_MID}`, padding: "4px 8px", fontSize: 13, color: NU_DARK, background: "#fff" }}>
        {opts.map(o => <option key={o}>{o}</option>)}
      </select>
    </div>
  );

  return (
    <div>
      <p style={{ fontSize: 13, color: "#444", marginBottom: 12, marginTop: 0 }}>
        Click terms to include them in the search string.
      </p>
      {keywords.length > 0 && (
        <div style={{ marginBottom: 12 }} role="group" aria-label="Keywords">
          <div style={{ fontSize: 12, fontWeight: 700, color: GREEN_DARK, marginBottom: 4, textTransform: "uppercase", letterSpacing: 0.5 }}>
            Keywords
          </div>
          <div>{keywords.map(t => (
            <Chip key={t} term={t} type="keyword" selected={selKw.has(t)} onClick={() => toggle(setSelKw)(t)}
              field={kwFields[t]} onFieldChange={onFieldChange} />
          ))}</div>
        </div>
      )}
      {meshTerms.length > 0 && (
        <div style={{ marginBottom: 12 }} role="group" aria-label="MeSH headings">
          <div style={{ fontSize: 12, fontWeight: 700, color: NU_PURPLE, marginBottom: 4, textTransform: "uppercase", letterSpacing: 0.5 }}>
            MeSH Headings
          </div>
          <div>{meshTerms.map(t => (
            <Chip key={t} term={t} type="mesh" selected={selMesh.has(t)} onClick={() => toggle(setSelMesh)(t)} />
          ))}</div>
        </div>
      )}
      {(selKw.size > 0 || selMesh.size > 0) && (
        <div style={{ display: "flex", gap: 16, marginBottom: 12, flexWrap: "wrap" }}>
          <OpSelect id="kw-op"   label="Keyword operator"  value={kwOp}   onChange={setKwOp}   opts={["OR","AND"]} />
          <OpSelect id="mesh-op" label="MeSH operator"     value={meshOp} onChange={setMeshOp} opts={["OR","AND"]} />
          <OpSelect id="join-op" label="Keywords ↔ MeSH"  value={joinOp} onChange={setJoinOp} opts={["AND","OR"]} />
        </div>
      )}
      {query && (
        <div style={{ marginTop: 8 }}>
          <div aria-live="polite" aria-label="Generated search string"
            style={{ background: "#f8f6fc", border: `1.5px solid ${NU_MID}`, borderRadius: 8,
              padding: "10px 14px", fontFamily: "monospace", fontSize: 13,
              whiteSpace: "pre-wrap", wordBreak: "break-word", color: "#1a1a2e" }}>
            {query}
          </div>
          <div style={{ marginTop: 10, display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button onClick={copy} aria-label="Copy search string to clipboard"
              style={{ padding: "6px 16px", background: copied ? GREEN_DARK : NU_PURPLE,
                color: "#fff", border: "none", borderRadius: 6, cursor: "pointer", fontSize: 13, fontWeight: 600 }}>
              {copied ? "✓ Copied" : "Copy to Clipboard"}
            </button>
            <button onClick={() => window.open(`https://pubmed.ncbi.nlm.nih.gov/?term=${encodeURIComponent(query)}`, "_blank")}
              aria-label="Run search in PubMed (opens in new tab)"
              style={{ padding: "6px 16px", background: "#fff", color: NU_PURPLE,
                border: `1.5px solid ${NU_PURPLE}`, borderRadius: 6, cursor: "pointer", fontSize: 13, fontWeight: 600 }}>
              🔗 Run in PubMed
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ── PICO Builder ───────────────────────────────────────────────────────────────
interface PICOBuilderProps {
  keywords: string[];
  meshTerms: string[];
  kwFields: Record<string, string>;
}

function PICOBuilder({ keywords, meshTerms, kwFields }: PICOBuilderProps) {
  type BucketKey = "Population" | "Intervention" | "Comparison" | "Outcome";
  type TermEntry = { term: string; type: "keyword" | "mesh" };

  const [buckets, setBuckets] = useState<Record<BucketKey, TermEntry[]>>({
    Population: [], Intervention: [], Comparison: [], Outcome: [],
  });
  const [dragging, setDragging] = useState<TermEntry | null>(null);
  const [copied,   setCopied]   = useState(false);

  const inBucket = (t: TermEntry) =>
    Object.values(buckets).some(b => b.some(x => x.term === t.term && x.type === t.type));

  const addToBucket = (bucket: BucketKey, entry: TermEntry) => {
    if (buckets[bucket].some(x => x.term === entry.term)) return;
    setBuckets(p => ({ ...p, [bucket]: [...p[bucket], entry] }));
  };

  const removeFromBucket = (bucket: BucketKey, term: string) =>
    setBuckets(p => ({ ...p, [bucket]: p[bucket].filter(x => x.term !== term) }));

  const onDrop = (bucket: BucketKey) => (e: React.DragEvent) => {
    e.preventDefault();
    if (dragging) { addToBucket(bucket, dragging); setDragging(null); }
  };

  const bucketToStr = (entries: TermEntry[]) => {
    if (!entries.length) return null;
    const parts = entries.map(e =>
      e.type === "mesh" ? `"${e.term}"[MeSH Terms]` : `"${e.term}"[${kwFields[e.term] || "tiab"}]`
    );
    return parts.length > 1 ? `(${parts.join(" OR ")})` : parts[0];
  };

  const picoQuery = (PICO_CATS as readonly BucketKey[])
    .map(c => bucketToStr(buckets[c]))
    .filter(Boolean)
    .join("\nAND ");

  const copy = async () => {
    try { await navigator.clipboard.writeText(picoQuery.replace(/\n/g, " ")); setCopied(true); setTimeout(() => setCopied(false), 2000); } catch { /* ignore */ }
  };

  const poolKeywords = keywords.filter(t => !inBucket({ term: t, type: "keyword" }));
  const poolMesh     = meshTerms.filter(t => !inBucket({ term: t, type: "mesh" }));

  return (
    <div>
      <p style={{ fontSize: 13, color: "#444", marginBottom: 12, marginTop: 0 }}>
        Drag terms from the pool into PICO buckets. Terms within a bucket are joined with OR; buckets are joined with AND.
      </p>

      {/* Term pool */}
      <div style={{ marginBottom: 16 }}>
        <div style={{ fontSize: 12, fontWeight: 700, color: "#555", marginBottom: 6, textTransform: "uppercase", letterSpacing: 0.5 }}>
          Term Pool — drag to a bucket below
        </div>
        <div style={{ minHeight: 36, padding: 4, background: NU_LIGHT, borderRadius: 8, border: `1px dashed ${NU_MID}` }}>
          {poolKeywords.map(t => (
            <Chip key={t} term={t} type="keyword" draggable
              onDragStart={e => { e.dataTransfer.effectAllowed = "move"; setDragging({ term: t, type: "keyword" }); }} />
          ))}
          {poolMesh.map(t => (
            <Chip key={t} term={t} type="mesh" draggable
              onDragStart={e => { e.dataTransfer.effectAllowed = "move"; setDragging({ term: t, type: "mesh" }); }} />
          ))}
          {!poolKeywords.length && !poolMesh.length && (
            <span style={{ fontSize: 13, color: "#888", padding: "4px 8px" }}>All terms have been placed in buckets.</span>
          )}
        </div>
      </div>

      {/* PICO buckets */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 16 }}>
        {(PICO_CATS as readonly BucketKey[]).map(cat => (
          <div key={cat}
            onDragOver={e => e.preventDefault()}
            onDrop={onDrop(cat)}
            style={{ border: `1.5px dashed ${NU_MID}`, borderRadius: 8,
              padding: 10, minHeight: 70, background: "#faf9fd" }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: NU_PURPLE, marginBottom: 6, textTransform: "uppercase", letterSpacing: 0.5 }}>
              {cat}
            </div>
            <div>
              {buckets[cat].map(e => (
                <Chip key={e.term} term={e.term} type={e.type} selected
                  onRemove={() => removeFromBucket(cat, e.term)} />
              ))}
              {!buckets[cat].length && (
                <span style={{ fontSize: 12, color: "#aaa" }}>Drop terms here</span>
              )}
            </div>
          </div>
        ))}
      </div>

      {picoQuery && (
        <div>
          <div aria-live="polite" aria-label="Generated PICO search string"
            style={{ background: "#f8f6fc", border: `1.5px solid ${NU_MID}`, borderRadius: 8,
              padding: "10px 14px", fontFamily: "monospace", fontSize: 13,
              whiteSpace: "pre-wrap", wordBreak: "break-word", color: "#1a1a2e" }}>
            {picoQuery}
          </div>
          <div style={{ marginTop: 10, display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button onClick={copy} aria-label="Copy PICO search string to clipboard"
              style={{ padding: "6px 16px", background: copied ? GREEN_DARK : NU_PURPLE,
                color: "#fff", border: "none", borderRadius: 6, cursor: "pointer", fontSize: 13, fontWeight: 600 }}>
              {copied ? "✓ Copied" : "Copy PICO String"}
            </button>
            <button onClick={() => window.open(`https://pubmed.ncbi.nlm.nih.gov/?term=${encodeURIComponent(picoQuery.replace(/\n/g, " "))}`, "_blank")}
              aria-label="Run PICO search in PubMed (opens in new tab)"
              style={{ padding: "6px 16px", background: "#fff", color: NU_PURPLE,
                border: `1.5px solid ${NU_PURPLE}`, borderRadius: 6, cursor: "pointer", fontSize: 13, fontWeight: 600 }}>
              🔗 Run in PubMed
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Main App ───────────────────────────────────────────────────────────────────
function PubMedSeed() {
  const [mode,             setMode]             = useState<"search" | "paste">("search");
  const [tab,              setTab]              = useState<"harvest" | "boolean" | "pico">("harvest");
  const [query,            setQuery]            = useState("");
  const [pasteText,        setPasteText]        = useState("");
  const [page,             setPage]             = useState(1);
  const [hasMore,          setHasMore]          = useState(false);
  const [loading,          setLoading]          = useState(false);
  const [loadMsg,          setLoadMsg]          = useState("");
  const [error,            setError]            = useState("");
  const [articles,         setArticles]         = useState<Article[]>([]);
  const [selectedArticles, setSelectedArticles] = useState(new Set<string>());
  const [harvested,        setHarvested]        = useState<Harvested>({ keywords: [], mesh: [] });
  const [kwFields,         setKwFields]         = useState<Record<string, string>>({});
  const [aboutOpen,        setAboutOpen]        = useState(false);
  const [guideOpen,        setGuideOpen]        = useState(false);
  const [idPanel,          setIdPanel]          = useState<"pmid" | "doi" | null>(null);

  const setTermField = (term: string, field: string) => setKwFields(p => ({ ...p, [term]: field }));

  // Connect the MCP app on mount
  useEffect(() => { mcpApp.connect(); }, []);

  // ── Search ─────────────────────────────────────────────────────────────────
  const doSearch = async (targetPage = 1) => {
    if (!query.trim()) return;
    setLoading(true); setError(""); setArticles([]); setSelectedArticles(new Set());
    try {
      setLoadMsg("Searching PubMed…");
      const data = await callTool<{ articles: Article[]; has_more: boolean; error?: string }>(
        "pubmed_seed_search",
        { query, page: targetPage, pageSize: PAGE_SIZE },
      );
      if (data.error || !data.articles?.length) {
        setError(data.error ?? "No results found for that query.");
        setLoading(false); return;
      }
      setArticles(data.articles);
      setHasMore(data.has_more);
      setPage(targetPage);
    } catch {
      setError("Search failed. Check your connection and try again.");
    }
    setLoading(false); setLoadMsg("");
  };

  // ── Paste citations ────────────────────────────────────────────────────────
  const doCitations = async () => {
    if (!pasteText.trim()) return;
    setLoading(true); setError(""); setArticles([]); setSelectedArticles(new Set());
    try {
      setLoadMsg("Resolving citations…");
      const data = await callTool<{ articles: Article[]; error?: string }>(
        "pubmed_seed_lookup",
        { text: pasteText },
      );
      if (data.error || !data.articles?.length) {
        setError(data.error ?? "Couldn't match citations. Include PMIDs (PMID: 12345678) or DOIs for best results.");
        setLoading(false); return;
      }
      setArticles(data.articles);
      setSelectedArticles(new Set(data.articles.map(a => a.pmid)));
    } catch {
      setError("Processing failed. Check your connection and try again.");
    }
    setLoading(false); setLoadMsg("");
  };

  // ── Harvest ────────────────────────────────────────────────────────────────
  const harvestFromSelected = () => {
    const sel = articles.filter(a => selectedArticles.has(a.pmid));
    setHarvested(prev => ({
      keywords: [...new Set([...prev.keywords, ...sel.flatMap(a => a.keywords)])],
      mesh:     [...new Set([...prev.mesh,     ...sel.flatMap(a => a.mesh)])],
    }));
    setTab("harvest");
  };

  const harvestOne = (term: string, type: "keyword" | "mesh") => {
    setHarvested(prev => ({
      keywords: type === "keyword" ? [...new Set([...prev.keywords, term])] : prev.keywords,
      mesh:     type === "mesh"    ? [...new Set([...prev.mesh,     term])] : prev.mesh,
    }));
  };

  const removeTerm = (term: string, type: "keyword" | "mesh") => {
    setHarvested(prev => ({
      keywords: type === "keyword" ? prev.keywords.filter(t => t !== term) : prev.keywords,
      mesh:     type === "mesh"    ? prev.mesh.filter(t => t !== term)     : prev.mesh,
    }));
  };

  // ── ID panel ───────────────────────────────────────────────────────────────
  const openIdPanel = (kind: "pmid" | "doi") =>
    setIdPanel(p => p === kind ? null : kind);

  const selectedArts = articles.filter(a => selectedArticles.has(a.pmid));
  const idList = idPanel === "pmid"
    ? selectedArts.map(a => `PMID: ${a.pmid}`).join("\n")
    : selectedArts.map(a => a.doi || `(no DOI — PMID ${a.pmid})`).join("\n");

  // ── Styles ─────────────────────────────────────────────────────────────────
  const primaryBtn = (disabled: boolean) => ({
    padding: "9px 20px", background: disabled ? "#ccc" : NU_PURPLE,
    color: "#fff", border: "none", borderRadius: 7, cursor: disabled ? "not-allowed" : "pointer",
    fontSize: 14, fontWeight: 700,
  });

  const tabStyle = (active: boolean) => ({
    padding: "8px 18px", border: "none", cursor: "pointer", fontSize: 13,
    fontWeight: 600, background: active ? NU_PURPLE : "#fff", color: active ? "#fff" : NU_PURPLE,
  });

  const pageBtn = (enabled: boolean) => ({
    padding: "4px 10px", border: `1.5px solid ${NU_MID}`, borderRadius: 5,
    background: enabled ? "#fff" : "#f0f0f0",
    color: enabled ? NU_PURPLE : "#767676",
    cursor: enabled ? "pointer" : "default", fontSize: 12, fontWeight: 600,
  });

  const totalHarvested = harvested.keywords.length + harvested.mesh.length;

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div style={{ fontFamily: "'Segoe UI', system-ui, sans-serif", minHeight: "100vh", background: "#f5f4f9" }}>

      {guideOpen && <GuideModal onClose={() => setGuideOpen(false)} />}

      {/* Header */}
      <header role="banner"
        style={{ background: NU_PURPLE, color: "#fff", padding: "16px 28px",
          display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 12 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
          <span aria-hidden="true" style={{ fontSize: 28 }}>🔬</span>
          <div>
            <h1 style={{ margin: 0, fontSize: 22, fontWeight: 800, letterSpacing: 0.5, lineHeight: 1.2 }}>
              PubMed Seed
            </h1>
            <p style={{ margin: 0, fontSize: 13, opacity: 0.85 }}>
              Harvest MeSH headings &amp; keywords · Boolean Builder · PICO framework
            </p>
          </div>
        </div>
        <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
          <button onClick={() => setAboutOpen(o => !o)}
            aria-expanded={aboutOpen}
            style={{ padding: "7px 16px", background: "rgba(255,255,255,0.15)",
              color: "#fff", border: "2px solid rgba(255,255,255,0.5)", borderRadius: 6,
              cursor: "pointer", fontSize: 13, fontWeight: 600 }}>
            {aboutOpen ? "Hide About" : "About"}
          </button>
          <button onClick={() => setGuideOpen(true)}
            aria-haspopup="dialog"
            style={{ padding: "7px 16px", background: "#fff",
              color: NU_PURPLE, border: "2px solid #fff", borderRadius: 6,
              cursor: "pointer", fontSize: 13, fontWeight: 700 }}>
            User Guide
          </button>
        </div>
      </header>

      {/* About panel */}
      {aboutOpen && (
        <div role="region" aria-label="About PubMed Seed"
          style={{ background: NU_DARK, color: "#fff" }}>
          <div style={{ maxWidth: 900, margin: "0 auto", padding: "28px 28px 32px" }}>
            <h2 style={{ margin: "0 0 14px", fontSize: 15, fontWeight: 800,
              letterSpacing: 1, textTransform: "uppercase", opacity: 0.7 }}>About</h2>
            <p style={{ margin: 0, fontSize: 15, lineHeight: 1.85, color: "rgba(255,255,255,0.92)",
              maxWidth: 720, fontStyle: "italic" }}>{ABOUT_TEXT}</p>
          </div>
        </div>
      )}

      <main id="main-content" role="main"
        style={{ maxWidth: 900, margin: "0 auto", padding: "24px 16px" }}>

        {/* Mode toggle */}
        <div role="group" aria-label="Input mode"
          style={{ display: "flex", marginBottom: 20, borderRadius: 8, overflow: "hidden",
            border: `2px solid ${NU_PURPLE}`, width: "fit-content" }}>
          {([ ["search", "🔍 Search PubMed"], ["paste", "📋 Paste Citations"] ] as [string, string][]).map(([m, label]) => (
            <button key={m} onClick={() => { setMode(m as "search" | "paste"); setError(""); }}
              aria-pressed={mode === m}
              style={{ padding: "8px 22px", border: "none", cursor: "pointer", fontSize: 14,
                fontWeight: 600, background: mode === m ? NU_PURPLE : "#fff",
                color: mode === m ? "#fff" : NU_PURPLE }}>
              {label}
            </button>
          ))}
        </div>

        {/* Input panel */}
        <div style={{ background: "#fff", borderRadius: 10, padding: 20, marginBottom: 20,
          boxShadow: "0 2px 8px rgba(78,42,132,0.08)" }}>
          {mode === "search" ? (
            <div style={{ display: "flex", gap: 10 }}>
              <input value={query} onChange={e => setQuery(e.target.value)}
                onKeyDown={e => e.key === "Enter" && doSearch(1)}
                placeholder="Enter search terms (e.g. mindfulness chronic pain)"
                aria-label="PubMed search terms"
                style={{ flex: 1, padding: "9px 14px", borderRadius: 7,
                  border: `1.5px solid ${NU_MID}`, fontSize: 14, outline: "none", color: "#1a1a2e" }} />
              <button onClick={() => doSearch(1)} disabled={loading || !query.trim()}
                style={primaryBtn(loading || !query.trim())}>
                {loading && loadMsg.startsWith("Search") ? "Searching…" : "Search"}
              </button>
            </div>
          ) : (
            <div>
              <label style={{ display: "block", fontSize: 13, fontWeight: 600, color: "#1a1a2e", marginBottom: 6 }}>
                Paste citations — PMIDs, DOIs, or plain text references
              </label>
              <textarea value={pasteText} onChange={e => setPasteText(e.target.value)}
                placeholder={"PMID: 30567716\n10.1007/s10459-018-9865-9\n\nOr paste plain text references — title matching attempted as fallback."}
                rows={6}
                style={{ width: "100%", padding: "9px 14px", borderRadius: 7,
                  border: `1.5px solid ${NU_MID}`, fontSize: 13, resize: "vertical",
                  boxSizing: "border-box", color: "#1a1a2e" }} />
              <div style={{ marginTop: 10 }}>
                <button onClick={doCitations} disabled={loading || !pasteText.trim()}
                  style={primaryBtn(loading || !pasteText.trim())}>
                  {loading ? "Looking up…" : "Look Up Citations"}
                </button>
              </div>
            </div>
          )}

          {loading && loadMsg && (
            <div role="status" aria-live="polite"
              style={{ marginTop: 10, padding: "8px 12px", background: NU_LIGHT,
                borderRadius: 6, color: NU_DARK, fontSize: 13 }}>
              ⏳ {loadMsg}
            </div>
          )}
          {error && (
            <div role="alert"
              style={{ marginTop: 10, padding: "8px 12px", background: "#fef2f2",
                borderRadius: 6, color: "#8b0000", fontSize: 13, fontWeight: 500 }}>
              ⚠️ {error}
            </div>
          )}
        </div>

        {/* Results panel */}
        {articles.length > 0 && (
          <section aria-label="Search results"
            style={{ background: "#fff", borderRadius: 10, padding: 20, marginBottom: 20,
              boxShadow: "0 2px 8px rgba(78,42,132,0.08)" }}>

            {/* Toolbar */}
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center",
              marginBottom: 12, flexWrap: "wrap", gap: 8 }}>
              <h2 style={{ margin: 0, fontWeight: 700, color: NU_PURPLE, fontSize: 17 }}>
                Results{" "}
                <span style={{ fontWeight: 400, fontSize: 13, color: "#444" }}>
                  (p.{page} · {articles.length} shown · {selectedArticles.size} selected)
                </span>
              </h2>
              <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                <button onClick={() => setSelectedArticles(new Set(articles.map(a => a.pmid)))}
                  style={{ fontSize: 12, padding: "4px 12px", border: `1.5px solid ${NU_PURPLE}`,
                    borderRadius: 5, background: "#fff", color: NU_PURPLE, cursor: "pointer", fontWeight: 600 }}>
                  Select All
                </button>
                <button onClick={() => setSelectedArticles(new Set())}
                  style={{ fontSize: 12, padding: "4px 12px", border: "1.5px solid #767676",
                    borderRadius: 5, background: "#fff", color: "#444", cursor: "pointer", fontWeight: 600 }}>
                  Clear
                </button>
                <button onClick={() => openIdPanel("pmid")} disabled={selectedArticles.size === 0}
                  style={{ fontSize: 12, padding: "4px 12px",
                    border: `1.5px solid ${idPanel === "pmid" ? NU_PURPLE : "#767676"}`,
                    borderRadius: 5, background: idPanel === "pmid" ? NU_LIGHT : "#fff",
                    color: idPanel === "pmid" ? NU_PURPLE : "#444",
                    cursor: selectedArticles.size > 0 ? "pointer" : "not-allowed",
                    opacity: selectedArticles.size === 0 ? 0.5 : 1, fontWeight: 600 }}>
                  🔢 PMIDs
                </button>
                <button onClick={() => openIdPanel("doi")} disabled={selectedArticles.size === 0}
                  style={{ fontSize: 12, padding: "4px 12px",
                    border: `1.5px solid ${idPanel === "doi" ? NU_PURPLE : "#767676"}`,
                    borderRadius: 5, background: idPanel === "doi" ? NU_LIGHT : "#fff",
                    color: idPanel === "doi" ? NU_PURPLE : "#444",
                    cursor: selectedArticles.size > 0 ? "pointer" : "not-allowed",
                    opacity: selectedArticles.size === 0 ? 0.5 : 1, fontWeight: 600 }}>
                  🔗 DOIs
                </button>
                <button onClick={harvestFromSelected} disabled={selectedArticles.size === 0}
                  style={{ fontSize: 12, padding: "4px 14px",
                    background: selectedArticles.size > 0 ? NU_PURPLE : "#ccc",
                    color: "#fff", border: "none", borderRadius: 5,
                    cursor: selectedArticles.size > 0 ? "pointer" : "not-allowed", fontWeight: 700 }}>
                  🌱 Harvest from {selectedArticles.size} selected
                </button>
              </div>
            </div>

            {/* ID panel */}
            {idPanel && selectedArticles.size > 0 && (
              <div id="id-panel" style={{ marginBottom: 12, padding: 12, background: NU_LIGHT,
                borderRadius: 8, border: `1px solid ${NU_MID}` }}>
                <pre style={{ margin: "0 0 8px", fontSize: 12, fontFamily: "monospace",
                  whiteSpace: "pre-wrap", color: NU_DARK }}>{idList}</pre>
                <button onClick={() => navigator.clipboard.writeText(idList)}
                  style={{ fontSize: 12, padding: "3px 10px", background: NU_PURPLE,
                    color: "#fff", border: "none", borderRadius: 4, cursor: "pointer" }}>
                  Copy all
                </button>
              </div>
            )}

            {/* Article cards */}
            {articles.map(art => {
              const sel = selectedArticles.has(art.pmid);
              return (
                <div key={art.pmid}
                  onClick={() => setSelectedArticles(p => {
                    const n = new Set(p); n.has(art.pmid) ? n.delete(art.pmid) : n.add(art.pmid); return n;
                  })}
                  role="checkbox" aria-checked={sel} tabIndex={0}
                  onKeyDown={e => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      setSelectedArticles(p => {
                        const n = new Set(p); n.has(art.pmid) ? n.delete(art.pmid) : n.add(art.pmid); return n;
                      });
                    }
                  }}
                  style={{ border: `2px solid ${sel ? NU_PURPLE : NU_LIGHT}`, borderRadius: 8,
                    padding: "12px 14px", marginBottom: 10, cursor: "pointer",
                    background: sel ? "#faf8ff" : "#fff", outline: "none" }}>
                  <div style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
                    <input type="checkbox" checked={sel} readOnly aria-hidden="true"
                      style={{ marginTop: 3, accentColor: NU_PURPLE, flexShrink: 0 }} />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontWeight: 700, fontSize: 14, color: "#1a1a2e", marginBottom: 2, lineHeight: 1.4 }}>
                        {art.title}
                      </div>
                      <div style={{ fontSize: 12, color: "#555", marginBottom: 6 }}>
                        {art.authors.join(", ")}{art.moreAuth ? " et al." : ""}{" "}
                        · {art.journal}{art.year ? ` (${art.year})` : ""}{" "}
                        · PMID: {art.pmid}{art.doi ? ` · ${art.doi}` : ""}
                      </div>
                      {(art.keywords.length > 0 || art.mesh.length > 0) && (
                        <div onClick={e => e.stopPropagation()} style={{ marginTop: 4 }}>
                          {art.keywords.map(t => (
                            <Chip key={t} term={t} type="keyword"
                              selected={harvested.keywords.includes(t)}
                              onClick={() => harvestOne(t, "keyword")} />
                          ))}
                          {art.mesh.map(t => (
                            <Chip key={t} term={t} type="mesh"
                              selected={harvested.mesh.includes(t)}
                              onClick={() => harvestOne(t, "mesh")} />
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}

            {/* Pagination */}
            <div role="navigation" aria-label="Results pagination"
              style={{ display: "flex", gap: 4, alignItems: "center", marginTop: 8 }}>
              <button onClick={() => doSearch(page - 1)} disabled={page <= 1 || loading}
                aria-label="Previous page" style={pageBtn(page > 1 && !loading)}>← Prev</button>
              <span aria-live="polite" style={{ fontSize: 12, color: "#444", padding: "0 4px", minWidth: 50, textAlign: "center" }}>
                p.{page}{page >= MAX_PAGES ? " (max)" : ""}
              </span>
              <button onClick={() => doSearch(page + 1)} disabled={!hasMore || page >= MAX_PAGES || loading}
                aria-label="Next page" style={pageBtn(hasMore && page < MAX_PAGES && !loading)}>Next →</button>
            </div>
          </section>
        )}

        {/* Harvested terms + builders panel */}
        <section aria-label="Harvested terms and builders"
          style={{ background: "#fff", borderRadius: 10, boxShadow: "0 2px 8px rgba(78,42,132,0.08)" }}>

          {/* Tab bar */}
          <div role="tablist" style={{ display: "flex", borderBottom: `2px solid ${NU_LIGHT}`, overflow: "hidden", borderRadius: "10px 10px 0 0" }}>
            {([
              ["harvest", `🌱 Harvested Terms ${totalHarvested > 0 ? `(${totalHarvested})` : ""}`],
              ["boolean", "Boolean Builder"],
              ["pico",    "PICO Builder"],
            ] as [string, string][]).map(([t, label]) => (
              <button key={t} role="tab" aria-selected={tab === t}
                onClick={() => setTab(t as typeof tab)}
                style={tabStyle(tab === t)}>
                {label}
              </button>
            ))}
          </div>

          <div role="tabpanel" style={{ padding: 20 }}>
            {tab === "harvest" && (
              <div>
                {totalHarvested === 0 ? (
                  <p style={{ fontSize: 14, color: "#666", margin: 0 }}>
                    No terms harvested yet. Search for articles, select them, and click{" "}
                    <strong>🌱 Harvest from X selected</strong> — or click individual keyword and MeSH chips on article cards.
                  </p>
                ) : (
                  <>
                    {harvested.keywords.length > 0 && (
                      <div style={{ marginBottom: 16 }} role="group" aria-label="Harvested keywords">
                        <div style={{ fontSize: 12, fontWeight: 700, color: GREEN_DARK, marginBottom: 6, textTransform: "uppercase", letterSpacing: 0.5 }}>
                          Keywords ({harvested.keywords.length})
                        </div>
                        <div>{harvested.keywords.map(t => (
                          <Chip key={t} term={t} type="keyword"
                            field={kwFields[t]}
                            onFieldChange={setTermField}
                            onRemove={t => removeTerm(t, "keyword")} />
                        ))}</div>
                      </div>
                    )}
                    {harvested.mesh.length > 0 && (
                      <div role="group" aria-label="Harvested MeSH headings">
                        <div style={{ fontSize: 12, fontWeight: 700, color: NU_PURPLE, marginBottom: 6, textTransform: "uppercase", letterSpacing: 0.5 }}>
                          MeSH Headings ({harvested.mesh.length})
                        </div>
                        <div>{harvested.mesh.map(t => (
                          <Chip key={t} term={t} type="mesh"
                            onRemove={t => removeTerm(t, "mesh")} />
                        ))}</div>
                      </div>
                    )}
                  </>
                )}
              </div>
            )}

            {tab === "boolean" && (
              totalHarvested === 0
                ? <p style={{ fontSize: 14, color: "#666", margin: 0 }}>Harvest some terms first, then come back to build your Boolean string.</p>
                : <BooleanBuilder keywords={harvested.keywords} meshTerms={harvested.mesh}
                    kwFields={kwFields} onFieldChange={setTermField} />
            )}

            {tab === "pico" && (
              totalHarvested === 0
                ? <p style={{ fontSize: 14, color: "#666", margin: 0 }}>Harvest some terms first, then drag them into PICO buckets here.</p>
                : <PICOBuilder keywords={harvested.keywords} meshTerms={harvested.mesh} kwFields={kwFields} />
            )}
          </div>
        </section>
      </main>
    </div>
  );
}

// ── Mount ──────────────────────────────────────────────────────────────────────
const root = document.getElementById("root");
if (root) createRoot(root).render(<PubMedSeed />);
