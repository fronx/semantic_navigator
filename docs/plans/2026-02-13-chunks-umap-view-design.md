# Chunks UMAP View

## Goal

New view at `/chunks` that visualizes all chunk embeddings in 2D using UMAP, rendered with R3F. Users can watch the UMAP algorithm converge live, then zoom into cards to read chunk text.

## Data Flow

```
DB (nodes.embedding 1536-dim)
  → API /api/chunks/embeddings (truncate to 256-dim server-side)
  → Browser: umap-js initializeFit(vectors)
  → rAF loop: step() → getEmbedding() → update R3F positions
  → Final: zoomable text card layout
```

### API: `GET /api/chunks/embeddings`

Returns all chunks with truncated embeddings:

```typescript
interface ChunkEmbeddingResponse {
  chunks: {
    id: string;
    content: string;
    summary: string | null;
    sourcePath: string;
    headingContext: string[] | null;
    chunkType: string | null;
    embedding: number[]; // 256-dim (first 256 of 1536 - Matryoshka truncation)
  }[];
}
```

Why 256-dim: OpenAI text-embedding-3-small supports Matryoshka truncation. 256-dim preserves good quality for neighborhood structure while reducing payload from ~24MB to ~4MB for 2000 chunks.

### UMAP Computation (client-side)

Using `umap-js` (Google PAIR):

```typescript
const umap = new UMAP({ nComponents: 2, nNeighbors: 15, minDist: 0.1 });
const nEpochs = umap.initializeFit(embeddings);

// Run in rAF loop for live visualization
function animate() {
  umap.step();
  const positions = umap.getEmbedding(); // number[][] → update R3F
  if (currentEpoch < nEpochs) requestAnimationFrame(animate);
}
```

## Rendering Architecture

```
src/app/chunks/page.tsx          → Route, fetches data
src/components/ChunksView.tsx    → Orchestrates UMAP + R3F
src/components/chunks-r3f/
  ChunksCanvas.tsx               → R3F Canvas setup (adapted from R3FTopicsCanvas)
  ChunksScene.tsx                → Scene coordinator
  ChunkCards.tsx                 → InstancedMesh rounded rectangles
  ChunkTextLabels.tsx            → Text on cards (zoom-based visibility)
```

### LOD Strategy (500-2000 chunks)

- **Zoomed out** (camera Z > threshold): Small colored dots via instancedMesh circles
- **Medium zoom**: Rounded rectangle cards, no text yet
- **Zoomed in**: Cards with readable chunk text (reuse useThreeTextGeometry pattern)

Transition: smooth opacity crossfade controlled by camera Z, similar to existing `content-scale.ts` pattern.

### Coloring

Initial: color by source article (same `sourcePath` → same hue). Simple hash-to-hue mapping.

## Reused Components

| Component/Hook | From | Adaptation |
|---|---|---|
| `CameraController` | topics-r3f | As-is |
| `useStableInstanceCount` | hooks | As-is |
| `useInstancedMeshMaterial` | hooks | As-is |
| `useThreeTextGeometry` | topics-r3f | For text labels |
| `useFadingMembership` | hooks | For animated visibility |
| `useStableCallback` | hooks | For all callbacks |
| `scalePositions`/`centerPositions` | map-layout.ts | For position normalization |

## New Code

1. **API route** `/api/chunks/embeddings` - fetch chunks with truncated embeddings
2. **ChunksView** - data loading + UMAP orchestration
3. **ChunksCanvas** - simplified R3F canvas (no content layer, no transmission panel)
4. **ChunksScene** - scene coordinator (single layer, no force sim)
5. **ChunkCards** - instancedMesh for card backgrounds
6. **ChunkTextLabels** - text rendering with LOD

## Implementation Steps

### Step 1: API route + data types
- Create `GET /api/chunks/embeddings` that queries all chunks with embeddings
- Truncate embeddings to 256-dim server-side
- Define `ChunkEmbeddingData` types

### Step 2: Install umap-js + UMAP hook
- `npm install umap-js`
- Create `useUmapLayout` hook that:
  - Takes `number[][]` embeddings
  - Returns `{ positions: [x,y][], progress: number, isRunning: boolean }`
  - Runs step() in rAF loop
  - Normalizes positions to centered coordinates

### Step 3: Page + ChunksView shell
- Create `src/app/chunks/page.tsx` route
- Create `ChunksView.tsx` with data fetching + loading state
- Wire up UMAP hook, show progress indicator

### Step 4: R3F rendering - ChunksCanvas + ChunksScene
- Adapt canvas setup from R3FTopicsCanvas (camera, theme, cursor tracking)
- ChunksScene with CameraController
- Basic instanced dots showing UMAP positions updating live

### Step 5: ChunkCards - card rendering with LOD
- InstancedMesh rounded rectangles (adapt from ContentNodes geometry)
- Zoom-based transition: dots → cards
- Color by source article

### Step 6: ChunkTextLabels - text on cards
- Reuse useThreeTextGeometry for Three.js text
- Zoom-based text visibility (fade in when camera is close enough)
- Truncate long content, show heading context

### Step 7: Polish
- Progress bar during UMAP computation
- Auto-fit camera after UMAP converges
- Smooth position transitions during UMAP steps
