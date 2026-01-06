// Stub declarations for umapper local package
// The actual package is at ../umapper but may not exist in all workspaces

declare module "umapper" {
  export interface KnnGraphObject {
    [nodeId: string]: Array<{ id: string; distance: number }>;
  }

  export interface UmapLayoutOptions {
    minDist?: number;
    spread?: number;
    epochs?: number;
    attractionStrength?: number;
    repulsionStrength?: number;
    minAttractiveScale?: number;
    progressInterval?: number;
    skipInitialUpdates?: number;
    renderSampleRate?: number;
    onProgress?: (info: { progress: number; epoch: number; nodes: LayoutPosition[] }) => void | boolean;
  }

  export interface LayoutPosition {
    id: string;
    x: number;
    y: number;
  }

  export function umapLayout(knn: KnnGraphObject, options?: UmapLayoutOptions): Promise<LayoutPosition[]>;
}
