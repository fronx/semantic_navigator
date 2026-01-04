# Graph Layout Lab

Experiments and investigations for UMAP and force-directed graph layouts.

## Problem Statement

UMAP layout was placing keywords near the center and articles at the periphery - the opposite of what we want for semantic navigation.

## Key Finding: Repulsion Strength Controls Centrality

After extensive testing, we found that **repulsion strength** is the main lever for controlling which node types end up at the center vs periphery:

| Repulsion | Mean Ratio | Status |
|-----------|------------|--------|
| 1-30 | 0.69-0.81 | Keywords at periphery |
| **50-100** | **0.89-1.03** | **BALANCED** |
| 150-200 | 1.15-1.17 | Articles at periphery |

**Best configuration**: `repulsionStrength=100` produces a ratio of 1.03 (nearly perfect balance).

### Charts

- [Spread Trajectory](charts/spread-trajectory.svg) - Layout spread over epochs by repulsion strength
- [Ratio Trajectory](charts/ratio-trajectory.svg) - Centrality ratio evolution over epochs
- [Final Ratio Bar Chart](charts/final-ratio-bar.svg) - Final centrality ratios by repulsion

### URL Parameters for Testing

Add to any map URL:
- `?layout=umap&repulsion=100` - balanced layout
- `?layout=umap&repulsion=5` - keywords at periphery
- `?layout=umap&repulsion=200` - articles at periphery (default behavior)

Example: `http://localhost:3000/map?layout=umap&level=7&density=6&repulsion=100`

---

## Investigations

### 1. Root Cause Analysis (2025-01-04)

**Finding**: Article-keyword edges had ZERO variance in distance values.

The issue was in `buildKnnFromEdges()` in `map-layout.ts`:
```typescript
const rawDist = edge.similarity !== undefined ? 1 - edge.similarity : 0.5;
```

Article-keyword edges had no similarity scores, so they all defaulted to 0.5 (distance 0.7071 after sqrt transform). This meant UMAP couldn't differentiate between article-keyword connections.

**Fix**: Added article-keyword similarity computation in `/api/map/route.ts`:
- Fetch article summary embeddings (1536-dim, truncated to 256-dim)
- Compute cosine similarity between article embedding and keyword embedding
- Pass similarity scores on article-keyword edges

**Result**: Article-keyword distances now range 0.55-0.97 (was all 0.7071).

### 2. Force Balance Investigation (2025-01-04)

**Problem**: Layout keeps expanding throughout optimization - nodes drift outward.

**Root cause**: `repulsionStrength` defaults to `spread` value (200), but attraction uses `edge.weight` (0.5-1.0). Repulsion is ~200x stronger.

**Added tunable parameters**:
- `attractionStrength` - multiplier for attractive force (default: 1.0)
- `repulsionStrength` - multiplier for repulsive force (default: spread value)
- `minAttractiveScale` - scale for minimum attractive distance exclusion zone

### 3. Repulsion Sweep (2025-01-04)

Systematically tested repulsion values from 1-200. Key findings:

1. **All configurations converge** - spread stabilizes, no runaway expansion
2. **Repulsion controls centrality ratio** - lower repulsion pushes keywords to periphery, higher pushes articles
3. **Sweet spot at repulsion=75-100** - produces balanced layouts with ratio ~0.97-1.03

### 4. UMAP Implementation Comparison (2025-01-04)

Compared our umapper library against standard UMAP (umap-learn, umap-js):

**Key differences from standard UMAP**:

| Feature | Standard UMAP | Our umapper |
|---------|---------------|-------------|
| Spectral init | Yes | No (random) |
| Negative sampling | Weighted by (1 - v_ij) | Uniform random |
| Asymmetric repulsion | Yes | No |
| minAttractiveDistance | No | Yes (custom) |
| Learning rate | Linear decay | Front-loaded |

**Notable custom features**:
1. **minAttractiveDistance**: Prevents visual node pile-up. With `minDist=20` and `scale=50`, creates 1003px exclusion zone where attraction is attenuated. This is NOT standard UMAP.
2. **Front-loaded learning rate**: Keeps high alpha for first 20% of epochs for visible early movement in interactive visualization.
3. **Uniform negative sampling**: Standard UMAP weights by input dissimilarity; we sample uniformly.

**Recommendations from comparison**:
- Consider weighted negative sampling for better structure preservation
- Document minAttractiveDistance as pragmatic addition
- Current approach works well for interactive visualization use case

---

## Remaining Issues (2025-01-04)

After setting `repulsionStrength=100` as default, two visual problems remain:

1. **Center crowding**: Keywords cluster tightly in the center, making labels unreadable. This is because keywords have higher degree (each connects to multiple articles), pulling them together.

2. **No color colocation**: Nodes of the same community (color) are not spatially grouped. The layout doesn't preserve semantic clusters visually.

These suggest the current UMAP configuration optimizes for article/keyword balance but not for:
- Minimum spacing between nodes
- Community/cluster preservation

**Potential next steps**:
- Increase `minDist` parameter (currently 20) to force more spacing
- Reduce `minAttractiveScale` to allow tighter attraction while repulsion spreads things
- Add degree-weighted repulsion (high-degree keywords get more repulsion)
- Investigate why community structure isn't preserved (edge weights? initialization?)

---

## Scripts

Run with: `npm run script lab/graph-layout/<script>.ts`

| Script | Purpose |
|--------|---------|
| `test-repulsion-sweep.ts` | Sweep repulsion values, generate trajectory charts |
| `test-centrality-sweep.ts` | Quick config comparison for centrality ratio |
| `test-force-balance.ts` | Trajectory test for convergence |
| `analyze-edge-distances.ts` | Edge distance distribution by type |
| `analyze-umap-centrality.ts` | UMAP centrality with attraction sweep |

## Key Metrics

- **Mean ratio (articles/keywords)**: Distance from centroid ratio. Goal is ~1.0.
  - `> 1.15`: Articles at periphery (default behavior)
  - `< 0.85`: Keywords at periphery
  - `0.85 - 1.15`: Balanced (good!)

## Files Modified

- `node_modules/umapper/src/types.ts` - Added tunable parameters
- `node_modules/umapper/src/layout/forces.ts` - Apply multipliers, expose minAttractiveScale
- `node_modules/umapper/src/layout/sgd-layout.ts` - Pass parameters through
- `src/lib/map-layout.ts` - Expose parameters in layout functions
- `src/components/MapView.tsx` - URL parameter parsing
- `src/app/api/map/route.ts` - Compute article-keyword similarity scores
