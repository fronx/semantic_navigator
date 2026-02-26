/**
 * Default values for ChunksView settings.
 * Lives in src/lib/ (not inside a component) so it can be imported by
 * both ChunksView.tsx and scripts like generate-artifact-data.ts.
 */
export const CHUNKS_DEFAULTS = {
  nNeighbors: 15,
  minDist: 0.1,
  spread: 1.0,
  colorSaturation: 0.6,
  minSaturation: 0.45,
  brightness: 1.0,
  chunkColorMix: 0.4,
  edgeThickness: 4,
  edgeMidpoint: 0.6,
  edgeCountPivot: 200,
  edgeCountFloor: 0.3,
  nodeSizeMin: 0.6,
  nodeSizeMax: 2.0,
  nodeSizePivot: 30,
  hoverRadius: 70,
  shapeMorphNear: 800,
  shapeMorphFar: 3000,
  coarseResolution: 0.3,
  fineResolution: 1.5,
  coarseFadeIn:  { start: 8000, full: 5000 },
  coarseFadeOut: { start: 3000, full: 1500 },
  fineFadeIn:    { start: 2500, full: 1500 },
  fineFadeOut:   { start: 1000, full: 200  },
  sidebarCollapsed: false,
  sectionStates: {
    UMAP: true,
  } as Record<string, boolean>,
};
