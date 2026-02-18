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

**Code simplification:** After implementing features or fixes, use the code-simplifier agent via the Task tool rather than doing manual simplification. Invoke with:
```
Task tool, subagent_type: "code-simplifier:code-simplifier", prompt: "Simplify [file path]"
```
Ask the user before simplifying if unsure.

## Common Pitfalls

**Label Flicker Bug (occurred 2x: 2026-02-06, 2026-02-07)**: When labels flicker on mouse movement or content updates, the cause is unstable dependencies in `useEffect` that destroy and recreate expensive objects every render. **Pattern to follow:**
- Use `useStableCallback` for all callbacks passed as props to label/overlay components
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

**Worktrees**: Use `./scripts/create-worktree.sh <branch-name>` to create a git worktree for isolated feature development. It creates the worktree, symlinks `.env.local`, and runs `npm install`.

**Note**: Let the user run `npm run dev` in their own terminal rather than running it from Claude. This keeps the dev server visible and controllable by the user.

## Testing

- After modifying `src/lib/parser.ts` - parser tests verify frontmatter stripping and hierarchy generation
- After modifying `src/lib/ingestion-*.ts` - verify node creation logic
- Before committing significant changes
- After fixing bugs (add a regression test first, verify it fails, then fix)

**Scripts**: When writing scripts, reuse existing lib functions (e.g., `createServerClient` from `src/lib/supabase`, `generateEmbedding` from `src/lib/embeddings`) rather than reimplementing them. Check existing scripts in `scripts/` for patterns.

## Architecture

Semantic Navigator is a knowledge base tool that imports markdown files, atomizes them into semantic chunks (article > chunk), and enables semantic search via embeddings.

### Data Flow

1. **Import**: User selects files from vault browser
2. **Parse**: `src/lib/parser.ts` uses mdast to parse markdown into hierarchical sections
3. **Ingest**: `src/lib/ingestion-parallel.ts` orchestrates node creation in Supabase with embeddings and summaries (split across `ingestion-chunks.ts` and `ingestion-utils.ts`)
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
- **Graph filtering**: Only keywords that connect content to OTHER content are shown in TopicsView/MapView (see [ADR-015](docs/architecture/adr/015-keywords-as-navigation-primitives.md)). Keywords are navigation primitives, not exhaustive metadata. Filtered keywords remain in the database for search.

**Clustering Systems**:
- Semantic Navigator has **two clustering systems** serving different views, with different ID systems. Always verify which cluster ID system is in use before implementing cluster-related features.
- **MapView** uses `keyword_communities` table (Louvain, 8 levels) - for article-keyword bipartite graphs
- **TopicsView** uses `precomputed_topic_clusters` table (Leiden, 8 resolutions) - for pure keyword graphs with client-side fallback
- See [Clustering Systems Guide](docs/guides/clustering-systems.md) for inspection tools, maintenance, and detailed comparison

### Core Files

- `src/lib/parser.ts` - Markdown parsing with AST, strips frontmatter, extracts backlinks
- `src/lib/ingestion-parallel.ts` - Orchestrates node creation, embeddings, and summarization (with `ingestion-chunks.ts`, `ingestion-utils.ts`)
- `src/lib/summarization.ts` - Claude API calls for summaries and keyword extraction
- `src/lib/embeddings.ts` - OpenAI embedding generation
- `src/lib/graph-queries.ts` - Reusable database queries for graph data (keyword backbone, similarity edges)
- `src/lib/embedding-pca.ts` - PCA dimensionality reduction for embeddings (used in spatial layout)
- `src/lib/keyword-deduplication.ts` / `keyword-similarity.ts` - Semantic keyword dedup during ingestion
- `src/lib/focus-mode.ts` - Focus mode state management for filtered exploration
- `supabase/schema.sql` - Database schema with pgvector setup

### Core Hooks

- `src/hooks/useSemanticZoom.ts` - Filter graph data based on zoom level using community hierarchy
- `src/hooks/useClusterLabels.ts` - Generate cluster labels via LLM with caching
- `src/hooks/useStableRef.ts` - Prevent React effect re-runs for callbacks (see `docs/patterns/stable-refs.md`)
- `src/hooks/useR3FTopicsRenderer.ts` - React Three Fiber rendering hook (primary renderer)
- `src/hooks/useTopicsFilter.ts` - Click-to-filter and external filter logic
- `src/hooks/useContentLoading.ts` - Lazy loading of content chunks for LOD
- `src/hooks/useContentSimulation.ts` - Content node force simulation
- `src/hooks/useStableInstanceCount.ts` - Stable instanced mesh allocation (see instancedMesh gotcha)
- `src/hooks/useFadingMembership.ts` - Animated Set-based membership transitions
- `src/hooks/useTopicsSearch.ts` / `useTopicsSearchOpacity.ts` - Search integration for TopicsView
- `src/hooks/useGraphHoverHighlight.ts` - Shared hover highlight logic
- `src/hooks/useFadingVisibility.ts` - Generic animated 0→1 transitions for items entering/leaving a Set (works in any context, not R3F-specific)
- `src/hooks/useFadingScale.ts` - Animated scale transitions via rAF for focus mode node scaling
- `src/hooks/usePositionInterpolation.ts` - Time-based lerp for smooth position transitions (Map-based for TopicsView, array-based for ChunksView)
- `src/hooks/useFocusZoomExit.ts` - Auto-exits focus/lens mode when camera zooms out past threshold
- `src/hooks/useUmapLayout.ts` - Runs UMAP step-by-step with rAF, returns positions + neighborhood edges (ChunksView)
- `src/hooks/useChunkForceLayout.ts` - D3 force simulation overlay on UMAP positions (ChunksView)

### Renderer Architecture

TopicsView supports three renderers. **R3F (React Three Fiber) is the primary renderer** under active development.

**R3F Renderer** (`src/components/topics-r3f/`):
- Component-based architecture using React Three Fiber
- `R3FTopicsCanvas.tsx` - Canvas wrapper
- `R3FTopicsScene.tsx` - Scene coordinator (orchestrates all components)
- `ForceSimulation.tsx` / `UnifiedSimulation.tsx` - D3-force simulation
- `KeywordNodes.tsx`, `ContentNodes.tsx` - Instanced mesh rendering
- `KeywordEdges.tsx`, `ContentEdges.tsx`, `EdgeRenderer.tsx` - Edge rendering
- `TransmissionPanel.tsx` - Frosted glass effect between layers
- `CameraController.tsx` - Zoom/pan with cursor-centered zoom
- `KeywordLabels3D.tsx`, `ContentTextLabels3D.tsx`, `ClusterLabels3D.tsx` - 3D text labels
- `R3FLabelContext.tsx` - Label coordination context
- `ThreeTextLabel.tsx`, `GraphTextLabel.tsx`, `MarkdownTextBillboard.tsx` - Text rendering primitives

**Shared logic** lives in `src/lib/`:
- `topics-hover-controller.ts` - Hover highlighting, cursor tracking, click handling
- `topics-graph-nodes.ts` - Node/edge conversion with `convertToSimNodes()`
- `content-scale.ts` - Zoom-based scale interpolation for LOD
- `content-layout.ts` - Force-based content positioning around keywords
- `content-zoom-config.ts` - Centralized zoom configuration
- `label-fade-coordinator.ts` - Cross-component label visibility coordination
- `edge-pulling.ts` - Pull off-screen nodes to viewport boundary as navigational ghosts (shared by TopicsView + ChunksView)
- `chunks-pull-state.ts` - ChunksView-specific pull state computation (index-based flat model)
- `fisheye-viewport.ts` - Lp-norm directional compression for rounded-rectangle focus areas
- `chunks-lens.ts` - BFS neighborhood, lens scale blending, color emphasis for ChunksView
- `chunks-geometry.ts` / `chunks-utils.ts` - ChunksView geometry and utilities

**Legacy renderers** (D3 and raw Three.js) remain for reference but R3F is preferred.

### ChunksView Architecture

**ChunksView** (`src/components/ChunksView.tsx`) is a chunk-level visualization complementing TopicsView. It displays individual text chunks as cards in a UMAP-computed 2D layout, with a fisheye lens for focus navigation.

**Key differences from TopicsView:**
- **Layout**: UMAP embedding projection (`useUmapLayout`) instead of force-directed graph. D3 force refines positions after UMAP (`useChunkForceLayout`).
- **Nodes**: Renders chunks (not keywords) as cards colored by source article.
- **Interaction**: Click a chunk to activate a fisheye lens that compresses neighbors (BFS 1-hop via `chunks-lens.ts`). `useFocusZoomExit` auto-exits lens on zoom-out.
- **Edge pulling**: Off-screen neighbors of visible chunks are pulled to viewport edges as ghosts (`chunks-pull-state.ts`). Shares `computePullPosition`, visual constants, and viewport zone utilities with TopicsView via `edge-pulling.ts`. Clicking a ghost flies to its real position + activates lens. See [Edge Pulling](docs/architecture/edge-pulling.md).
- **Lens math**: `fisheye-viewport.ts` provides Lp-norm directional compression for rounded-rectangle shaped focus areas. `hyperbolic-compression.ts` handles radial compression.

**Components** (`src/components/chunks-r3f/`): `ChunksCanvas.tsx` → `ChunksScene.tsx` → `ChunkEdges.tsx`, `ChunkTextLabels.tsx`. Settings via `ChunksControlSidebar.tsx` (UMAP params: nNeighbors, minDist, spread; lens params: compression, scale, horizon shape).

**Known gotcha — non-unique content node IDs**: `createContentNodes()` in `content-layout.ts` creates a separate `ContentSimNode` for each (keyword, chunk) pair. When a chunk is associated with multiple keywords, multiple nodes share the same `id`. Any Map keyed by `node.id` will silently lose data. Use composite keys like `${parentId}:${node.id}` when tracking content nodes. See [Empty Chunk Labels investigation](docs/investigations/empty-chunk-labels.md).

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
- `GET /api/topics` - Keyword graph data for TopicsView
- `GET /api/topics/content` - Content chunks for a keyword
- `GET /api/precomputed-clusters` - Precomputed Leiden clusters
- `GET/POST /api/cluster-labels` - Cluster label generation/caching (with `/warm` and `/refine` sub-routes)
- `GET/POST /api/projects` - Project CRUD; `GET/PATCH/DELETE /api/projects/[id]`
- `GET /api/projects/[id]/associations` - Project-node associations
- `GET /api/projects/[id]/neighborhood` - Semantic neighborhood of a project
- `GET /api/chunks/embeddings` - Chunk embeddings for UMAP layout (ChunksView)
- `GET /api/keywords/associations` - Keyword-node associations
- `GET /api/nodes/all` - All nodes (paginated)
- `GET /api/localStorage-backup` - Persist/restore localStorage state
- `GET /api/music` - Background music streaming

### UI Components

- `src/components/SearchBar.tsx` - Semantic search with keyword matching display
- `src/components/VaultBrowser.tsx` - File picker for importing markdown files
- `src/components/NodeViewer.tsx` - Display node content and children
- `src/components/MapView.tsx` - D3 force-directed graph of articles and keywords
- `src/components/TopicsView.tsx` - **Main visualization view** for keyword graphs with LOD chunks. Orchestrates rendering (R3F preferred), filtering, clustering, and project creation.
- `src/components/topics-r3f/` - R3F renderer components (see Renderer Architecture above)
- `src/components/ControlSidebar.tsx` - Collapsible settings panel for visualization controls
- `src/components/ImportProgress.tsx` - SSE-based import progress display
- `src/components/ChunksView.tsx` - UMAP-based chunk visualization with fisheye lens (see ChunksView Architecture)
- `src/components/ChunksControlSidebar.tsx` - Settings for UMAP params and lens compression
- `src/components/ProjectSelector.tsx` / `ProjectSidebar.tsx` - Project management UI
- `src/components/BackupManager.tsx` - Auto-saves localStorage to server every 5 minutes, with manual save/restore
- `src/components/OfflineModeToggle.tsx` - Toggle to serve cached data from local JSON instead of database
- `src/components/CollapsibleSidebar.tsx` - Shared collapsible sidebar wrapper

### Database

Uses Supabase with pgvector extension. Migrations in `supabase/migrations/`. Apply with `npx supabase db push`.

The `search_similar` RPC function performs cosine similarity search and returns matched keywords.

**Supabase JS client gotcha — default 1000-row limit:** `supabase.from('table').select()` returns at most 1000 rows by default. For tables with more rows, either use `.range(from, to)` for pagination or use an RPC function. This limit is silent — no error is returned, you just get truncated data.

### Database Migrations

- Apply: `npx supabase db push`
- Local reset: `npx supabase db reset` (local only, safe)
- Migrations are forward-only once deployed — create a NEW migration to undo changes
- **Warning:** Never use `migration down --linked` — it resets the ENTIRE database
- To evolve uncommitted migrations: manually undo in SQL Editor, `supabase migration repair <num> --status reverted --linked`, edit file, re-push

### Traversing the Hierarchy

Keywords → nodes via `keywords.node_id`. Chunks → articles via `containment_edges` (single hop, flat hierarchy).

## Styling

**Prefer CSS classes over inline styles.** Define reusable classes in `src/app/globals.css`. Design classes to be composable (e.g., `.graph-label-overlay` + `.graph-label-glow`).

**Inline styles are acceptable** for dynamic per-element values computed at runtime (positions, opacity, zoom-derived sizes). When TypeScript assigns dynamic styles, reference the CSS base value in a comment so the connection is discoverable.

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