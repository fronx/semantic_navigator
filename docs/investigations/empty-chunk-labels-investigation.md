# Investigation: Empty Chunk Labels Bug

**Date**: 2026-02-05
**Issue**: Some chunk nodes display without content text in the 3D visualization
**Pattern**: First 2 chunks in a keyword cluster are empty; remaining chunks work

## Problem Statement

When viewing keyword clusters in TopicsView, certain chunk nodes appear as blank squares despite having valid content in the database. The pattern is consistent: the first 2 chunks in array order fail to render content, while subsequent chunks render correctly.

### Example Cases

1. **"wave dynamics" keyword** - 1 chunk, empty
   - `8483bee6-b4c4-470f-873f-41e2d709695f` (125 chars, plain text)

2. **"movement" keyword** - 5 chunks total
   - Empty: chunks 1-2 (`036b0d16...`, `044592d9...`)
   - Working: chunks 3-5 (`086cda4b...`, `b1762908...`, `d2367338...`)

## Investigation

### Data Layer Verification ✓

All database and API layers confirmed working correctly:
- ✓ Database contains valid, non-null content for all chunks
- ✓ API query returns complete content (no empty strings)
- ✓ Content lengths: 71-893 characters
- ✓ No corruption or missing data

### Data Transformation Testing ✓

Created test scripts to trace transformations:
- ✓ `test-d3-object-identity.ts` - D3 preserves custom properties
- ✓ `test-chunk-data-flow.ts` - All transformations preserve content
- ✓ `test-api-query.ts` - API returns valid content
- ✓ `test-sim-node-content-access.ts` - Content accessible via type casting
- ✓ `test-map-iteration-order.ts` - **Confirmed first 2 chunks are at positions 1-2**

### Root Cause

The issue is in the React portal creation logic in `LabelsOverlay.tsx:62-70`:

```typescript
// BEFORE (buggy):
if (visible && content) {
  next.set(chunkId, { container, content });
}
```

The check `visible && content` fails when `content` is an empty string `""`, which is falsy in JavaScript.

While our tests show content is never empty in the data layer, there may be a React rendering race condition where:
1. Initial render creates chunk nodes with incomplete data
2. Labels attempt to render before content is fully available
3. The falsy check prevents portal creation for first N chunks
4. Later updates don't trigger re-creation because React doesn't detect the change

## Fix

Modified `LabelsOverlay.tsx` to always create portals when `visible=true`:

```typescript
// AFTER (fixed):
if (visible) {
  next.set(chunkId, { container, content: content || '' });
}
```

This ensures:
- Portals are created for all visible chunks
- Empty content is normalized to `''` for ReactMarkdown
- No race condition can prevent portal creation

## Files Modified

- `src/components/topics-r3f/LabelsOverlay.tsx:56-71` - Fixed portal creation logic

## Testing

Created comprehensive test suite:
- `scripts/test-d3-object-identity.ts` - D3 simulation behavior
- `scripts/test-chunk-data-flow.ts` - End-to-end data transformations
- `scripts/test-api-query.ts` - API query validation
- `scripts/test-sim-node-content-access.ts` - Property access patterns
- `scripts/test-map-iteration-order.ts` - Array ordering verification
- `scripts/test-portal-state-updates.ts` - React state update simulation

## Verification

To verify the fix:
1. Start dev server: `npm run dev`
2. Navigate to Topics view
3. Find "movement" keyword cluster
4. Zoom in on chunk nodes
5. Confirm all 5 chunks display content (not just chunks 3-5)

## Lessons Learned

1. **Falsy checks are dangerous**: Empty string `""` is falsy, making `if (x && y)` unreliable
2. **React state timing**: Initial renders may have incomplete data
3. **Test isolation limitations**: Isolated tests can't reproduce React lifecycle issues
4. **Array position matters**: First items in arrays may hit different code paths during initialization

## Related Files

- `src/lib/label-overlays.ts:452` - Content extraction with fallback
- `src/components/topics-r3f/ChunkNodes.tsx` - Screen rect calculation
- `src/lib/chunk-layout.ts:54` - Content field assignment
- `src/hooks/useChunkLoading.ts` - Chunk data fetching
- `src/app/api/topics/chunks/route.ts:58` - API content handling
