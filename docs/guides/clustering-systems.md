# Clustering Systems Guide

This guide explains the two clustering systems in Semantic Navigator, which views use them, and how to inspect and maintain them.

## Overview

Semantic Navigator has **two different clustering systems** that serve different views:

| System | View | Table | Algorithm | Granularity | Script |
|--------|------|-------|-----------|-------------|--------|
| **Keyword Communities** | MapView | `keyword_communities` | Louvain | 8 levels (0-7) | `compute-keyword-communities.ts` |
| **Topic Clusters** | TopicsView | `precomputed_topic_clusters` | Leiden | 8 resolutions (0.1-4.0) | `precompute-topic-clusters.ts` |

## Why Two Systems?

**MapView** (older, still in use):
- Article-keyword bipartite graph visualization
- Uses **hierarchical levels** (0=coarsest, 7=finest) from Louvain algorithm
- Colors and collapses nodes based on community membership
- Stored in `keyword_communities` table with `level` parameter

**TopicsView** (primary, active development):
- Pure keyword graph with 3D clustering
- Uses **continuous resolution** parameter (0.1-4.0) for Leiden algorithm
- Can fall back to client-side clustering if precomputed data unavailable
- Stored in `precomputed_topic_clusters` table with `resolution` parameter
- See [ADR-013](../architecture/adr/013-leiden-clustering-precomputation.md) for rationale

## Granularity Modes in TopicsView

TopicsView supports **dual granularity modes** that switch between article-level and chunk-level keyword graphs:

**Article Mode** (default):
- Displays keywords extracted from full articles
- LOD nodes show article content (title + summary)
- Typical: 400-600 keywords with broader semantic coverage

**Chunk Mode**:
- Displays keywords extracted from paragraph chunks
- LOD nodes show chunk content (individual paragraphs)
- Typical: 2000-3000 keywords with finer semantic granularity

**UI Control**: Toggle located in top bar (right side), labeled "Articles | Chunks"

**Implementation**: Single `nodeType` parameter flows through the stack:
1. UI toggle → `useTopicsSettings` (persisted in localStorage)
2. Page → `/api/topics?nodeType=article|chunk`
3. API → `get_keyword_graph(filter_node_type)` RPC
4. Precomputed clusters filtered by `node_type` column
5. LOD nodes loaded via `/api/topics/chunks` with matching `nodeType`

**Cache Behavior**: Switching modes clears the LOD node cache to prevent showing wrong content (articles vs chunks).

**Symmetric Design**: LOD nodes match keyword granularity:
- Article mode: article keywords + article nodes behind glass
- Chunk mode: chunk keywords + chunk nodes behind glass

## Terminology: communityId vs clusterId

**Both terms refer to the same thing** - the ID assigned to a group of semantically related keywords.

- **"Community"** comes from graph theory (community detection algorithms like Leiden/Louvain)
- **"Cluster"** is common developer terminology

In the codebase:
- Graph theory contexts use "community" (e.g., `keyword_communities` table, MapView)
- Leiden algorithm contexts use "cluster" (e.g., `useClusterLabels` hook, TopicsView)
- Node properties currently use `communityId` but should be `clusterId` for consistency

This is **naming inconsistency**, not a semantic distinction. Future work should standardize on "cluster" terminology.

## Database Tables

### keyword_communities (MapView)

```sql
CREATE TABLE keyword_communities (
  keyword_id uuid REFERENCES keywords(id),
  level int,                    -- Hierarchy level 0-7
  community_id int,             -- Community ID at this level
  is_hub boolean,               -- True for the hub keyword
  PRIMARY KEY (keyword_id, level)
);
```

**Populated by**: `scripts/compute-keyword-communities.ts`

**Used by**:
- `/api/map/route.ts` - Functions `addCommunityColors()` and `collapseCommunitiesToHubs()`
- MapView for node coloring and community collapse

### precomputed_topic_clusters (TopicsView)

```sql
CREATE TABLE precomputed_topic_clusters (
  node_id text,                 -- Keyword node ID (e.g., "kw:machine learning")
  resolution float,             -- Leiden resolution parameter
  node_type text,              -- 'article' or 'chunk' (supports dual granularity)
  cluster_id int,              -- Cluster ID at this resolution
  hub_node_id text,            -- Hub keyword for this cluster
  cluster_label text,          -- LLM-generated semantic label
  member_count int,            -- Size of cluster
  PRIMARY KEY (node_id, resolution, node_type)
);
```

**Populated by**: `scripts/precompute-topic-clusters.ts`

**Used by**:
- `/api/precomputed-clusters/route.ts` - Calls `get_precomputed_clusters` RPC function
- `useClusterLabels` hook in TopicsView (with client-side fallback)

## Scripts

### Inspecting Current State

```bash
npm run script scripts/inspect-keyword-communities.ts
```

Shows statistics for **both** tables:
- keyword_communities: Level-by-level breakdown
- precomputed_topic_clusters: Resolution-by-resolution breakdown

Example output:
```
================================================================================
KEYWORD COMMUNITIES (used by MapView)
================================================================================
Level | Communities | Keywords | Avg Size | Hubs
------|-------------|----------|----------|-----
    0 |          22 |      892 |     40.5 |   22
    1 |          45 |      892 |     19.8 |   45
    2 |          89 |      892 |     10.0 |   89
    ...

================================================================================
PRECOMPUTED TOPIC CLUSTERS (used by TopicsView)
================================================================================
Node Type | Resolution | Clusters | Nodes | Avg Size | Example Labels
----------|------------|----------|-------|----------|---------------
  article |        0.1 |       10 |   489 |     48.9 | systems and dynamics, consciousness embodiment
  article |        0.3 |       14 |   489 |     34.9 | systems and design, culture and nature
  article |        1.0 |       28 |   489 |     17.5 | neural networks, reinforcement learning
    chunk |        0.1 |       15 |   521 |     34.7 | deep learning, neural architectures
    chunk |        0.3 |       22 |   521 |     23.7 | machine learning, gradient descent
       ...
```

### Regenerating Clusters

**For MapView** (keyword_communities):
```bash
npm run script scripts/compute-keyword-communities.ts
```

Requirements:
- `keyword_similarities` table must be populated (run similarity backfill first if empty)
- Runs Louvain at 8 resolution levels
- Takes ~30 seconds for 1000 keywords

**For TopicsView** (precomputed_topic_clusters):
```bash
npm run script scripts/precompute-topic-clusters.ts
```

Requirements:
- Keywords table with both article-level and chunk-level keywords
- Anthropic API key for semantic label generation
- Takes ~10-20 minutes (processes both node types, includes LLM calls for labels)

## Data Flow

### MapView Flow

```
User opens MapView
  ↓
GET /api/map
  ↓
Query keyword_communities table (level parameter from zoom)
  ↓
addCommunityColors() assigns communityId to nodes
  ↓
Optional: collapseCommunitiesToHubs() collapses to hub keywords
  ↓
D3 force simulation with colored communities
```

### TopicsView Flow

```
User opens TopicsView
  ↓
GET /api/topics (keyword graph data)
  ↓
useClusterLabels(nodes, edges, resolution)
  ↓
Try: GET /api/precomputed-clusters (calls get_precomputed_clusters RPC)
  ↓
If fails: computeLeidenClustering() runs client-side
  ↓
Semantic labels from Haiku API (with localStorage caching)
  ↓
R3F renderer displays clusters with convex hulls and labels
```

See [Cluster Labels](../cluster-labels.md) for detailed TopicsView clustering documentation.

## Common Issues

### "No data in keyword_communities table"

**Cause**: Script hasn't been run yet, or table was cleared.

**Fix**:
```bash
npm run script scripts/compute-keyword-communities.ts
```

### "Using client-side clustering" in TopicsView

**Cause**: `precomputed_topic_clusters` table is empty or doesn't cover the requested resolution.

**Fix**:
```bash
npm run script scripts/precompute-topic-clusters.ts
```

**Note**: Client-side fallback is working as intended - you'll just pay for more Haiku API calls for labels.

### Stale cluster labels after reimport

**Cause**: Precomputed clusters were generated before articles were reimported with new keywords.

**Fix**: Regenerate clusters:
```bash
npm run script scripts/precompute-topic-clusters.ts  # For TopicsView
npm run script scripts/compute-keyword-communities.ts  # For MapView
```

### MapView shows all nodes in one community

**Cause**: Only level 0 was computed (single community containing everything).

**Fix**: Regenerate with script above - should produce 8 levels with increasing granularity.

### Wrong content showing after switching granularity modes

**Cause**: Browser cache may retain LOD nodes from previous mode (articles when in chunk mode, or vice versa).

**Fix**: The app automatically clears the LOD node cache when switching modes. If stale content persists, refresh the page.

**Prevention**: Cache is automatically invalidated in `useChunkLoading` hook when `nodeType` changes.

## Implementation Notes

### Resolution vs Level

- **Level** (MapView): Discrete hierarchy levels 0-7, like zoom levels
- **Resolution** (TopicsView): Continuous parameter (0.1, 0.3, 0.5, 1.0, 1.5, 2.0, 3.0, 4.0) passed to Leiden

Both control the same thing: cluster granularity (higher = more, smaller clusters).

### Why Leiden vs Louvain?

Leiden algorithm (used in TopicsView) has better peripheral cluster detection via betweenness centrality. See [ADR-013](../architecture/adr/013-leiden-clustering-precomputation.md) for details.

MapView still uses Louvain for historical reasons - migration to Leiden not yet needed.

### Client-Side Clustering in TopicsView

TopicsView can compute clusters in the browser as a fallback. This ensures:
- No hard dependency on precomputed data
- Clusters match the actual rendered graph topology
- Works even if RPC function is missing

Performance: ~50-100ms for 1000 nodes, 5000 edges.

## Related Documentation

- [Cluster Labels](../cluster-labels.md) - Deep dive into TopicsView clustering and semantic label generation
- [ADR-010: Client-Side Clustering](../architecture/adr/010-client-side-clustering.md) - Why clustering moved to client
- [ADR-013: Leiden Clustering with Precomputation](../architecture/adr/013-leiden-clustering-precomputation.md) - Leiden algorithm choice and precomputation strategy
- [Semantic Zoom](../architecture/adr/008-semantic-zoom.md) - Using community hierarchy for zoom-based filtering
