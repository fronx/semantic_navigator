# ADR 011: Semantic Cluster Coloring via Embedding-to-Color Mapping

## Status
Implemented

## Context

The Topics view uses client-side Louvain clustering (ADR 010), but cluster colors were assigned via D3's `schemeTableau10` using sequential cluster IDs. This caused two problems:

1. **Color shuffling**: When zoom or resolution changes, Louvain produces new cluster IDs (0, 1, 2...). Colors assigned by ID would shuffle unpredictably.

2. **No semantic meaning**: Unrelated topics could share similar colors while related topics got contrasting colors, purely by accident of ID assignment.

### Desired Properties

- **Stability**: Same topic cluster gets same color across zoom levels and sessions
- **Semantic gradient**: Similar topics get similar hues (clusters near each other in embedding space)
- **Hierarchical inheritance**: When a cluster splits, child clusters inherit colors related to the parent

## Decision

Map keyword embeddings to colors using PCA projection to 2D, then polar coordinates to HSL. Cluster colors derive from centroid embeddings, so similar clusters get similar colors naturally.

### Color Pipeline

```
Keyword embeddings (256-dim)
  → PCA projection (2-dim)
  → Polar coordinates
      angle → hue (0-360°)
      radius → saturation (50-100%)
      fixed lightness (45%)
  → HSL color
```

**Input data**: Only keyword `embedding_256` vectors from the `keywords` table. Article/chunk content embeddings (1536-dim, in the `nodes` table) are not used — different dimensionality and purpose.

**PCA computation**: Uses `ml-pca` library (SVD-based) for numerical stability. The transform is a 2×256 matrix stored as static JSON.

### Node Coloring Strategy

Two approaches blended via `colorMixRatio` slider (0-100%):

**Cluster-first (mixRatio=0):**
- Compute cluster centroid from member embeddings
- Base color from centroid's polar position
- Node variations: small hue shift (±15°) based on offset direction, saturation/lightness adjustments based on distance from centroid

**Node-first (mixRatio=100%):**
- Each node colored by its own embedding projection
- Maximum color variation, less cluster coherence

Default is 30% mix, balancing cluster identity with individual variation.

### Neighbor-Averaged Coloring

An alternative coloring mode (`computeNeighborAveragedColors`) averages each node's PCA position with its graph neighbors before mapping to color. This creates local color coherence without depending on cluster assignments.

### Desaturation

All color functions support a `desaturation` parameter (0-1) that reduces chroma in LCH color space while preserving perceptual lightness. Used for dimming non-highlighted nodes during hover/filter interactions.

## Implementation

### Files

| File | Purpose |
|------|---------|
| `src/lib/embedding-pca.ts` | PCA computation library (fetches embeddings, computes transform) |
| `src/lib/semantic-colors.ts` | Color mapping functions (PCA projection → polar → HSL) |
| `public/data/embedding-pca-transform.json` | Pre-computed 2×256 transformation matrix |
| `scripts/maintenance/compute-embedding-pca.ts` | Standalone maintenance script (uses library) |

PCA is also computed automatically as Step 11 of the REPL ingestion script (`scripts/repl-explore-chunking.ts`).

### Key Functions

**`embedding-pca.ts`:**
- `computeEmbeddingPCA(supabase?)` - Fetch all keyword embeddings and compute PCA transform
- `fetchAllKeywordEmbeddings(supabase?)` - Paginated fetch of `embedding_256` from keywords table

**`semantic-colors.ts`:**
- `loadPCATransform()` - Load pre-computed transform from static JSON (cached)
- `pcaProject(embedding, transform)` - Project embedding to 2D
- `coordinatesToHSL(x, y, desaturation?)` - Polar mapping to HSL color
- `centroidToColor(embeddings, transform)` - Cluster color from member embedding centroid
- `computeClusterColorInfo(embeddings, transform)` - Base HSL + PCA centroid for a cluster
- `nodeColorFromCluster(embedding, clusterInfo, transform, mixRatio, desaturation?)` - Blended node color (cluster base + individual variation)
- `computeClusterColors(communitiesMap, pcaTransform)` - Batch compute ClusterColorInfo for all communities
- `computeNeighborAveragedColors(nodes, edges, transform)` - Graph-neighbor-averaged coloring
- `clusterColorToCSS(info, desaturation?, contrast?, isDark?)` - Convert ClusterColorInfo to CSS string with optional contrast adjustment

**Consumers** (pass `pcaTransform` through):
- `src/components/TopicsView.tsx` - Loads PCA transform, passes to renderers
- `src/lib/map-renderer.ts` - D3/SVG node and edge coloring
- `src/components/topics-r3f/KeywordNodes.tsx` - R3F instanced node coloring
- `src/lib/rendering-utils/hull-renderer.ts` - Hull coloring from cluster centroids
- `src/lib/edge-colors.ts` - Edge coloring derived from source/target node colors

## Consequences

### Benefits

- **Stable colors**: Same topic always gets the same hue region
- **Semantic meaning**: Color similarity reflects semantic similarity
- **Smooth zoom**: When clusters split/merge, child colors stay in parent's hue family
- **Tunable**: Users can adjust cluster vs individual coloring via slider

### Trade-offs

- **PCA must be recomputed** when keyword embeddings change (runs automatically in ingestion pipeline, ~2s)
- **Extra file load**: PCA transform JSON loaded on mount (~5KB)
- **Color variation limited**: At low mix ratios, nodes within a cluster look similar (by design)

### Why Pre-computed PCA

Runtime PCA would give unstable axes across sessions. Pre-computing ensures:
- Same embedding always maps to same color
- Axes are consistent across page loads
- No computation delay on mount

## Future Possibilities

1. **3D PCA for lightness**: Use third component for lightness variation
2. **Perceptually uniform colorspace**: Switch from HSL to OKLCH for better perceptual uniformity
3. **Cross-view consistency**: Apply same coloring to Map view's keyword communities
