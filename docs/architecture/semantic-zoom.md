# Semantic Zoom Implementation

This document tracks the implementation status of semantic zoom. For architectural decisions, see [ADR 008](adr/008-semantic-zoom.md).

## Overview

Semantic zoom transforms geometric zooming into semantic filtering. Zoom in → filter to related content. Zoom out → restore nodes. Visual stability throughout.

## Implementation Status

### Phase 1: Server - Embeddings in Response
**Status**: Complete

- [x] Add `embedding?: number[]` to MapNode interface
- [x] Include 256-dim embeddings in `buildSemanticMapData()` for keywords
- [x] Include 256-dim embeddings in `buildSemanticMapData()` for articles
- [ ] Test payload size with real data (deferred - will test when dev server runs)

**File**: `src/app/api/map/route.ts`

### Phase 2: Core Algorithms
**Status**: Complete

- [x] Create `src/lib/semantic-zoom.ts`
- [x] `computeSemanticCentroid()` - weighted average of visible node embeddings
- [x] `zoomToThreshold()` - map zoom scale to similarity threshold
- [x] `computeVisibleSet()` - filter nodes by distance from centroid
- [x] `zoomToEdgeOpacity()` - map zoom to edge opacity (0.1 → 0.8)
- [x] `cosineSimilarity()` - dot product for unit vectors (+ Float32Array version)
- [x] `extendVisibleToConnected()` - include nodes without embeddings
- [x] `computeRestoredPosition()` - position for returning nodes
- [x] `measureSemanticZoom()` - benchmarking utility
- [ ] Unit tests for all functions (deferred)

**File**: `src/lib/semantic-zoom.ts`

### Phase 3: React State Management
**Status**: Complete

- [x] Create `src/hooks/useSemanticZoom.ts`
- [x] `visibleIds: Set<string>` state
- [x] `storedPositions: Map<string, Point>` ref
- [x] `onZoomEnd()` handler
- [x] Position storage/retrieval helpers
- [x] `getVisibleNodes()` / `getVisibleLinks()` derived accessors
- [x] `reset()` method

**File**: `src/hooks/useSemanticZoom.ts`

### Phase 4: Renderer Integration
**Status**: Complete

- [x] Add `onZoomEnd` callback to `RendererCallbacks`
- [x] Expose `getTransform()` method
- [x] Expose `getViewport()` method
- [ ] Dynamic edge opacity based on zoom level (deferred - will wire in MapView)

**File**: `src/lib/map-renderer.ts`

### Phase 5: MapView Integration
**Status**: Complete

- [x] Add semantic zoom state and toggle
- [x] Wire up zoom end handler to renderer
- [x] Store simNodes/simLinks refs for hook access
- [x] Apply visibility via opacity (initial approach)

**File**: `src/components/MapView.tsx`

### Phase 6: UI Controls
**Status**: Complete

- [x] Semantic zoom toggle checkbox
- [x] Steepness slider (threshold curve)
- [x] Current threshold display

**File**: `src/components/MapSidebar.tsx`

### Phase 7: Settling Simulation (Polish)
**Status**: Not Started

- [ ] Add `createSettlingSimulation()` function
- [ ] Soft-pin existing nodes (high friction)
- [ ] Normal forces for new nodes
- [ ] Low alpha, fast decay
- [ ] Position restoration for returning nodes

**File**: `src/lib/map-layout.ts`

## Performance Targets

| Operation | Target | Stretch |
|-----------|--------|---------|
| Centroid computation | < 10ms | < 5ms |
| Visibility filtering | < 5ms | < 2ms |
| Full zoom-end cycle | < 50ms | < 16ms |
| Settling to stable | < 500ms | < 200ms |

## Open Questions

1. **Threshold floor**: At what zoom level does threshold hit 0? Need to tune.
2. **Edge opacity curve**: Linear or ease-in-out?
3. **Position interpolation**: When node has no neighbors, where to place it?
4. **Zoom constraints**: Should we expand zoom range beyond 0.1-4x?

## Test Scenarios

- [ ] Zoom in on cluster of related articles
- [ ] Zoom out to restore all nodes
- [ ] Rapid zoom in/out (stress test)
- [ ] Zoom with search filter active
- [ ] Large graph (500+ nodes) performance

## Changelog

- **2025-01-04**: Initial document created, Phase 1 started
- **2025-01-04**: Phases 1-6 complete - basic semantic zoom working (opacity-based filtering)
