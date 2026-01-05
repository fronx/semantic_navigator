# ADR 009: Graph View Modularization

## Status
In Progress

## Context

The MapView component (~700 lines) has grown into a "combinatorial machine" that mixes data fetching, layout computation, rendering, and UI controls. This makes it hard to create alternative graph visualizations without duplicating significant logic.

We want to enable specialized graph views (like a keyword-only "Topics" view) by extracting reusable primitives. The goal is a library of composable pieces that can assemble different graph visualizations with minimal custom code.

### Current Architecture

```
MapView.tsx (monolithic)
├── Data fetching (/api/map)
├── URL parameter sync (~25 useState calls)
├── Layout orchestration (force/UMAP)
├── D3 rendering (via map-renderer.ts)
├── Semantic zoom integration
├── Node expansion logic
└── MapSidebar (complex settings UI)
```

### Target Architecture

```
Reusable Primitives
├── src/lib/graph-queries.ts      → Database queries for graph data
├── src/lib/map-layout.ts         → Layout algorithms (existing)
├── src/lib/map-renderer.ts       → D3 rendering (existing)
└── src/hooks/useSemanticZoom.ts  → Semantic filtering (existing)

Specialized Views
├── /map    → Full article-keyword bipartite graph
├── /topics → Keyword backbone (keywords only, articles hidden)
└── /...    → Future views
```

## The Topics View

### Concept

The Topics view shows the **keyword backbone** - keywords as nodes, connected by cross-article semantic similarity. Articles/chunks are invisible but inform the connections.

```
Standard MapView:    Article A ─── keyword1 ═══ keyword2 ─── Article B
                                        (similarity)

Topics View:         keyword1 ════════════════════════════ keyword2
                     (articles hidden, connection preserved)
```

### Key Insight

Keywords that only appear within a single article are **not connectors** - they don't bridge content. The Topics view only shows keywords that create cross-article connections.

This is exactly what `get_article_keyword_graph` already computes:
- It finds keyword pairs across different articles with semantic similarity
- Each edge represents a bridge: Article A's keyword similar to Article B's keyword

### Data Flow

1. **Fetch**: Call existing `get_article_keyword_graph` RPC
2. **Project**: Extract only keyword nodes and keyword↔keyword edges (drop articles)
3. **Layout**: Use existing force/UMAP algorithms
4. **Render**: Use existing map-renderer with keyword nodes only
5. **Expand**: Double-click keyword → show connected articles inline

### Node Type Flexibility

The projection can work at different granularities:
- `node_type = 'article'` → Keywords bridging articles (coarser, fewer nodes)
- `node_type = 'chunk'` → Keywords bridging chunks (finer, more nodes)
- Both → Maximum connectivity

## Implementation

### Files

**New:**
- `src/lib/graph-queries.ts` - Reusable query functions
- `src/app/api/topics/route.ts` - API endpoint
- `src/app/topics/page.tsx` - Page component

**Reused (no changes needed):**
- `src/lib/map-layout.ts` - Layout algorithms
- `src/lib/map-renderer.ts` - D3 rendering
- `src/lib/hull-renderer.ts` - Community hulls

### graph-queries.ts

Core function:

```typescript
export async function getKeywordBackbone(
  supabase: SupabaseClient,
  options: {
    maxEdgesPerArticle?: number;
    minSimilarity?: number;
    communityLevel?: number;
  }
): Promise<{ nodes: KeywordNode[]; edges: SimilarityEdge[] }>
```

This:
1. Calls `get_article_keyword_graph` (existing RPC)
2. Projects result to keywords only
3. Adds community IDs for coloring

### Interaction: Expand to Articles

Double-clicking a keyword shows its connected articles:

```typescript
export async function getArticlesForKeyword(
  supabase: SupabaseClient,
  keyword: string
): Promise<Array<{ id: string; label: string; size: number }>>
```

The expanded articles appear as new nodes connected to the keyword.

## Design Principles

1. **Reuse over reinvent** - The keyword similarity data already exists; just project it differently
2. **Server-side projection** - Transform data in SQL/server, not client
3. **Minimal UI** - No sidebar for Topics view; controls only if needed
4. **Composition** - Small functions that compose into different views

## Future Possibilities

With these primitives, we could build:
- **Cluster view**: Just community hulls, no individual nodes
- **Timeline view**: Articles on a time axis, keyword connections across time
- **Diff view**: Compare two search queries' neighborhoods
- **Chunk explorer**: Expand articles to see internal chunk structure

## Notes

The key insight is that cross-article keyword connections already exist in the `get_article_keyword_graph` RPC. No new SQL function is needed - we just project the existing data to show only keywords.
