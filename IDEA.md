# Semantic Navigator - Design Spec

## Overview

A navigable semantic database where relationships are primarily derived from embedding proximity rather than labeled edges. Designed to be queried through natural language via an LLM interface layer, usable by both humans and AI agents.

## Core Principles

1. **Derived relationships**: Semantic connections emerge from embedding vector differences, not manual labeling
2. **Hierarchical atomization**: Content is chunked into nested levels (article → section → paragraph) enabling zoom operations
3. **Lazy caching**: Summaries and aggregations computed on demand and cached for reuse
4. **LLM as interface**: Natural language in, structured queries executed internally, synthesized results out

## Data Model

### Nodes

Every node has:
- `id` (uuid)
- `content` (text)
- `content_hash` (for cache invalidation)
- `embedding` (vector, 1536 dimensions for OpenAI ada-002 or 3072 for text-embedding-3-large)
- `node_type` (article | section | paragraph)
- `source_path` (original file path)
- `created_at`, `updated_at`

### Stored Edges

**Containment (hierarchical)**
- `parent_id` → `child_id`
- Represents part-whole relationships
- Enables zoom in/out navigation

**Backlinks (structural)**
- `source_id` → `target_id`
- Preserved from Obsidian `[[wiki-links]]`
- Optional: store link context (surrounding text)

### Computed (not stored)

**Semantic proximity**
- Nearest neighbor queries via pgvector
- Filtered by dimensional weights / semantic lens
- Cross-level possible (paragraph in article A near paragraph in article B)

## Operations

### Navigation

| Operation    | Description                                          | Implementation                                               |
| ------------ | ---------------------------------------------------- | ------------------------------------------------------------ |
| **Zoom in**  | Drill into children of current node                  | Follow containment edges downward                            |
| **Zoom out** | Rise to parent / broader context                     | Follow containment edges upward, retrieve cached summary     |
| **Move**     | Shift focus to semantically related nodes            | Vector similarity query from current center                  |
| **Filter**   | Apply semantic lens (e.g., "technical content only") | TBD - start without lenses, develop when we have concrete test cases |

### Queries (via LLM interface)

The LLM translates natural language into combinations of:
- SQL (for structural edges, metadata)
- pgvector similarity search (for semantic proximity)
- Aggregation / summarization (for zoom-out views)

Example queries:
- "What do I have about agency and free will?" → similarity search across all nodes
- "Show me the main themes in my archive" → cluster at high zoom level, return cached or generated summaries
- "Go deeper into this one" → fetch children via containment edges
- "What else connects to this idea?" → similarity search at current granularity level
- "Notes related to this that I wrote last year" → similarity + metadata filter

## Ingestion Strategy

Ingestion is **eager, not lazy**. When importing an article:

1. Strip YAML frontmatter (tags, aliases, etc. - may be added later)
2. LLM reads the entire article for context
3. Parse header hierarchy into nested sections (h1 → h2 → h3, etc.)
4. Split leaf sections into paragraphs by `\n\n`
5. For each node, LLM generates a contextual summary
6. Embeddings computed:
   - Paragraphs <1000 tokens: embed raw content directly
   - Paragraphs >=1000 tokens: embed summary
   - Sections and articles: always embed summary
7. All nodes and edges stored immediately

The only "lazy" decision is **which articles to import** - users selectively import sections of their vault.

## Cache Invalidation

When source content changes:
- Affected nodes marked with a `dirty` flag
- Updates are **manual**, not automatic (to control costs)
- UI shows token budget/cost estimates before regenerating
- Embeddings are cheap; LLM summarization is the expensive part

## Summaries & Caching

**Summary cache table:**
- `node_id`
- `zoom_level` (or abstraction level)
- `lens` (perspective/filter applied, nullable)
- `summary` (text)
- `content_hash` (of underlying content at generation time)
- `created_at`

## Tech Stack

| Component           | Choice                                    | Rationale                                            |
| ------------------- | ----------------------------------------- | ---------------------------------------------------- |
| Framework           | Next.js                                   | Handles web UI + API routes in one package           |
| Database            | Supabase (PostgreSQL + pgvector)          | Managed Postgres with pgvector built-in, zero setup  |
| Embeddings          | OpenAI text-embedding-3-small             | Good quality, cost-effective to start                |
| LLM                 | Claude API                                | Natural language query translation + summarization   |
| Agent interface     | MCP SDK                                   | Standard protocol for AI agent access                |
| Initial data source | Obsidian vault (filesystem)               | Direct access, simple parsing                        |

## Obsidian Ingestion

### Import interface

Both humans and AI agents can import content:
- Browse vault directory structure
- View estimated token counts (based on file sizes)
- Select individual files or folders to import
- See cost estimate before confirming

AI agents can request imports based on superficial inspection (file names, folder structure, metadata) when they identify potentially relevant content that isn't yet indexed.

### Parsing strategy

For each imported file:
1. Strip YAML frontmatter
2. Parse header hierarchy - headers create nested sections:
   - `#` (h1) sections are children of the article
   - `##` (h2) sections are children of the preceding h1
   - `###` (h3) sections are children of the preceding h2, etc.
3. Split leaf sections into paragraph nodes by `\n\n`
4. LLM reads full content, generates contextual summaries at each level
5. Generate embeddings (raw content for small paragraphs, summaries otherwise)
6. Extract `[[wiki-links]]` and create backlink edges
7. Store nodes and edges in Supabase

### Handling updates

- Track `content_hash` per node
- Mark nodes `dirty` when source file changes
- User manually triggers re-ingestion with cost estimate shown

## Interface Design

Two interfaces serve different users:

1. **Web UI** (Next.js) - for humans to browse, search, and import content
2. **MCP Server** - for AI agents to programmatically access the knowledge base

Both interfaces share the same underlying operations:

```
explore(query: string, center_node_id?: uuid, radius?: float)
zoom_in(node_id: uuid)
zoom_out(node_id: uuid)
filter(lens: string)  // e.g., "technical", "personal", "recent"
follow_link(node_id: uuid, link_type: "backlink" | "containment")
summarize(node_ids: uuid[], perspective?: string)

// Import operations
browse_vault(path?: string)  // list folders/files with token estimates
import(paths: string[])      // import selected files/folders
```

The LLM implementation:
1. Receives natural language (or structured call from another agent)
2. Translates to SQL + vector queries
3. Executes against Postgres
4. Optionally synthesizes/summarizes results
5. Returns to caller

## Open Questions

- **Embedding model choice**: Start with OpenAI, could swap for local model later
- **Cross-level search**: Start by searching across all levels; constrain if results get noisy
- **Semantic lenses**: Need concrete test cases where single-perspective search is insufficient
- **Cross-vault linking**: Out of scope for now, architecture supports multiple sources
- **Versioning**: Not addressed - could track node history if needed

## Next Steps

1. Set up Supabase project with pgvector extension
2. Create schema (nodes, edges, dirty flags, cache tables)
3. Initialize Next.js project
4. Build import interface with folder tree navigation and cost estimates
5. Write ingestion pipeline (LLM summarization + embedding generation)
6. Build web UI for browsing and querying
7. Expose as MCP server
8. Test navigation operations