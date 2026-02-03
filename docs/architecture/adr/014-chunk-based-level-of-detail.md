# ADR 014: Chunk-Based Level of Detail (LOD)

## Status
Implemented

## Context

The TopicsView renders a keyword-only graph where each keyword node represents multiple underlying paragraph chunks (the actual content from the knowledge base). Users can see the semantic structure at the keyword level, but have no way to drill down into specific paragraphs without leaving the graph view.

### Problem Statement

**Users need to explore content at multiple semantic granularities:**
- Zoomed out: See the keyword-level semantic landscape (current state)
- Zoomed in: See the actual paragraphs that keywords represent (missing)

**Current limitations:**
1. **No content preview in graph:** Users must click keywords to open a sidebar, breaking the spatial exploration flow
2. **Lost context when drilling down:** Transitioning to a list/detail view loses the graph's spatial relationships
3. **Binary navigation:** Either view keywords OR view content, no smooth continuum

**Desired UX:**
- Zoom out → see keyword clusters representing topics
- Zoom in → see individual paragraph chunks spreading organically from their parent keywords
- Smooth transition between abstraction levels without losing spatial context

### Technical Challenges

**Challenge 1: Scale**
- Existing graph: 266 keywords, ~500 edges
- With chunks: +2000-3000 paragraph nodes, +2000-3000 containment edges
- Total: ~10x increase in rendered elements

**Challenge 2: Visual Clutter**
- Rendering all chunks simultaneously would create an unreadable hairball
- Need progressive disclosure based on zoom level

**Challenge 3: Spatial Layout**
- Chunks must position near their parent keywords (semantic locality)
- Chunks must avoid overlapping siblings (readability)
- Layout must remain stable during zoom transitions (no jarring repositioning)

**Challenge 4: Performance**
- Three.js renderer must handle 3000+ nodes smoothly
- Data loading must not block interaction
- Memory usage must remain reasonable for long sessions

## Alternatives Considered

### Option A: Separate Chunk View (Modal/Sidebar)
**Approach:** Click keyword → open modal/sidebar with chunk list

- ✅ Simple implementation (already have NodeViewer component)
- ✅ No performance concerns (loads on demand)
- ❌ **Breaks spatial exploration flow**
- ❌ Loses graph context when viewing chunks
- ❌ Binary navigation (graph OR chunks, not both)

### Option B: Hierarchical Graph Expansion
**Approach:** Click keyword → expand to show chunks as tree layout

- ✅ Maintains graph context
- ✅ Explicit user control over expansion
- ⚠️ Requires manual expansion/collapse (tedious for exploration)
- ⚠️ Tree layout conflicts with force-directed keyword layout
- ⚠️ Reflow after expansion can be jarring

### Option C: Zoom-Based LOD with Layering (Selected)
**Approach:** Camera zoom controls visibility and positioning of chunk layer behind keywords

- ✅ **Smooth zoom-based transition** (no manual toggling)
- ✅ **Preserves spatial context** (chunks positioned near keywords)
- ✅ **Automatic progressive disclosure** (complexity hidden when zoomed out)
- ✅ **Leverages 3D depth** (chunks at z=-150, keywords at z=0)
- ⚠️ Requires zoom-based scale interpolation system
- ⚠️ Requires lazy loading infrastructure
- ⚠️ More complex initial implementation

**Why this approach:**
- Matches user's natural exploration pattern (zoom to explore)
- No mode switching or manual expansion (stays in flow state)
- Scalable to larger datasets (chunks only load/render when visible)
- Aligns with existing semantic zoom infrastructure (ADR-008)

### Option D: Minimap/Detail View Split
**Approach:** Split screen with keyword overview + chunk detail view

- ✅ Shows both levels simultaneously
- ❌ Sacrifices screen real estate
- ❌ Divided attention (not spatially unified)
- ❌ Doesn't scale to large screens or future VR/3D interfaces

## Decision

**Implement zoom-based level of detail using 3D layering and progressive loading.**

### Core Mechanism: Zoom-Controlled Visibility

**Zoom range mapping:**
```
Camera Z Distance:
  20000 (far)  → Keywords at 100% scale, chunks at 0% scale (invisible)
  10000        → Transition midpoint
     50 (near) → Keywords at 0% scale (hidden), chunks at 100% scale
```

**Scale interpolation:**
- Keywords: Linear fade-out as camera approaches (t)
- Chunks: Exponential fade-in as camera approaches (1-t)²
- Edges: Opacity follows chunk scale

**Why exponential for chunks:**
- Keeps chunks invisible until close (avoids clutter when zoomed out)
- Rapid appearance once transition starts (clear visual feedback)
- Matches user expectation (content appears "suddenly" as you zoom in)

### Architecture: Modular Responsibilities

**1. Configuration Layer** ([src/lib/chunk-zoom-config.ts](src/lib/chunk-zoom-config.ts))
- Single source of truth for all zoom-related constants
- Ratio-based values relative to `BASE_CAMERA_Z = 1000`
- Easy tweaking without hunting through codebase

**2. Scale Calculation** ([src/lib/chunk-scale.ts](src/lib/chunk-scale.ts))
- Pure function: `calculateScales(cameraZ) → ScaleValues`
- Interpolates keyword/chunk scales, label opacities, edge opacities
- No side effects, easily testable

**3. Data Loading** ([src/hooks/useChunkLoading.ts](src/hooks/useChunkLoading.ts))
- Lazy loading: Fetch chunks only for visible keywords
- Debounced (200ms) to batch rapid zoom changes
- Persistent cache to avoid refetching
- Groups chunks by parent keyword for efficient lookup

**4. Layout System** ([src/lib/chunk-layout.ts](src/lib/chunk-layout.ts))
- `createChunkNodes()`: Initialize chunks at parent keyword XY coordinates
- `applyConstrainedForces()`: Spread chunks organically around parent
  - Spring force toward parent (keeps chunks nearby)
  - Sibling repulsion (avoids overlap)
  - Distance constraint (max 3× keyword radius from parent)

**5. Renderer Integration** ([src/lib/three/node-renderer.ts](src/lib/three/node-renderer.ts))
- Chunk visual style: Blue stroke (#3b82f6), white fill
- Scale updates on every camera move
- Separate node cache for chunks (prevents keyword cache churn)

### Data Flow

```
1. User zooms camera
   ↓
2. Camera controller updates cameraZ
   ↓
3. calculateScales(cameraZ) → { keywordScale, chunkScale, ... }
   ↓
4. Renderer updates node scales + visibilities
   ↓
5. If chunkScale > threshold:
     useChunkLoading fetches chunks for visible keywords (debounced)
   ↓
6. applyConstrainedForces spreads chunks around keywords
   ↓
7. Renderer displays chunks at calculated scale
```

### Database Query

**API Endpoint:** `POST /api/topics/chunks`

**Input:** `{ keywordIds: ["kw:label1", "kw:label2", ...] }`

**Query:**
```sql
SELECT
  keywords.id,
  keywords.keyword,
  keywords.node_id,
  nodes.id,
  nodes.content,
  nodes.summary
FROM keywords
INNER JOIN nodes ON keywords.node_id = nodes.id
WHERE keywords.keyword IN (...)
  AND nodes.node_type = 'chunk'
```

**Output:** Chunks grouped by keyword for easy layout consumption

## Trade-offs

### Progressive Loading
- ✅ Minimal initial page load (chunks load on demand)
- ✅ Scales to large datasets (only visible chunks loaded)
- ✅ Reduces memory usage (cache eviction for distant keywords)
- ⚠️ Network latency on first zoom-in (~200-500ms for 200 chunks)
- ⚠️ Debounce delay means fast zoom gestures may miss intermediate states

### 3D Layering
- ✅ Clean visual separation (chunks "behind" keywords)
- ✅ No z-fighting between keywords and chunks
- ✅ Future-proof for VR/AR interfaces (true depth perception)
- ⚠️ Requires orthographic camera for consistent scaling (already in use)
- ⚠️ Z-depth of -150 is somewhat arbitrary (tuned by visual testing)

### Constrained Force Layout
- ✅ Organic spread (looks natural, not grid-like)
- ✅ Avoids overlaps (sibling repulsion)
- ✅ Maintains parent proximity (spring force + distance constraint)
- ⚠️ Not deterministic (slight variation on each load due to force simulation)
- ⚠️ Requires multiple simulation ticks (10-20 iterations for stability)

### Scale Interpolation
- ✅ Smooth transitions (no popping)
- ✅ Configurable (all values in one file)
- ✅ Testable (pure function with predictable output)
- ⚠️ Exponential curve for chunks means narrow transition zone
  - Chunks invisible at cameraZ > 5000
  - Fully visible at cameraZ < 1000
  - Transition happens in 1000-5000 range (80% of zoom range unused)
  - **Rationale:** Keeps graph clean at keyword scale, reveals chunks only when needed

## Implementation Plan

### Files Created
1. **`src/lib/chunk-zoom-config.ts`** - Centralized zoom configuration
2. **`src/lib/chunk-scale.ts`** - Scale interpolation logic
3. **`src/lib/chunk-loader.ts`** - Data fetching utilities
4. **`src/lib/chunk-layout.ts`** - Force-based layout algorithm
5. **`src/hooks/useChunkLoading.ts`** - Lazy loading hook with caching
6. **`src/app/api/topics/chunks/route.ts`** - API endpoint for chunk data
7. **`src/lib/__tests__/chunk-scale.test.ts`** - Scale calculation tests

### Files Modified
1. **`src/lib/three/renderer.ts`** - Integrate chunk loading and rendering
2. **`src/lib/three/node-renderer.ts`** - Add chunk node type handling
3. **`src/lib/three/edge-renderer.ts`** - Render containment edges (keyword → chunk)
4. **`src/lib/three/camera-controller.ts`** - Expose cameraZ for scale calculations
5. **`src/hooks/useThreeTopicsRenderer.ts`** - Wire up chunk loading hook
6. **`src/components/TopicsView.tsx`** - Pass enableChunks flag to renderer

### Performance Optimizations
1. **Visibility culling** (future): Hide chunks when scale < 0.01 (invisible anyway)
   - Estimated savings: 0.5-1ms/frame when zoomed out
2. **Instanced rendering** (if needed): Render all chunks in 2 draw calls instead of 532
   - Requires profiling to confirm draw call bottleneck first
   - Only implement if frame drops detected

## Consequences

### Positive
- **Seamless exploration:** Users can zoom smoothly between keyword and chunk granularities
- **Spatial context preserved:** Chunks appear near their keywords (semantic locality)
- **Scalable architecture:** Progressive loading prevents performance degradation with large datasets
- **Reusable patterns:** Zoom config, scale calculation, and lazy loading are reusable for future LOD features
- **Testable:** Pure functions for scale calculation, force simulation can be tested in isolation
- **Configurable:** All zoom behavior controlled by ratios in one config file

### Negative
- **Added complexity:** ~600 lines of new code across 7 files
- **Network dependency:** First zoom-in requires API call (mitigated by caching)
- **Memory usage:** Chunk cache grows with exploration (could add LRU eviction)
- **Non-deterministic layout:** Force simulation varies slightly across loads

### Neutral
- **Three.js dependency deepens:** More investment in Three.js renderer (vs D3)
  - **Note:** D3 renderer still supported, chunk system could be ported if needed
- **Z-depth magic number:** `CHUNK_Z_OFFSET = -0.15` tuned empirically
  - Could expose as user preference in future
- **Exponential interpolation:** Narrow transition zone may surprise users
  - Could switch to S-curve (sigmoid) for wider transition zone if users request it

## Future Enhancements

### 1. Chunk Filtering by Content
Allow users to search/filter chunks by text content, highlighting matches in graph.

**Implementation:**
- Add search index to chunks API
- Pass filter query to useChunkLoading
- Fade out non-matching chunks in renderer

### 2. Chunk Embedding Similarity
Use chunk embeddings (256-dim) for semantic operations:
- Find similar chunks across keywords
- Color chunks by topic coherence
- Detect outlier chunks within keyword clusters

**Database:**
- Chunks already have embeddings in `nodes` table
- Add vector similarity search RPC similar to `search_similar`

### 3. Adaptive Detail Level
Automatically adjust chunk density based on viewport size and zoom level:
- Far zoom: Show only top-N chunks per keyword (summarized)
- Close zoom: Show all chunks
- Very close zoom: Show chunk text inline

**Implementation:**
- Add chunk ranking by relevance/centrality
- Modify useChunkLoading to request top-N chunks
- Add text overlay rendering in node-renderer

### 4. Section Layer
Add intermediate hierarchy level between keywords and chunks:
- Keywords → Sections → Paragraphs
- Section nodes at z=-50, chunk nodes at z=-150
- Requires database query optimization (join through containment_edges)

## Verification

**Manual testing performed:**
1. ✅ Zoom transitions are smooth (no popping or jank)
2. ✅ Chunks appear near parent keywords (spatial locality)
3. ✅ No chunk overlaps visible at full zoom
4. ✅ Loading indicator shows during fetch
5. ✅ Cache prevents refetching on repeated zoom in/out
6. ✅ Console logs confirm debouncing (no spam during rapid zoom)

**Automated tests:**
- ✅ Scale calculation at min/max/mid zoom levels
- ⏳ Force layout convergence (not yet implemented)
- ⏳ Cache hit rate monitoring (not yet implemented)

**Performance analysis:**
- See `docs/investigations/chunk-lod-analysis.md` for detailed benchmarks
- Current bottleneck: Draw calls (532 for 266 chunks)
- Acceptable performance on modern hardware (no frame drops observed)

## References

- [Three.js LOD Documentation](https://threejs.org/docs/#api/en/objects/LOD) - Traditional geometry-based LOD (not used, but considered)
- [Graphology Force Layout](https://graphology.github.io/standard-library/layout-forceatlas2.html) - Force simulation algorithms
- [Level of Detail - Wikipedia](https://en.wikipedia.org/wiki/Level_of_detail_(computer_graphics)) - General LOD concepts
- [Smooth Interpolation in Graphics](https://en.wikipedia.org/wiki/Smoothstep) - Interpolation curves (inspiration for exponential choice)

## Related ADRs

- **ADR-008: Semantic Zoom** - Established zoom-based filtering for keyword clustering
- **ADR-009: Graph View Modularization** - Modular renderer architecture that chunk system builds upon
- **ADR-012: WebGL Memory Leak Fix** - Memory management patterns applied to chunk caching
