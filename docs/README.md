# Documentation

## Guides

- [Architecture Onboarding](guides/architecture-onboarding.md) - **Essential reading before implementing TopicsView features** - The three key files to understand existing patterns, TDD workflow with project-specific test patterns, and how to avoid building parallel implementations
- [Indexing Pipeline](guides/indexing-pipeline.md) - Complete guide to how markdown files are ingested: parsing, chunking, embedding generation, keyword extraction, and database storage
- [Chunk Ingestion Pipeline](guides/running-chunk-ingestion.md) - Reference guide for the ingestion pipeline: phases, caching, incremental runs, REPL commands, and troubleshooting
- [TypeScript REPL](guides/typescript-repl.md) - Interactive development with TypeScript REPL for experimenting with import infrastructure, querying the database, and prototyping changes
- [Clustering Systems](guides/clustering-systems.md) - Understanding the two clustering systems (MapView vs TopicsView), inspection tools, and maintenance
- [Local NPM Packages](guides/local-npm-packages.md) - Developing with locally checked-out packages (umapper)

## Patterns

- [Fading Visibility Animation](patterns/fading-visibility-animation.md) - Generic smooth animated transitions for Set-based visibility changes with R3F and non-R3F specializations
- [Position Interpolation](patterns/position-interpolation.md) - Time-based coordinate transitions with easing for focus/lens mode animations in TopicsView and ChunksView
- [Fisheye Compression](patterns/fisheye-compression.md) - Smooth radial viewport compression for focus mode to keep nodes visible without snapping
- [Rounded Rectangle Fisheye](patterns/rounded-rectangle-fisheye.md) - Directional horizon compression using Lp norm to fill viewport with rounded rectangle boundary instead of circular
- [Stable Refs](patterns/stable-refs.md) - Prevent React effect re-runs for callbacks and config (`useLatest`, `useStableCallback`)
- [Label Manager Stability](patterns/label-manager-stability.md) - Prevent label flicker by stabilizing useEffect dependencies (refs for volatile data, useStableCallback for handlers)
- [Enforcing Stability](patterns/enforcing-stability.md) - ESLint rules, TypeScript types, and runtime detection to prevent unstable callback bugs
- [Three.js & R3F Patterns](patterns/threejs-r3f/index.md) - Best practices for Three.js and React Three Fiber (instanceColor, materials, depth testing, event handling)

## Lab Experiments

- [Graph Layout Lab](../lab/graph-layout/README.md) - UMAP layout investigations: centrality balance, repulsion tuning, bipartite community detection

## Architecture

### Features

- [Filtered Map View](architecture/filtered-map-view.md) - Exploring articles by filtering out query-related keywords to reveal hidden connections
- [Cluster Labels](cluster-labels.md) - Semantic labels for keyword clusters via Leiden algorithm and LLM generation
- [Edge Pulling](architecture/edge-pulling.md) - Pull off-screen keyword neighbors to viewport edges as navigational ghosts with visible connections

### Plans

- [Incremental Ingestion Pipeline](plans/incremental-ingestion-pipeline.md) - Two-phase pipeline for processing unlimited articles with batched ingestion, idempotency, and resumability
- [Click-to-Focus with Margin Push](plans/click-to-focus-margin-push.md) - Replace click-to-filter with animated focus mode that pushes non-neighbors to viewport margins
- [Lens Transition Animation](plans/2026-02-18-lens-transition-implementation.md) - Smooth 500ms easeOutCubic entrance animation for ChunksView fisheye lens mode via `useLensTransition` hook
- [ChunksView Cluster Labels](plans/2026-02-18-chunks-cluster-labels-design.md) - Server-cached UMAP positions with Leiden clustering at two resolutions and Haiku-generated labels, reusing TopicsView's ClusterLabels3D

### Investigations

- [Search Performance Investigation](architecture/search-performance-investigation.md) - Root cause analysis of search timeouts (resolved: PostgreSQL query planner behavior with explicit null parameters)
- [Chunk Node LOD Analysis](investigations/chunk-lod-analysis.md) - Performance analysis of Three.js chunk rendering with LOD optimization recommendations
- [Camera Z-Scale Sync Bug](investigations/camera-z-scale-sync-bug.md) - Keywords disappearing on zoom stop due to delayed camera initialization and mismatched Z↔K conversions (resolved: synchronous camera setup + shared CAMERA_Z_SCALE_BASE constant)
- [Keyword Material Double Bind](investigations/keyword-material-double-bind.md) - Black dots and broken clicks caused by vertexColors flag on instanced meshes (resolved: use base color + instanceColor without vertexColors)
- [Empty Chunk Labels Bug](investigations/empty-chunk-labels.md) - Shared chunks across keywords caused Map key collisions in screen rects, DOM label cache, and visibility tracking (resolved: composite keys + per-frame callback gating)
- [Keyword Node Clicks Broken](investigations/keyword-node-clicks-broken-2026-02-06.md) - R3F silently drops onClick handlers when instancedMesh `args` change during data loading + React Strict Mode remount (resolved: 50% over-allocation buffer, stable ref callback)
- [Content Node Deduplication](investigations/content-node-deduplication-2026-02-07.md) - **NEEDS REVIEW** - Eliminated duplicate content nodes (one per chunk with multiple parent keywords), added spring force slider, multi-parent force simulation (potential issues with force balance, collision performance, label system)
- [Topics Loading Optimization](investigations/topics-loading-optimization-2026-02-08.md) - **IN PROGRESS** - Reducing `getKeywordBackbone()` from ~9s to ~2s via lean SQL, parallel queries, and fixing 1000-row PostgREST truncation
- [Content Card Spacing](investigations/content-card-spacing.md) - Problem space analysis: simulation uses static world-space heuristics but correct spacing depends on zoom, viewport, and fisheye state
- [Chunk Card Occlusion](investigations/chunk-card-occlusion-2026-02-17.md) - Cards must occlude overlapping cards' text; resolved via stable per-index z ordering (card i at z=i*step, text at z=i*step+step/2)
- [Focus Activation Node Jump](investigations/focus-activation-node-jump.md) - **OPEN** - Nodes jump outward from screen center when first entering focus mode; subsequent focus changes are stable

### Implementation Notes

- [ChunksView Position Interpolation](implementation-notes/chunks-position-interpolation.md) - Applied smooth position interpolation to ChunksView lens mode using `useArrayPositionInterpolation` for continuous graph morphing (400ms easeOutCubic transitions)

### Architecture Decision Records (ADRs)

- [ADR-005: Hierarchical Keyword Bubbling](architecture/adr/005-hierarchical-keywords.md) - LLM-based keyword reduction for semantic map performance
- [ADR-006: Keyword node_type Denormalization](architecture/adr/006-keyword-node-type-denormalization.md) - Partial HNSW index for 8x map query speedup
- [ADR-008: Semantic Zoom](architecture/adr/008-semantic-zoom.md) - Zoom-based graph filtering with position persistence
- [ADR-010: Client-Side Clustering](architecture/adr/010-client-side-clustering.md) - Move Louvain clustering to client for graph topology consistency
- [ADR-011: Semantic Cluster Coloring](architecture/adr/011-semantic-cluster-coloring.md) - Embedding-to-color mapping via PCA projection for stable, semantically meaningful node and cluster colors
- [ADR-012: WebGL Memory Leak Fix](architecture/adr/012-webgl-memory-leak-fix.md) - Proper WebGL context disposal to prevent browser unresponsiveness
- [ADR-013: Leiden Clustering with Precomputation](architecture/adr/013-leiden-clustering-precomputation.md) - Leiden algorithm for better peripheral cluster detection, with precomputed labels to reduce API costs
- [ADR-014: Content-Based Level of Detail](architecture/adr/014-content-based-level-of-detail.md) - Zoom-based progressive disclosure of paragraph chunks with 3D layering and lazy loading
- [ADR-015: Keywords as Navigation Primitives](architecture/adr/015-keywords-as-navigation-primitives.md) - Filter keywords to show only those that connect content, treating them as navigation tools rather than exhaustive metadata
