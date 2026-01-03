# Filtered Map View

**Date**: 2024-12-29

## Overview

The filtered map view allows users to explore articles through a specific conceptual lens by searching for a term and filtering out keywords that are semantically similar to that term.

## The Problem

When exploring a knowledge base, you often want to answer questions like: "What do my notes about **abstraction** have in common with each other, *besides* abstraction itself?"

A standard search shows you articles that match your query. But the Map view does something different: it shows you the *other* concepts that co-occur with your query term, revealing hidden connections between articles.

## How It Works

### 1. Query Matching
When you search for a term (e.g., "abstraction"):
- The system generates an embedding for your query
- Articles are matched based on whether any of their keywords have similarity >= threshold to your query
- These matching keywords are called "context" keywords

### 2. Synonym Filtering
Keywords that are too similar to your query (above the threshold) are filtered out:
- "abstraction" itself would be filtered
- "abstract thinking", "abstractions" might also be filtered
- The threshold slider controls how aggressive this filtering is

### 3. Revealing Structure
What remains are the *other* keywords from matching articles:
- If Article A about abstraction also discusses "interfaces" and "encapsulation"
- And Article B about abstraction also discusses "encapsulation" and "modularity"
- The map shows these articles clustered through "encapsulation" (their common non-query keyword)

## UI Components

### Threshold Slider
- **Lower threshold (e.g., 0.70)**: More aggressive filtering, removes more synonym-like keywords
- **Higher threshold (e.g., 0.90)**: Less aggressive, keeps keywords that are somewhat related to query

### Resolution Slider
Controls the community detection granularity (0-7):
- **Lower values (e.g., 0-2)**: Coarser clustering, fewer communities with more keywords each
- **Higher values (e.g., 5-7)**: Finer clustering, more communities with fewer keywords each

The resolution level is preserved when navigating between filtered views and when clearing the filter.

### Context Display
The "Context:" label shows which keywords were filtered out as synonyms of your query. This helps users understand what concepts are being "factored out" of the view.

### Cluster Visualization
Keywords are colored by their community assignment at the current resolution level. Convex hulls are drawn around communities with 3+ visible members, with the hub keyword label shown at the centroid.

## Technical Implementation

### Data Flow

```
User enters query
    ↓
Generate query embedding (1536-dim → truncate to 256-dim)
    ↓
Find articles with any keyword >= threshold similarity
    ↓
From those articles, get keywords < threshold similarity
    ↓
Build graph of articles → remaining keywords
    ↓
Add keyword↔keyword similarity edges for clustering
    ↓
Add community colors at specified resolution level
```

### Key Files

- [/api/map/route.ts](../../src/app/api/map/route.ts) - API endpoint with `getFilteredMap()` and `getFallbackFilteredMap()`
- [migrations/012_filtered_map_exclude_synonyms.sql](../../supabase/migrations/012_filtered_map_exclude_synonyms.sql) - RPC function for efficient filtering
- [MapView.tsx](../../src/components/MapView.tsx) - React component with threshold slider

### Two Code Paths

1. **Main path** (`get_filtered_map` RPC): Returns keyword pairs with cross-article similarity edges. Used when articles share similar keywords.

2. **Fallback path** (`getFallbackFilteredMap`): Used when no cross-article keyword pairs exist. Shows articles with their individual keywords, without keyword↔keyword similarity edges.

## Edge Cases

### Articles with No Remaining Keywords
If all of an article's keywords are synonyms of the query (above threshold), the article still appears in the map but without any keyword connections. This can happen when:
- An article is very focused on exactly the query concept
- The threshold is set low, filtering out many related terms

### Empty Results
If no articles have keywords similar enough to match the query, the map shows "No data to display."

## Use Cases

1. **Finding unexpected connections**: "What do my notes about X have in common besides X?"
2. **Exploring conceptual neighborhoods**: Lower the threshold to see what concepts cluster with your query
3. **Identifying gaps**: Articles that appear isolated (no shared keywords with others) might need more cross-linking
