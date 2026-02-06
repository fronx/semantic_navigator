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
Embeddings (256-dim) → PCA (2-dim) → Polar coords → HSL color
                                      angle → hue (0-360)
                                      radius → saturation (50-100%)
                                      fixed lightness (45%)
```

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

## Implementation

### New Files

| File | Purpose |
|------|---------|
| `scripts/maintenance/compute-embedding-pca.ts` | One-time PCA computation script |
| `public/data/embedding-pca-transform.json` | 2×256 transformation matrix |
| `src/lib/semantic-colors.ts` | Color mapping functions |

### Modified Files

| File | Changes |
|------|---------|
| `src/lib/hull-renderer.ts` | Use centroid-based colors for hulls |
| `src/lib/map-renderer.ts` | Cluster-based node coloring with mix ratio |
| `src/components/TopicsView.tsx` | Load PCA transform, pass to renderer |
| `src/app/topics/page.tsx` | Add "Color mix" slider |

### Key Functions

**`semantic-colors.ts`:**
- `pcaProject(embedding, transform)` - Apply PCA transform to get 2D coords
- `coordinatesToHSL(x, y)` - Polar mapping to HSL
- `centroidToColor(embeddings, transform)` - Cluster color from member embeddings
- `computeClusterColorInfo(embeddings, transform)` - Base HSL + PCA centroid
- `nodeColorFromCluster(embedding, clusterInfo, transform, mixRatio)` - Blended node color

**`map-renderer.ts`:**
- `computeClusterColors()` - Precompute ClusterColorInfo for all communities
- `getNodeColor()` - Uses cluster info + mix ratio for keyword coloring
- `updateVisuals()` - Updates colors instantly when slider moves

## Consequences

### Benefits

- **Stable colors**: Same topic always gets the same hue region
- **Semantic meaning**: Color similarity reflects semantic similarity
- **Smooth zoom**: When clusters split/merge, child colors stay in parent's hue family
- **Tunable**: Users can adjust cluster vs individual coloring via slider

### Trade-offs

- **PCA computation**: One-time script run when embeddings change (~2s for ~1800 keywords)
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
