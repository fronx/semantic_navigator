# ADR 013: Leiden Clustering with Precomputation

## Status
Proposed

## Context

After implementing client-side clustering (ADR-010), two new problems emerged:

### Problem 1: Top-Down Clustering Bias

The current Louvain algorithm uses modularity-based community detection, which optimizes for dense connections between nodes. This creates a "top-down" bias where clusters form around high-connectivity hub nodes ("shoulder joints") rather than identifying peripheral/extremity topics ("hands/fingers").

**User impact:**
- Peripheral topics get absorbed into larger hub-centric clusters
- Graph extremities aren't recognized as distinct semantic regions
- Cluster labels describe connection points rather than specific subtopics

**Why Louvain has this bias:**
- Modularity optimization favors high-degree nodes as cluster centers
- Hub nodes naturally have high betweenness centrality and pull nearby nodes into their community
- No explicit mechanism for identifying or preserving peripheral clusters

### Problem 2: Excessive API Costs

Every zoom or filter change triggers:
1. Fresh Louvain clustering computation (~50-100ms)
2. Centroid-based cache lookup (0.85 similarity threshold)
3. Low cache hit rate due to slight cluster composition changes
4. Haiku API calls for new labels (~$0.01-0.05 per call)
5. "Near-match" refinement API calls (0.85-0.95 similarity)

**Cost analysis:**
- Each session: ~20-50 zoom/filter interactions
- Cache hit rate: ~30-40% (centroids shift with minor membership changes)
- API cost per session: $0.20-2.50
- Monthly cost (100 active users): $20-250

The current cache strategy (localStorage with semantic similarity matching) helps but doesn't eliminate the fundamental issue: we recompute clusters and regenerate labels for every significant interaction.

## Alternatives Considered

### Option A: Traditional Hierarchical Clustering
**Algorithm:** AGNES (AGglomerative NESting) with single-linkage
- ✅ True bottom-up approach (starts with individual nodes, merges similar ones)
- ✅ Single-linkage naturally creates elongated clusters toward extremities
- ❌ **O(n²) time complexity** - too slow for 500+ node graphs
- ❌ Requires computing full distance matrix

**Research:** Available via [ml-hclust](https://www.npmjs.com/package/ml-hclust) NPM package (actively maintained).

### Option B: HDBSCAN
**Algorithm:** Hierarchical Density-Based Spatial Clustering of Applications with Noise
- ✅ Explicitly identifies dense cores vs sparse periphery
- ✅ O(n log n) with kd-tree indexing
- ✅ Hierarchical by design (supports resolution-like parameter)
- ⚠️ JavaScript implementations less mature ([hdbscan-ts](https://www.npmjs.com/package/hdbscan-ts))
- ⚠️ "Noise" classification may not fit our use case (all keywords are valid)
- ⚠️ Requires tuning multiple parameters (min_cluster_size, min_samples)

### Option C: Structural Features + k-means
**Algorithm:** Betweenness/closeness centrality features with k-means++ clustering
- ✅ Explicit separation of hub vs peripheral nodes
- ✅ Fast (O(n log n) for centrality, O(n) for k-means)
- ❌ Requires choosing k (number of clusters) upfront
- ❌ k-means assumes spherical clusters (doesn't match graph topology)
- ❌ Two-stage process complicates resolution parameter mapping

### Option D: Google TeraHAC
**Algorithm:** Nearly-linear hierarchical agglomerative clustering for sparse graphs
- ✅ O(m + n) time complexity (nearly linear!)
- ✅ Published at SIGMOD 2024, presented at STOC 2026
- ✅ Scales to trillion-edge graphs
- ❌ **No production JavaScript implementation available**
- ❌ Cutting-edge research, would require custom implementation

**Research:** [Scaling HAC to Trillion-Edge Graphs](https://research.google/blog/scaling-hierarchical-agglomerative-clustering-to-trillion-edge-graphs/)

### Option E: Leiden Algorithm (Selected)
**Algorithm:** Improved Louvain with connected community guarantees
- ✅ **O(n log n) complexity** (same as Louvain)
- ✅ Guarantees connected communities (Louvain can produce fragments)
- ✅ Faster convergence than Louvain
- ✅ Already available in graphology ecosystem
- ✅ 2000+ citations, proven in production (Neo4j, Cytoscape)
- ⚠️ Still modularity-based (requires periphery detection as post-processing)

**Research:** [From Louvain to Leiden: guaranteeing well-connected communities](https://www.nature.com/articles/s41598-019-41695-z)

**Key improvements over Louvain:**
- Louvain can create up to 25% badly connected communities, 16% disconnected
- Leiden uses refined local moving + subset optimization to guarantee connectivity
- Empirically produces higher quality partitions at similar or better speed

## Decision

**Use Leiden algorithm with periphery detection + precomputed clusters at fixed resolutions.**

### Part 1: Leiden with Periphery Detection

Replace Louvain with Leiden, adding betweenness centrality-based post-processing to identify peripheral clusters.

**Algorithm:**
1. Run Leiden clustering on graph edges (O(n log n))
2. Compute betweenness centrality for all nodes (O(n log n))
3. Calculate average centrality per cluster
4. Mark clusters in bottom 25th percentile as "peripheral"

**Periphery detection rationale:**
- Betweenness centrality measures how often a node lies on shortest paths between others
- Hub nodes have high betweenness (many paths flow through them)
- Peripheral nodes have low betweenness (few paths pass through them)
- Clustering by centrality separates "shoulder joints" from "hands/fingers"

**Why this approach:**
- Leiden provides fast, connected base clustering
- Centrality computation is also O(n log n) (uses Brandes' algorithm)
- Post-processing is lightweight (~10-20% overhead)
- Preserves resolution parameter semantics from current system
- Clear separation of concerns: Leiden for structure, centrality for topology

### Part 2: Precomputation Infrastructure

Precompute clusters and labels at fixed resolutions, storing results in database.

**Precomputed resolutions:**
- 0.1, 0.3, 0.5, 1.0, 1.5, 2.0, 3.0, 4.0 (8 levels)
- Spans from very coarse (~10-15 clusters) to fine-grained (~50-80 clusters)
- Runtime: find nearest precomputed resolution within ±0.15

**Database schema:**
```sql
CREATE TABLE precomputed_topic_clusters (
  resolution real,
  node_id text,
  cluster_id integer,
  hub_node_id text,
  cluster_label text,
  member_count integer,
  is_peripheral boolean,
  created_at timestamptz,
  PRIMARY KEY (resolution, node_id)
);
```

**Precomputation process:**
1. Run `scripts/precompute-topic-clusters.ts` (one-time or when data changes)
2. Fetch full graph via `get_article_keyword_graph` RPC
3. For each resolution:
   - Run Leiden clustering
   - Compute periphery flags
   - Call Haiku API for semantic labels (batch)
   - Store results in database

**Runtime query:**
1. Client requests clusters for resolution R
2. API finds nearest precomputed resolution (e.g., 0.9 → 1.0)
3. Returns pre-labeled clusters from database
4. Zero Haiku API calls during normal usage

**Cost analysis:**
- Precomputation: 8 resolutions × ~30 clusters/resolution (avg) × $0.02/call = **~$5 one-time**
- Runtime: **$0 per session** (uses precomputed labels)
- Savings: **~99% reduction** in API costs

## Trade-offs

### Leiden + Periphery Detection
- ✅ O(n log n) - fast enough for interactive use
- ✅ Better quality than Louvain (connected communities)
- ✅ Explicit periphery identification via centrality
- ✅ Proven algorithm with production implementations
- ⚠️ Betweenness centrality adds ~10-20% compute overhead
- ⚠️ Periphery threshold (25th percentile) may need per-dataset tuning
- ⚠️ Still modularity-based (not as fundamentally different as pure hierarchical)

### Precomputation
- ✅ Eliminates runtime API costs (99% reduction)
- ✅ Instant cluster switching (no label generation delay)
- ✅ Consistent labels across sessions
- ✅ ~800KB total storage (100KB per resolution × 8 levels)
- ⚠️ Filtered views show partial clusters (not recomputed for specific filter)
- ⚠️ Requires re-running script when:
  - New articles imported
  - Embedding model changes
  - Graph topology parameters change (maxEdges, minSimilarity)
- ⚠️ Nearest-resolution matching means slight granularity loss
  - User adjusts slider to 0.9 → uses 1.0 precomputed clusters
  - Acceptable for 90% of use cases (could compute on-demand for precise values)

### Why Not O(m+n) Hierarchical?
While Google's TeraHAC achieves nearly-linear time, it:
- Has no production JavaScript implementation
- Would require significant engineering effort to port
- Offers marginal improvement over Leiden for our graph sizes (500-2000 nodes)
- O(n log n) is already fast enough for interactive use (~100ms for 1000 nodes)

**When to revisit:** If graph sizes exceed 5000+ nodes, consider implementing TeraHAC or exploring WebAssembly ports of optimized C++ implementations.

## Implementation Plan

### Files to Create
1. **`src/lib/leiden-clustering.ts`** - Leiden algorithm with periphery detection
2. **`supabase/migrations/XXX_precomputed_topic_clusters.sql`** - Database schema
3. **`scripts/precompute-topic-clusters.ts`** - Precomputation script
4. **`src/app/api/precomputed-clusters/route.ts`** - Query API for precomputed data

### Files to Modify
1. **`src/hooks/useClusterLabels.ts`** - Replace Louvain with Leiden, add precomputed data fetching
2. **`package.json`** - Add `graphology-metrics` for centrality computation

### Verification
1. **Clustering quality:** Verify peripheral clusters are labeled correctly (visual inspection)
2. **Performance:** Measure clustering time (should be <150ms for 1000 nodes)
3. **API cost:** Monitor Anthropic API dashboard (should see zero runtime calls)
4. **Cache hit rate:** Check precomputed query success rate (should be >95%)

## Consequences

### Positive
- **Better cluster quality:** Leiden guarantees connected communities
- **Extremity identification:** Peripheral clusters now distinguished from hubs
- **API cost reduction:** 99% reduction in Haiku API calls ($250/month → $6 one-time)
- **Faster interaction:** Instant cluster switching (no label generation delay)
- **Consistent UX:** Same labels across sessions for same graph state

### Negative
- **Precomputation overhead:** Must re-run script when data changes
- **Storage cost:** Additional ~600KB in database (negligible)
- **Granularity loss:** Resolution slider snaps to nearest precomputed level
- **Partial clusters in filters:** Filtered views show subset of precomputed clusters

### Neutral
- **Periphery threshold tuning:** 25th percentile may need adjustment per dataset
- **New dependency:** `graphology-metrics` for centrality computation

## References

- [From Louvain to Leiden: guaranteeing well-connected communities](https://www.nature.com/articles/s41598-019-41695-z) - Nature Scientific Reports, 2019
- [Leiden Algorithm - Wikipedia](https://en.wikipedia.org/wiki/Leiden_algorithm)
- [Scaling HAC to Trillion-Edge Graphs](https://research.google/blog/scaling-hierarchical-agglomerative-clustering-to-trillion-edge-graphs/) - Google Research, 2024
- [Hierarchical Agglomerative Clustering in Nearly-Linear Time (PDF)](http://proceedings.mlr.press/v139/dhulipala21a/dhulipala21a.pdf) - ICML 2021
- [Node clustering based on structural similarity](https://www.sciencedirect.com/science/article/abs/pii/S0378437124007842) - Physica A, 2024
- [HDBSCAN - scikit-learn](https://scikit-learn.org/stable/modules/generated/sklearn.cluster.HDBSCAN.html)
- [ml-hclust NPM Package](https://www.npmjs.com/package/ml-hclust)
- [hdbscan-ts NPM Package](https://www.npmjs.com/package/hdbscan-ts)

## Related ADRs

- **ADR-010: Client-Side Clustering** - Established need for clustering on rendered graph
- **ADR-008: Semantic Zoom** - Zoom-based filtering that benefits from fast clustering
- **ADR-011: Semantic Cluster Coloring** - Visual design for cluster colors/hulls
