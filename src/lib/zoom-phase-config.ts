import {
  CAMERA_Z_MIN,
  CAMERA_Z_MAX,
  CONTENT_Z_TRANSITION_MIN,
  CONTENT_Z_TRANSITION_MAX,
} from "./content-zoom-config";

export interface ZoomRange {
  /** Near plane (smaller Z, closer to camera) where the effect reaches full strength */
  near: number;
  /** Far plane (larger Z, zoomed out) where the effect fades out */
  far: number;
}

export interface ZoomPhaseConfig {
  /** Controls when keyword labels take over from coarse cluster labels */
  keywordLabels: {
    /** At or above this Z, keyword labels stay hidden */
    start: number;
    /** At or below this Z, all keyword labels are allowed */
    full: number;
  };
  /** Crossfade window for keyword → chunk rendering */
  chunkCrossfade: ZoomRange;
  /** Blur intensity window tied to frosted-glass effect */
  blur: ZoomRange & {
    /** Maximum blur radius (in composer pixels) when fully zoomed into chunks */
    maxRadius: number;
  };
}

export const DEFAULT_ZOOM_PHASE_CONFIG: ZoomPhaseConfig = {
  keywordLabels: {
    start: 13961,
    full: 1200,
  },
  chunkCrossfade: {
    near: 50,
    far: 10347,
  },
  blur: {
    near: 50,
    far: 2456,
    maxRadius: 12.5,
  },
};

export function normalizeZoom(cameraZ: number, range: ZoomRange): number {
  const near = Math.min(range.near, range.far);
  const far = Math.max(range.near, range.far);
  const span = Math.max(far - near, 1);
  if (cameraZ <= near) return 0;
  if (cameraZ >= far) return 1;
  return (cameraZ - near) / span;
}

export function cloneZoomPhaseConfig(config: ZoomPhaseConfig): ZoomPhaseConfig {
  return {
    keywordLabels: { ...config.keywordLabels },
    chunkCrossfade: { ...config.chunkCrossfade },
    blur: { ...config.blur },
  };
}

function clampCameraZ(z: number): number {
  return Math.max(CAMERA_Z_MIN, Math.min(CAMERA_Z_MAX, z));
}

function normalizeRange(range: ZoomRange): ZoomRange {
  const near = clampCameraZ(Math.min(range.near, range.far));
  const far = clampCameraZ(Math.max(range.near, range.far));
  return { near, far };
}

export function sanitizeZoomPhaseConfig(config: ZoomPhaseConfig): ZoomPhaseConfig {
  const start = clampCameraZ(Math.max(config.keywordLabels.start, config.keywordLabels.full));
  const full = clampCameraZ(Math.min(config.keywordLabels.start, config.keywordLabels.full));

  return {
    keywordLabels: { start, full },
    chunkCrossfade: normalizeRange(config.chunkCrossfade),
    blur: { ...normalizeRange(config.blur), maxRadius: Math.max(0, config.blur.maxRadius) },
  };
}
