# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run dev          # Start Next.js dev server at localhost:3000
npm run build        # Build for production
npm run lint         # Run ESLint
npm test             # Run vitest tests
npm test -- --run    # Run tests once (no watch mode)
npm test -- src/lib/__tests__/parser.test.ts --run  # Run specific test file
npx tsc --noEmit     # Type check without emitting
npx supabase db push # Apply database migrations
```

Run scripts with: `npm run script scripts/<script>.ts` (auto-loads .env.local)

**Note**: Let the user run `npm run dev` in their own terminal rather than running it from Claude. This keeps the dev server visible and controllable by the user.

## Testing

**Run tests regularly** to verify changes don't break existing functionality:

```bash
npm test -- --run    # Run all tests once
npx tsc --noEmit     # Type check
```

**When to run tests:**
- After modifying `src/lib/parser.ts` - parser tests verify frontmatter stripping and hierarchy generation
- After modifying `src/lib/ingestion.ts` - verify node creation logic
- Before committing significant changes
- After fixing bugs (add a regression test first, verify it fails, then fix)

**Scripts**: When writing scripts, reuse existing lib functions (e.g., `createServerClient` from `src/lib/supabase`, `generateEmbedding` from `src/lib/embeddings`) rather than reimplementing them. Check existing scripts in `scripts/` for patterns.

## Architecture

Semantic Navigator is a knowledge base tool that imports markdown files, atomizes them into semantic chunks (article > chunk), and enables semantic search via embeddings.

### Data Flow

1. **Import**: User selects files from vault browser
2. **Parse**: `src/lib/parser.ts` uses mdast to parse markdown into hierarchical sections
3. **Ingest**: `src/lib/ingestion.ts` creates nodes in Supabase with embeddings and summaries
4. **Search**: Vector similarity search via pgvector's `search_similar` RPC function

### Key Abstractions

**Node Types** (stored in `nodes` table):
- `article`: Top-level document. Has `summary` only, no `content`.
- `chunk`: Semantic text segment. Has both `content` and optionally `summary`. May have `chunk_type` (e.g., "problem statement", "worked example") and `heading_context` (breadcrumb path like `["Introduction", "Background"]`).

**Edge Types**:
- `containment_edges`: Parent-child hierarchy (article → chunks)
- `backlink_edges`: Wiki-links between articles

**Keywords** (stored in `keywords` table):
- Each chunk has extracted keywords for enhanced search
- Keywords have their own embeddings (`vector(1536)`) for semantic matching
- Linked to nodes (chunk or article) via `node_id` foreign key; `node_type` denormalized for efficient filtering
- Used in both search (similarity matching) and the Map view (article clustering)

**Keyword Communities** (stored in `keyword_communities` table):
- Louvain community detection groups semantically similar keywords
- 8 resolution levels (0=coarsest ~22 clusters, 7=finest ~374 clusters) for semantic zooming
- Each level has its own hub keyword per community
- Computed by `scripts/compute-keyword-communities.ts`
- Similarity edges stored in `keyword_similarities` table (threshold > 0.7)

### Core Files

- `src/lib/parser.ts` - Markdown parsing with AST, strips frontmatter, extracts backlinks
- `src/lib/ingestion.ts` - Orchestrates node creation, embeddings, and summarization
- `src/lib/summarization.ts` - Claude API calls for summaries and keyword extraction
- `src/lib/embeddings.ts` - OpenAI embedding generation
- `src/lib/graph-queries.ts` - Reusable database queries for graph data (keyword backbone, similarity edges)
- `supabase/schema.sql` - Database schema with pgvector setup

### Core Hooks

- `src/hooks/useSemanticZoom.ts` - Filter graph data based on zoom level using community hierarchy
- `src/hooks/useClusterLabels.ts` - Generate cluster labels via LLM with caching
- `src/hooks/useStableRef.ts` - Prevent React effect re-runs for callbacks (see `docs/patterns/stable-refs.md`)
- `src/hooks/useD3TopicsRenderer.ts` - D3/SVG graph rendering logic for TopicsView
- `src/hooks/useThreeTopicsRenderer.ts` - Three.js/WebGL graph rendering logic for TopicsView
- `src/hooks/useTopicsFilter.ts` - Click-to-filter and external filter logic

### Renderer Architecture (D3 + Three.js)

The TopicsView supports two renderers that share application logic:

- **Shared logic** lives in `src/lib/`:
  - `topics-hover-controller.ts` - Hover highlighting, cursor tracking, click handling
  - `topics-graph-nodes.ts` - Node/edge conversion with `convertToSimNodes()`
- **Renderer-specific code** stays in hooks and renderer files
- **Adapter pattern**: Renderers implement `RendererAdapter` interface for the hover controller

**Code smell**: If you need to make the same fix in both `useD3TopicsRenderer` and `useThreeTopicsRenderer`, that's duplicated logic that should be extracted to a shared module.

### API Routes

- `POST /api/search` - Vector similarity search
- `POST /api/import/stream` - SSE-based import with progress updates
- `GET /api/vault` - Browse vault directory
- `GET /api/nodes/[id]` - Fetch node with children
- `GET /api/map` - Graph data for keyword-article visualization

### UI Components

- `src/components/SearchBar.tsx` - Semantic search with keyword matching display
- `src/components/VaultBrowser.tsx` - File picker for importing markdown files
- `src/components/NodeViewer.tsx` - Display node content and children
- `src/components/MapView.tsx` - D3 force-directed graph of articles and keywords
- `src/components/TopicsView.tsx` - **Main visualization view** for keyword-only graphs. Orchestrates modular hooks for rendering (D3 or Three.js), filtering, clustering, and project creation. This is the primary view being actively developed.
- `src/components/ImportProgress.tsx` - SSE-based import progress display

### Database

Uses Supabase with pgvector extension. Migrations in `supabase/migrations/`. Apply with `npx supabase db push`.

The `search_similar` RPC function performs cosine similarity search and returns matched keywords.

### Database Migrations

**Applying migrations:**
```bash
npx supabase db push  # Push pending migrations to remote database
```

**Evolving uncommitted migrations (before git commit):**

To modify a migration that's been applied to remote but not yet committed to git:

```bash
# 1. Manually undo the migration's changes (run in Supabase SQL Editor)
DROP FUNCTION IF EXISTS function_name(args);

# 2. Mark the migration as reverted in Supabase's tracking
npx supabase migration repair 007 --status reverted --linked

# 3. Edit the migration file locally

# 4. Re-apply
npx supabase db push
```

**Warning:** Never use `migration down --linked` on a database with data you care about. It resets the ENTIRE database (drops all tables) and reapplies migrations from scratch.

**Rolling back deployed migrations (after git commit/deploy):**

Supabase migrations are forward-only. To undo a deployed migration:
1. Create a NEW migration that reverses the changes
2. Never try to edit or remove already-deployed migration files

**Local development reset:**
```bash
npx supabase db reset  # Resets LOCAL database only (safe)
```

### Traversing the Hierarchy

To find an article from a keyword or chunk:
1. Keywords link to nodes via `keywords.node_id` (can be article or chunk)
2. Chunks link to articles via `containment_edges.child_id` → `parent_id`
3. Single hop: chunk → article (flat hierarchy)

Example pattern:
```sql
-- Get parent article of a chunk
SELECT parent_id FROM containment_edges WHERE child_id = <chunk_id>
-- parent_id will be the article (no intermediate sections)
```

## Styling

**Prefer CSS classes over inline styles.** Define reusable classes in `src/app/globals.css`.

**When to use CSS classes:**
- Styles that appear in multiple places or could be reused
- Theme-aware styles (light/dark mode via `prefers-color-scheme`)
- Structural styles (positioning, layout, transforms)
- Visual styles (colors, shadows, fonts)

**When inline styles are acceptable:**
- Dynamic values that change per-element (e.g., `left`, `top`, `opacity` computed from data)
- One-off styles truly specific to a single use case
- Values derived from runtime calculations (zoom level, node positions)

**When TypeScript assigns styles dynamically**, reference CSS base values in comments:
```typescript
// Base size matches .keyword-label in globals.css
const baseFontSize = 16;
const zoomScale = Math.min(1, 500 / cameraZ);
labelEl.style.fontSize = `${baseFontSize * zoomScale}px`;
```

**Composability:** Design classes to be combinable. For example:
- `.graph-label-overlay` - base overlay container
- `.graph-label-glow` - theme-aware text glow (can add to any element)
- `.keyword-label` - complete keyword label styling (convenience composition)

See `src/app/globals.css` for existing graph visualization label classes.

## Environment

Requires `.env.local` with:
- `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`
- `OPENAI_API_KEY` (embeddings)
- `ANTHROPIC_API_KEY` (summarization)
- `VAULT_PATH` (local path to markdown files)

**Important**: Never read `.env.local` directly. Access environment variables implicitly through the NPM environment (e.g., `process.env.OPENAI_API_KEY` in code, or by running scripts via `npx tsx`).

## Documentation

- `docs/README.md` - Architecture documentation index and ADRs
- `docs/patterns/` - Reusable code patterns (stable refs, etc.)

**When creating new documentation files**, always add a link to `docs/README.md` so they're discoverable. This includes ADRs, guides, patterns, and investigation reports.