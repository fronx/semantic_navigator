/**
 * Transmission panel positioning logic for keyword/chunk layer transitions.
 *
 * The panel creates a "frosted glass" blur effect with an INSTANT FLIP behavior:
 * - When far: panel hidden behind keywords (inactive, no blur)
 * - At threshold: panel JUMPS instantly to just in front of keywords (minimal blur)
 * - When close: panel gradually moves from keywords toward camera (increasing blur)
 *
 * Frame-by-Frame ASCII Art Visualization (viewing from behind camera):
 * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 *
 * Frame 1: Camera at z=20000 (FAR - zoomed out)
 *   Camera👁         [huge gap ~20000 units]           ●Keywords(z=0)  Chunks(z<0)
 *   Panel ratio: 0%
 *   Panel.z = 20000 * 0 = 0 (behind keywords, inactive)
 *
 *                    Chunks◯────Keywords●═══Panel▓ (all at ~z=0)
 *                   (z=-150)     (z=0)     (z=0)
 *
 *   Effect: Keywords clear, chunks invisible, panel has no effect
 *
 * ────────────────────────────────────────────────────────────────────────────────
 *
 * Frame 2: Camera at z=4001 (still above threshold)
 *   Camera👁    [gap ~4000 units]    ●Keywords(z=0)  Chunks(z<0)
 *   Panel ratio: 0%
 *   Panel.z = 4001 * 0 = 0 (still behind keywords, inactive)
 *
 *                    Chunks◯────Keywords●═══Panel▓
 *                   (z=-150)     (z=0)     (z=0)
 *
 *   Effect: Keywords clear, chunks appearing, panel still inactive
 *
 * ────────────────────────────────────────────────────────────────────────────────
 *
 * Frame 3: Camera at z=4000 (FLIP THRESHOLD - instant jump!)
 *   Camera👁        [gap ~4000 units]      ▓Panel●Keywords(z=0)  Chunks(z<0)
 *   Panel ratio: 10%
 *   Panel.z = 4000 * 0.1 = 400 (JUMPED just in front of keywords!)
 *
 *        Camera👁 ────[gap]──── Panel▓●Keywords────Chunks◯
 *        (z=4000)               (z=400)(z=0)     (z=-150)
 *
 *   Effect: Panel just in front of keywords, minimal blur (see through clearly)
 *
 * ────────────────────────────────────────────────────────────────────────────────
 *
 * Frame 4: Camera at z=2750 (between threshold and close)
 *   Camera👁        [gap ~1444]   Panel▓ [gap ~1306]  ●Keywords  Chunks◯
 *   Panel ratio: ~47.5%
 *   Panel.z = 2750 * 0.475 ≈ 1306 (between keywords and camera)
 *
 *        Camera👁────[gap]────Panel▓────[gap]──── Keywords●────Chunks◯
 *        (z=2750)            (z=1306)            (z=0)     (z=-150)
 *
 *   Effect: Panel moving toward camera, increasing blur effect
 *
 * ────────────────────────────────────────────────────────────────────────────────
 *
 * Frame 5: Camera at z=1500 (CLOSE - zoomed in)
 *   Camera👁  [gap ~225]  ▓Panel    [gap ~1275]    ●Keywords  Chunks◯
 *   Panel ratio: 85%
 *   Panel.z = 1500 * 0.85 = 1275 (close to camera, 15% away)
 *
 *        Camera👁──Panel▓────[gap]──── Keywords●────Chunks◯
 *        (z=1500)(z=1275)             (z=0)     (z=-150)
 *
 *   Effect: Panel close to camera, maximum blur/dispersion of keywords
 *
 * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 *
 * Position Formula:  panel.z = camera.z * ratio
 *
 * The Magic: As camera gets closer (z decreases) and ratio INCREASES, the panel
 * moves from keywords toward camera, increasing the blur effect!
 *
 *   Camera=20000, ratio=0    → panel=0     (behind keywords, inactive)
 *   Camera=4000,  ratio=0.1  → panel=400   (near keywords, minimal blur)
 *   Camera=1500,  ratio=0.85 → panel=1275  (near camera, maximum blur)
 *
 * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 *
 * Implementation: Threshold with single transition phase
 *
 * Phase 1: Camera > 4000 (FAR)
 *   - Panel stays at 0% (behind keywords, inactive)
 *   - NO gradual transition - stays constant at 0%
 *
 * Phase 2: Camera = 4000 (FLIP THRESHOLD)
 *   - Panel INSTANTLY jumps from 0% to 10%
 *   - This is a discrete state change, not interpolation
 *   - Panel appears just in front of keywords (minimal blur)
 *
 * Phase 3: Camera between 4000 and 1500 (TRANSITION)
 *   - Panel gradually moves from 10% (near keywords) to 85% (near camera)
 *   - Linear interpolation creates smooth blur effect increase
 *   - Panel travels from keywords toward camera as you zoom in
 *
 * Phase 4: Camera < 1500 (VERY CLOSE)
 *   - Panel stays at 85% (15% away from camera, maximum blur effect)
 */

// Camera Z thresholds for panel positioning
const FLIP_THRESHOLD = 4000;   // Threshold where panel instantly flips from behind keywords to camera
const CLOSE_DISTANCE = 1500;   // Distance where panel reaches minimum ratio (maximum blur)

// Material thickness transition (controls blur strength)
const THICKNESS_TRANSITION_START = 5000;  // Start ramping up thickness (no blur)
const THICKNESS_TRANSITION_END = 4000;    // End of ramp (full thickness)
const MAX_THICKNESS = 20;                 // Maximum thickness value

// Panel position ratios
const PANEL_RATIO_INACTIVE = 0;       // 0% = panel behind keywords (inactive, no blur)
const PANEL_RATIO_NEAR_KEYWORDS = 0.1; // 10% = panel just in front of keywords (minimal blur after flip)
const PANEL_RATIO_NEAR_CAMERA = 0.85;  // 85% = panel close to camera, 15% away (maximum blur)

/**
 * Calculate panel distance ratio based on camera Z position.
 *
 * Creates an INSTANT FLIP behavior with inverted blur effect:
 * - Camera > 4000: panel at 0% (behind keywords, inactive)
 * - Camera ≤ 4000: panel jumps to 10% (near keywords, minimal blur)
 * - Camera approaching 1500: panel moves to 85% (near camera, maximum blur)
 *
 * The transmission material creates MORE blur when panel is far from keywords.
 * Panel near camera = maximum dispersion, panel near keywords = minimal dispersion.
 *
 * @param cameraZ - Current camera Z position
 * @returns Panel distance ratio (0 = at keywords, 1 = at camera)
 */
export function calculatePanelRatio(cameraZ: number): number {
  if (cameraZ >= FLIP_THRESHOLD) {
    // Phase 1: Panel behind keywords (inactive)
    // No gradual transition - stays at 0 until threshold
    return PANEL_RATIO_INACTIVE;
  }

  if (cameraZ >= CLOSE_DISTANCE) {
    // Phase 2: Panel moves from keywords toward camera
    // At threshold (4000): ratio = 0.1 (panel near keywords, minimal blur)
    // At close (1500): ratio = 0.85 (panel near camera, maximum blur)
    // Interpolate: camera 4000 → 1500, ratio 0.1 → 0.85
    const t = (FLIP_THRESHOLD - cameraZ) / (FLIP_THRESHOLD - CLOSE_DISTANCE);
    return PANEL_RATIO_NEAR_KEYWORDS + t * (PANEL_RATIO_NEAR_CAMERA - PANEL_RATIO_NEAR_KEYWORDS);
  }

  // Phase 3: Very close - panel stays near camera (maximum blur)
  return PANEL_RATIO_NEAR_CAMERA;
}

/**
 * Calculate panel material thickness based on camera Z position.
 *
 * Thickness controls the blur strength:
 * - Camera > 5000: thickness = 0 (no blur, panel inactive)
 * - Camera 5000→4000: thickness ramps from 0 to 20 (blur fading in)
 * - Camera < 4000: thickness = 20 (full blur effect)
 *
 * @param cameraZ - Current camera Z position
 * @returns Thickness value for MeshTransmissionMaterial (0-20)
 */
export function calculatePanelThickness(cameraZ: number): number {
  if (cameraZ >= THICKNESS_TRANSITION_START) {
    // No blur yet - panel inactive
    return 0;
  }

  if (cameraZ >= THICKNESS_TRANSITION_END) {
    // Ramp up thickness from 0 to MAX_THICKNESS
    const t = (THICKNESS_TRANSITION_START - cameraZ) / (THICKNESS_TRANSITION_START - THICKNESS_TRANSITION_END);
    return t * MAX_THICKNESS;
  }

  // Full thickness - maximum blur
  return MAX_THICKNESS;
}

/**
 * Export thresholds for debugging/visualization
 */
export const PANEL_CONFIG = {
  FLIP_THRESHOLD,
  CLOSE_DISTANCE,
  PANEL_RATIO_INACTIVE,
  PANEL_RATIO_NEAR_KEYWORDS,
  PANEL_RATIO_NEAR_CAMERA,
  THICKNESS_TRANSITION_START,
  THICKNESS_TRANSITION_END,
  MAX_THICKNESS,
} as const;
