# Documentation

## Guides

- [Clustering Systems](guides/clustering-systems.md) - Understanding the two clustering systems (MapView vs TopicsView), inspection tools, and maintenance
- [Local NPM Packages](guides/local-npm-packages.md) - Developing with locally checked-out packages (umapper)

## Patterns

- [Stable Refs](patterns/stable-refs.md) - Prevent React effect re-runs for callbacks and config (`useLatest`, `useStableCallback`)
- [Three.js & R3F Patterns](patterns/threejs-r3f/index.md) - Best practices for Three.js and React Three Fiber (instanceColor, materials, depth testing, event handling)

## Lab Experiments

- [Graph Layout Lab](../lab/graph-layout/README.md) - UMAP layout investigations: centrality balance, repulsion tuning, bipartite community detection

## Architecture

### Features

- [Filtered Map View](architecture/filtered-map-view.md) - Exploring articles by filtering out query-related keywords to reveal hidden connections
- [Cluster Labels](cluster-labels.md) - Semantic labels for keyword clusters via Leiden algorithm and LLM generation

### Investigations

- [Search Performance Investigation](architecture/search-performance-investigation.md) - Root cause analysis of search timeouts (resolved: PostgreSQL query planner behavior with explicit null parameters)
- [Chunk Node LOD Analysis](investigations/chunk-lod-analysis.md) - Performance analysis of Three.js chunk rendering with LOD optimization recommendations
- [Camera Z-Scale Sync Bug](investigations/camera-z-scale-sync-bug.md) - Keywords disappearing on zoom stop due to delayed camera initialization and mismatched Z↔K conversions (resolved: synchronous camera setup + shared CAMERA_Z_SCALE_BASE constant)
- [Keyword Material Double Bind](investigations/keyword-material-double-bind.md) - Black dots and broken clicks caused by vertexColors flag on instanced meshes (resolved: use base color + instanceColor without vertexColors)
- [Empty Chunk Labels Bug](investigations/empty-chunk-labels-investigation.md) - First N chunks rendering blank due to falsy check in React portal creation (resolved: always create portals when visible, normalize empty content)

### Architecture Decision Records (ADRs)

- [ADR-005: Hierarchical Keyword Bubbling](architecture/adr/005-hierarchical-keywords.md) - LLM-based keyword reduction for semantic map performance
- [ADR-006: Keyword node_type Denormalization](architecture/adr/006-keyword-node-type-denormalization.md) - Partial HNSW index for 8x map query speedup
- [ADR-008: Semantic Zoom](architecture/adr/008-semantic-zoom.md) - Zoom-based graph filtering with position persistence
- [ADR-010: Client-Side Clustering](architecture/adr/010-client-side-clustering.md) - Move Louvain clustering to client for graph topology consistency
- [ADR-012: WebGL Memory Leak Fix](architecture/adr/012-webgl-memory-leak-fix.md) - Proper WebGL context disposal to prevent browser unresponsiveness
- [ADR-013: Leiden Clustering with Precomputation](architecture/adr/013-leiden-clustering-precomputation.md) - Leiden algorithm for better peripheral cluster detection, with precomputed labels to reduce API costs
- [ADR-014: Chunk-Based Level of Detail](architecture/adr/014-chunk-based-level-of-detail.md) - Zoom-based progressive disclosure of paragraph chunks with 3D layering and lazy loading
