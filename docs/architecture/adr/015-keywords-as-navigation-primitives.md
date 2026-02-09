# ADR 015: Keywords as Navigation Primitives

## Status
Implemented

## Context

During ingestion, every content node (article or chunk) gets assigned multiple keywords extracted by the LLM. Each keyword represents a semantic concept present in that content. However, not all keywords are equally useful for graph navigation.

### The Problem

Without filtering, the graph would display:
1. **Unique keywords** that only appear in one piece of content
2. **Decorative keywords** that describe a single node but don't help you navigate to related content
3. **Annotation-style keywords** that provide useful metadata for search, but don't form meaningful connections in the graph

This creates visual clutter and obscures the actual semantic structure of the knowledge base.

### Design Philosophy

**Keywords serve two different purposes:**

1. **Navigation:** Help users traverse from one piece of content to related content by following semantic connections
2. **Annotation:** Provide metadata tags that describe individual content for search/filtering

These purposes have different display requirements:
- **Navigation keywords** should be rendered as graph nodes with visible connections
- **Annotation keywords** should appear as local metadata when viewing individual content

The graph view should prioritize navigation over annotation.

## Decision

**Keywords displayed in TopicsView and MapView are filtered to show only those that facilitate navigation between content nodes.**

### Implementation

The filtering is implemented in the SQL function `get_keyword_graph()` ([migration 20260209111620](../../../supabase/migrations/20260209111620_update_keyword_graph_for_canonical_keywords.sql)):

```sql
-- For each keyword in node A, find top-K similar keywords from DIFFERENT nodes
cross join lateral (
  select k2.id, k2.keyword, ko2.node_id, ...
  from keywords k2
  join keyword_occurrences ko2 on ko2.keyword_id = k2.id
  where ko2.node_type = filter_node_type
    and ko2.node_id != fk.node_id  -- Cross-node constraint
  order by fk.embedding <=> k2.embedding
  limit max_edges_per_node
) neighbors
```

**Key constraint:** `ko2.node_id != fk.node_id`

This ensures that:
- Keywords only appear if they connect to keywords from **other** content nodes
- A keyword can appear even if it only exists in ONE node, as long as it's semantically similar to keywords from OTHER nodes
- The result is a connected graph where keywords act as semantic bridges

### Graph Structure

```
Content A ──→ "machine learning" ←──┐
                                    │ similarity edge (0.87)
Content B ──→ "neural networks"   ←─┘
                                    ↓ similarity edge (0.82)
              "deep learning"     ←── Content C
```

Each keyword gets connected to its K-nearest semantic neighbors (via `nearestNeighbors` parameter, default K=1) to ensure graph connectivity.

### What Gets Filtered Out

Keywords that don't facilitate navigation:
- Unique keywords with no semantic connections to other content
- Overly specific keywords that only describe one piece of content
- Keywords that would create isolated subgraphs

**Important:** These filtered keywords are NOT deleted - they remain in the database and are still used for search. They're simply not rendered as graph nodes.

## Consequences

### Benefits

1. **Cleaner graph topology:** Only shows keywords that help you discover related content
2. **Semantic bridges:** Keywords act as meaningful connectors between content
3. **Scalability:** Reduces visual clutter as the knowledge base grows
4. **Navigation-focused UX:** Graph view optimized for exploration, not exhaustive metadata display

### Trade-offs

1. **Hidden metadata:** Some keywords attached to content aren't visible in the graph
2. **Incomplete local context:** Viewing a single node in isolation won't show all its keywords
3. **Search vs graph divergence:** Search results may use keywords not visible in the graph

### Future Extensions

**Local annotation display:** When rendering individual content nodes (e.g., in expanded view, detail panel, or zoomed-in LOD), we can show ALL keywords including non-navigational ones. These would render as:
- Local tags/chips attached to the content card
- Not connected to other graph nodes
- Visually distinct from navigation keywords

This gives users both:
- **Graph mode:** Navigation-focused keywords for exploration
- **Detail mode:** Complete keyword metadata for understanding individual content

## References

- SQL implementation: [migration 20260209111620](../../../supabase/migrations/20260209111620_update_keyword_graph_for_canonical_keywords.sql)
- API endpoint: [`/api/topics`](../../../src/app/api/topics/route.ts)
- Query function: [`getKeywordBackbone()`](../../../src/lib/graph-queries.ts)
