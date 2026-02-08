# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Workflow Expectations

Prefer producing working code changes over extended investigation. If exploring for more than 5 minutes without a concrete fix, present your best hypothesis and a minimal fix attempt rather than continuing to read files.

## Development Principles

**Before implementing TopicsView features**, read the [Architecture Onboarding Guide](docs/guides/architecture-onboarding.md) to understand existing patterns. The three essential files are:
1. `src/lib/topics-hover-controller.ts` - Interaction patterns
2. `src/components/topics-r3f/R3FTopicsScene.tsx` - Rendering architecture
3. `src/lib/topics-graph-nodes.ts` - Data transformation

When fixing bugs or implementing features, always check for existing patterns/systems before building new ones. Search for existing hover handlers, event systems, shared components, etc. before creating parallel implementations.

**Build reusable primitives, not local fixes.** When a behavior (fading, animation, filtering) is needed in one place, extract it as a hook or utility that works generically. Example: `useFadingMembership` animates any Set-based membership change, reused across edge rendering, content node visibility, etc. Inline solutions that solve one case are harder to reuse and tend to diverge.

## Project Tools

This project has a code-simplifier agent. After implementing features or fixes, use the project's simplification tool rather than doing manual simplification. Ask the user before simplifying if unsure.

## Common Pitfalls

**Label Flicker Bug (occurred 2x: 2026-02-06, 2026-02-07)**: When labels flicker on mouse movement or content updates, the cause is unstable dependencies in the label manager's `useEffect`. This destroys and recreates the manager on every render. **Pattern to follow:**
- Use `useStableCallback` for all callbacks passed to `LabelsOverlay`
- Use refs (not direct closure) for frequently-changing data like Maps
- Wrap expensive effects with `useStableEffect` to detect instability
- See [`docs/patterns/label-manager-stability.md`](docs/patterns/label-manager-stability.md) for full pattern and [`docs/patterns/enforcing-stability.md`](docs/patterns/enforcing-stability.md) for prevention tools

When implementing opacity/visibility features, check ALL code paths that set opacity on the same element. Multiple systems (base opacity, keyword label opacity, zoom-based fading) can conflict. Trace every opacity setter before proposing a fix.

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
- Used in both search (similarity matching) and visualization (clustering)

**Clustering Systems**:
- Semantic Navigator has **two clustering systems** serving different views
- **MapView** uses `keyword_communities` table (Louvain, 8 levels) - for article-keyword bipartite graphs
- **TopicsView** uses `precomputed_topic_clusters` table (Leiden, 8 resolutions) - for pure keyword graphs with client-side fallback
- See [Clustering Systems Guide](docs/guides/clustering-systems.md) for inspection tools, maintenance, and detailed comparison
- Inspect current state: `npm run script scripts/inspect-keyword-communities.ts`

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
- `src/hooks/useR3FTopicsRenderer.ts` - React Three Fiber rendering hook (primary renderer)
- `src/hooks/useTopicsFilter.ts` - Click-to-filter and external filter logic
- `src/hooks/useChunkLoading.ts` - Lazy loading of paragraph chunks for LOD

### Renderer Architecture

TopicsView supports three renderers. **R3F (React Three Fiber) is the primary renderer** under active development.

**R3F Renderer** (`src/components/topics-r3f/`):
- Component-based architecture using React Three Fiber
- `R3FTopicsCanvas.tsx` - Canvas wrapper with DOM label overlay
- `R3FTopicsScene.tsx` - Scene coordinator (orchestrates all components)
- `ForceSimulation.tsx` - D3-force simulation as React component
- `KeywordNodes.tsx`, `ChunkNodes.tsx` - Instanced mesh rendering
- `KeywordEdges.tsx`, `ChunkEdges.tsx` - Merged geometry edge rendering
- `TransmissionPanel.tsx` - Frosted glass effect between layers
- `CameraController.tsx` - Zoom/pan with cursor-centered zoom
- `LabelsOverlay.tsx` - DOM-based labels positioned via 3D→2D projection

**Shared logic** lives in `src/lib/`:
- `topics-hover-controller.ts` - Hover highlighting, cursor tracking, click handling
- `topics-graph-nodes.ts` - Node/edge conversion with `convertToSimNodes()`
- `chunk-scale.ts` - Zoom-based scale interpolation for LOD
- `chunk-layout.ts` - Force-based chunk positioning around keywords
- `chunk-zoom-config.ts` - Centralized zoom configuration

**Legacy renderers** (D3 and raw Three.js) remain for reference but R3F is preferred.

**Known gotcha — non-unique chunk node IDs**: `createChunkNodes()` in `chunk-layout.ts` creates a separate `ChunkSimNode` for each (keyword, chunk) pair. When a chunk is associated with multiple keywords, multiple nodes share the same `id`. Any Map keyed by `node.id` will silently lose data. Use composite keys like `${parentId}:${node.id}` when tracking chunks. See [Empty Chunk Labels investigation](docs/investigations/empty-chunk-labels.md).

**R3F rule — never call React setState inside useFrame**: `useFrame` runs every animation frame (60fps). Calling `setState` there causes React to re-render every frame with no error or warning. When bridging imperative animation loops with React state, track previous values and only update on actual changes.

## Three.js / R3F Patterns

When debugging rendering issues in Three.js/R3F:
1. THREE.Color does not accept chroma `.css()` output — use `.hex()` instead
2. InstancedMesh requires explicit color setting per instance
3. Check nodeType defaults in data queries when nodes are missing
4. Frustum culling can hide instanced meshes — set `frustumCulled=false` when needed
5. **Critical: Never let `args` change on `<instancedMesh>`** — R3F destroys/recreates the Three.js object without re-registering event handlers (onClick, onPointerOver, etc.). Use a monotonically increasing ref for the instance count, hide unused instances with scale=0, and reset `mesh.boundingSphere = null` each frame so raycasting stays accurate. See [investigation](docs/investigations/keyword-node-clicks-broken-2026-02-06.md) for full details.

### Keyword Interaction Handlers

**Click and hover events for keyword dots and labels must be identical.** Use the shared handler from `src/lib/keyword-interaction-handlers.ts` to ensure consistent behavior.
- Prevent code duplication and ensure clicking a dot vs. label behaves identically

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
- `src/components/TopicsView.tsx` - **Main visualization view** for keyword graphs with LOD chunks. Orchestrates rendering (R3F preferred), filtering, clustering, and project creation.
- `src/components/topics-r3f/` - R3F renderer components (see Renderer Architecture above)
- `src/components/ControlSidebar.tsx` - Collapsible settings panel for visualization controls
- `src/components/ImportProgress.tsx` - SSE-based import progress display

### Database

Uses Supabase with pgvector extension. Migrations in `supabase/migrations/`. Apply with `npx supabase db push`.

The `search_similar` RPC function performs cosine similarity search and returns matched keywords.

**Supabase JS client gotcha — default 1000-row limit:** `supabase.from('table').select()` returns at most 1000 rows by default. For tables with more rows, either use `.range(from, to)` for pagination or use an RPC function. This limit is silent — no error is returned, you just get truncated data.

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

## Architecture Notes

This project uses precomputed clusters (from database) AND runtime/dynamic clusters. They have different ID systems. Always verify which cluster ID system is in use before implementing cluster-related features. Check the dynamic clustering checkbox state and existing documentation.

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
- `docs/guides/architecture-onboarding.md` - **Essential reading before implementing TopicsView features**
- `docs/patterns/` - Reusable code patterns (stable refs, etc.)

**When creating new documentation files**, always add a link to `docs/README.md` so they're discoverable. This includes ADRs, guides, patterns, and investigation reports.