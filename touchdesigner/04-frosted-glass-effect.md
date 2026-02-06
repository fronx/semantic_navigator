# Frosted Glass / Transmission Effect -- TouchDesigner Conversion

This document details how to replicate the frosted glass transmission panel from the R3F TopicsView in TouchDesigner. The effect creates depth separation between keyword nodes (z=0 foreground) and content nodes (z=-150 background) by rendering an intermediate blurred panel that makes background content appear frosted while keeping foreground keywords crisp.

## Table of Contents

1. [What the R3F Implementation Does](#1-what-the-r3f-implementation-does)
2. [Approach A: Multi-Pass Rendering (Recommended)](#2-approach-a-multi-pass-rendering-recommended)
3. [Approach B: Custom GLSL MAT -- Screen-Space Refraction](#3-approach-b-custom-glsl-mat----screen-space-refraction)
4. [Approach C: Feedback-Based Iterative Blur](#4-approach-c-feedback-based-iterative-blur)
5. [TouchDesigner PBR MAT Transmission](#5-touchdesigner-pbr-mat-transmission)
5b. [Approach D: Depth-of-Field Post-Processing](#5b-approach-d-depth-of-field-post-processing)
6. [Detailed Node Network Layout (Approach A)](#6-detailed-node-network-layout-approach-a)
7. [Parameter Mapping](#7-parameter-mapping)
8. [Dynamic Sizing -- Making the Panel Track the Camera](#8-dynamic-sizing----making-the-panel-track-the-camera)
9. [Performance Considerations](#9-performance-considerations)
10. [Putting It Together -- Minimal Working Example](#10-putting-it-together----minimal-working-example)
11. [Dynamic Thickness -- Zoom-Responsive Blur](#11-dynamic-thickness----zoom-responsive-blur)
11b. [Additional Variations](#11b-additional-variations)
12. [Summary of Recommendations](#12-summary-of-recommendations)

---

## 1. What the R3F Implementation Does

`TransmissionPanel.tsx` places a `PlaneGeometry` between the keyword layer (z=0) and the content layer (z=-150). It uses drei's `MeshTransmissionMaterial`, which internally:

1. Renders everything behind the panel into an off-screen FBO (frame buffer object) at a configurable resolution (1024x1024 by default).
2. Samples that backface texture with screen-space distortion based on `thickness` and `roughness`, simulating light scattering through a translucent medium.
3. Multi-samples (16 jittered samples) to produce smooth blur without banding.
4. Blends the result with the panel surface at 97% transmission (nearly fully transparent, with subtle color from the material itself).

The panel tracks the camera every frame (`useFrame`), matching its XY position and scaling to cover the visible viewport at the panel's Z depth (with a 5% margin to avoid edge artifacts during fast panning).

### Key Parameters

| R3F Parameter | Value | Purpose |
|---|---|---|
| `transmission` | 0.97 | How much light passes through (1.0 = fully transparent) |
| `thickness` | configurable (0-20) | Controls blur strength; 0 = no blur, 20 = heavy blur |
| `roughness` | 1.0 | Surface scattering; 1.0 = maximum diffusion |
| `anisotropicBlur` | 5.0 | Directional blur bias (elongated scatter kernel) |
| `samples` | 16 | Number of refraction samples (quality vs. performance) |
| `resolution` | 1024 | FBO resolution for backface render |
| `distanceRatio` | configurable | Panel Z position as ratio of camera Z (0=at keywords, 1=at camera) |

### Scene Z-Depth Layout

```
Camera (z = cameraZ, starts at 10500)
  |
  |  ---- Keywords at z = 0 (foreground, always crisp)
  |
  |  ---- Transmission Panel at z = cameraZ * distanceRatio (intermediate)
  |
  |  ---- Content Nodes at z = -150 (background, frosted by panel)
  v
```

---

## 2. Approach A: Multi-Pass Rendering (Recommended)

This is the most straightforward and controllable approach in TouchDesigner. It separates the scene into layers, blurs the background layer, and composites them.

### Concept

1. Render the **background layer** (content nodes at z=-150) to a Render TOP.
2. Apply a **Blur TOP** to that texture.
3. Render the **foreground layer** (keywords at z=0, edges) to a separate Render TOP.
4. **Composite** the blurred background under the crisp foreground using an Over TOP or Composite TOP.

### Operator Network

```
[Camera COMP]────────────────────────────────┐
                                              |
                                              v
[Geo COMP: Content Nodes] ──→ [Render TOP 1: "render_background"]
  (z=-150, instanced rects)     camera = shared camera
  (Constant MAT with Cd)        render flag: content geo only
                                              |
                                              v
                                     [Blur TOP: "blur_background"]
                                       size = 15-60 px
                                       filter = Gaussian
                                       passes = 2-4
                                              |
                                              v
[Geo COMP: Keywords] ──────→ [Render TOP 2: "render_foreground"]──→ [Over TOP: "composite"]
  (z=0, instanced circles)      camera = shared camera                  input 0 = foreground
  (Constant MAT with Cd)        render flag: keyword geo only           input 1 = blurred bg
                                background = transparent (alpha=0)       |
                                                                         v
[Geo COMP: Edges] ─────────→ (also in render_foreground)         [Out TOP: final output]
  (Line geometry)
```

### Detailed Operator Configuration

#### Render TOP 1 -- Background Layer (`render_background`)

| Parameter | Value | Notes |
|---|---|---|
| Camera | `/project1/camera1` | Shared perspective camera |
| Geometry | `/project1/geo_content_nodes` | Only content node geometry |
| Resolution | 1920x1080 (or match output) | Full resolution before blur |
| Pixel Format | RGBA 8-bit fixed | Alpha needed for compositing |
| Background Color | Scene background color (e.g., 0.094, 0.094, 0.106, 1 for dark theme) | Must match main scene bg |
| Render Mode | Default | Standard rasterization |
| Anti-Alias | 4x MSAA | Smooth edges before blur |

#### Blur TOP (`blur_background`)

| Parameter | Value | Notes |
|---|---|---|
| Filter | Gaussian | Smooth, no artifacts |
| Size | Map from `thickness`: `thickness * 3.0` pixels | See parameter mapping below |
| Filter Width | Equal in X and Y for isotropic blur | Or bias X for anisotropic (see below) |
| Passes | 2-4 | Multiple passes = smoother, more expensive |
| Extend | Mirror | Prevents dark edges at texture borders |

For the anisotropic blur that `anisotropicBlur=5.0` provides in R3F, set the Blur TOP's Filter Width to different values in X and Y:

```
Filter Width X = thickness * 3.0 * (1 + anisotropicFactor * 0.5)
Filter Width Y = thickness * 3.0 * (1 - anisotropicFactor * 0.3)
```

Where `anisotropicFactor` ranges 0-1 (R3F uses 5.0 on a different scale; normalize to taste).

#### Render TOP 2 -- Foreground Layer (`render_foreground`)

| Parameter | Value | Notes |
|---|---|---|
| Camera | `/project1/camera1` | Same camera as background |
| Geometry | `/project1/geo_keywords`, `/project1/geo_edges` | Keywords + edges only |
| Resolution | Match `render_background` | Must match for compositing |
| Pixel Format | RGBA 8-bit fixed | Need alpha for transparency |
| Background Color | 0, 0, 0, 0 | Transparent background |
| Anti-Alias | 4x MSAA | Match quality |

#### Over TOP (`composite`)

| Parameter | Value |
|---|---|
| Input 0 | `render_foreground` (on top) |
| Input 1 | `blur_background` (behind) |
| Pre-Multiply | Match your alpha convention |

### Advantages

- Simple to build, debug, and tune.
- Blur strength is a single parameter (Blur TOP size).
- Each layer is independently visible for debugging.
- Performance is predictable: two render passes + one blur pass.

### Disadvantages

- No true refraction distortion (objects behind the panel are blurred but not displaced).
- The blur is uniform across the panel -- no thickness-dependent variation across the surface.
- Requires careful camera synchronization between render passes.

---

## 3. Approach B: Custom GLSL MAT -- Screen-Space Refraction

This approach renders a plane with a custom GLSL material that samples a pre-rendered background texture with jittered UV offsets, simulating transmission/refraction in a single geometry pass.

### Concept

1. Render the background layer to a Render TOP (same as Approach A).
2. Instead of blurring with a Blur TOP, assign a GLSL MAT to the transmission plane that reads the background texture and samples it with randomized offsets.

### GLSL MAT Setup

Create a GLSL MAT with a custom fragment shader. The vertex shader is standard (pass through position and UVs). The fragment shader does the refraction sampling.

#### Vertex Shader (`transmission_vert.glsl`)

```glsl
// Standard TD vertex shader - nothing special needed
out vec4 vScreenPos;

void main()
{
    // Standard MVP transform
    vec4 worldPos = TDDeform(P);
    gl_Position = TDWorldToProj(worldPos);

    // Pass screen-space position for texture lookup
    vScreenPos = gl_Position;
}
```

#### Fragment Shader (`transmission_frag.glsl`)

```glsl
uniform float uThickness;     // 0-20, controls blur spread
uniform float uRoughness;     // 0-1, controls scatter amount
uniform float uTransmission;  // 0-1, blend with panel color (0.97)
uniform float uAnisotropy;    // directional bias
uniform int   uSamples;       // number of jitter samples (8-32)

uniform sampler2D sBackgroundTex;  // Render TOP of background layer

in vec4 vScreenPos;
out vec4 fragColor;

// Simple hash for pseudo-random jitter
float hash(vec2 p) {
    return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
}

void main()
{
    // Convert clip space to UV (0-1 range)
    vec2 screenUV = (vScreenPos.xy / vScreenPos.w) * 0.5 + 0.5;

    // Blur radius in UV space, derived from thickness and roughness
    // thickness controls the magnitude, roughness controls the scatter
    float blurRadius = uThickness * uRoughness * 0.005;

    vec4 accum = vec4(0.0);
    float totalWeight = 0.0;

    for (int i = 0; i < uSamples; i++) {
        // Generate jittered offset
        vec2 seed = screenUV * 1000.0 + vec2(float(i) * 7.23, float(i) * 13.17);
        float angle = hash(seed) * 6.28318;
        float radius = hash(seed + 0.5) * blurRadius;

        // Apply anisotropy: stretch in X, compress in Y
        vec2 offset = vec2(
            cos(angle) * radius * (1.0 + uAnisotropy * 0.3),
            sin(angle) * radius * (1.0 - uAnisotropy * 0.2)
        );

        vec2 sampleUV = screenUV + offset;

        // Gaussian-like weight based on distance
        float weight = exp(-dot(offset, offset) / (blurRadius * blurRadius + 0.0001));

        accum += texture(sBackgroundTex, sampleUV) * weight;
        totalWeight += weight;
    }

    vec4 refracted = accum / totalWeight;

    // Blend with panel's own color (slight tint)
    vec4 panelColor = vec4(1.0, 1.0, 1.0, 1.0);  // white panel, nearly invisible
    vec4 result = mix(panelColor, refracted, uTransmission);
    result.a = 1.0;

    fragColor = TDOutputSwizzle(result);
}
```

### GLSL MAT Operator Configuration

| Parameter | Setting |
|---|---|
| Vertex Shader | DAT reference to `transmission_vert` |
| Pixel Shader | DAT reference to `transmission_frag` |
| Sampler 0 (`sBackgroundTex`) | Wire from `render_background` Render TOP |
| Uniform `uThickness` | CHOP reference or constant: 0-20 |
| Uniform `uRoughness` | Constant: 1.0 |
| Uniform `uTransmission` | Constant: 0.97 |
| Uniform `uAnisotropy` | Constant: 0.5 (normalized from R3F's 5.0) |
| Uniform `uSamples` | Constant: 16 |

### Network for GLSL Approach

```
[Geo COMP: Content Nodes] ──→ [Render TOP 1: "render_background"]
                                              |
                              [GLSL MAT: "transmission_mat"]
                                 sBackgroundTex ← render_background
                                 uniforms from CHOPs
                                              |
[Geo COMP: Transmission Plane] ──→ [main Render TOP]
  (uses transmission_mat)              also renders keywords + edges
  (plane at z = panel depth)           |
                                       v
                                [Out TOP: final output]
```

### Advantages

- True screen-space refraction -- objects behind the panel appear subtly displaced, not just blurred.
- Single composite render pass (no separate Over TOP needed).
- More faithful to the R3F `MeshTransmissionMaterial` behavior.
- Per-pixel thickness variation possible by encoding thickness in a texture.

### Disadvantages

- More complex to set up and debug.
- The jittered sampling can produce noise at low sample counts. 16 samples is a reasonable starting point; increase to 32 if noise is visible.
- Requires the background layer to be rendered to texture first (same as Approach A).
- Fragment shader cost scales with `uSamples`.

---

## 4. Approach C: Feedback-Based Iterative Blur

TouchDesigner's Feedback TOP can create progressive blur effects that accumulate over frames.

### Concept

Use a Feedback TOP that re-reads its own output and blends it with the current background render, creating a temporal blur effect.

### Network

```
[Render TOP: background] ──→ [Composite TOP: blend]──→ [Out TOP]
                                   ^        |
                                   |        v
                              [Feedback TOP]
                                   ^
                                   |
                              [Blur TOP: small kernel]
```

### Configuration

| Operator | Parameter | Value |
|---|---|---|
| Composite TOP | Operation | Add or Lerp |
| Composite TOP | Mix | 0.1-0.3 (controls convergence speed) |
| Feedback TOP | Reset Pulse | Trigger when camera moves significantly |
| Blur TOP | Size | 2-5 px (small per-frame blur, accumulates) |

### How It Works

1. Each frame, the Feedback TOP reads the previous frame's blurred result.
2. The Composite blends the fresh background render with the accumulated blur.
3. Over 5-10 frames, the blur converges to a stable state.
4. Camera motion or scene changes trigger a reset, and the blur re-converges.

### Advantages

- Very cheap per frame (tiny blur kernel applied once per frame).
- Natural motion blur effect when the scene moves.
- Adjustable convergence rate.

### Disadvantages

- Takes multiple frames to reach stable blur -- visible "smearing in" on camera motion.
- Not suitable if the camera pans continuously (blur never converges).
- Temporal artifacts: ghosting of previous positions during animation.
- Fundamentally different visual character from the R3F effect, which is spatially instant.

**Verdict**: This approach works for static or slowly-moving scenes but is not recommended for an interactive force-directed graph where the camera pans and zooms frequently. Use Approach A or B instead.

---

## 5. TouchDesigner PBR MAT Transmission

### Does TD Support Transmission/Refraction Natively?

TouchDesigner's PBR MAT (physically based rendering material) supports several advanced material properties, but transmission/refraction support is limited compared to Three.js's transmission extension.

**What PBR MAT offers:**

| PBR MAT Feature | Relevant? | Notes |
|---|---|---|
| Roughness | Yes | Controls specular blur but not transmission blur |
| Metallic | No | Not relevant to transmission |
| Opacity / Alpha | Partial | Makes geometry transparent but does not blur what is behind it |
| Refraction | Limited | Some TD versions expose an IOR parameter, but it refracts the environment map, not the scene behind the surface |
| Emission | No | Not relevant |

### Version History and Parameter Details

TouchDesigner's PBR MAT has evolved across releases. The relevant timeline:

- **2021.x and earlier**: PBR MAT supports metallic/roughness workflow with environment reflection. No dedicated transmission parameters. Glass effects require opacity with environment map reflections.
- **2022.x**: PBR MAT adds more advanced environment sampling, but transmission remains environment-map-based. The material can produce convincing glass reflections but does not sample the actual scene behind the surface.
- **2023.x onward**: PBR MAT continues to refine its physically-based model with improved IBL (image-based lighting) and energy conservation. Some experimental builds have explored refraction/transmission parameters (IOR, Refraction Weight), but these operate on the environment cubemap, not a screen-space grab pass.

**Available PBR MAT parameters relevant to glass (when present):**

| Parameter | Type | Range | Behavior |
|---|---|---|---|
| `Opacity` / `Alpha` | float | 0-1 | Reduces surface opacity; reveals whatever is behind in the depth buffer, but without blur |
| `Roughness` | float | 0-1 | Affects specular reflection spread; does NOT blur what is seen through the surface |
| `IOR` (Index of Refraction) | float | 1.0-2.5 | Controls Fresnel reflection angle; may distort environment map sampling direction |
| `Refraction Weight` | float | 0-1 | When available, blends between reflection and refraction of the environment map |
| `Environment Map` | TOP input | texture | Source for reflected/refracted image; typically a cubemap from Environment Light COMP |

### Comparison: TD PBR MAT vs drei MeshTransmissionMaterial

| Capability | drei MeshTransmissionMaterial | TD PBR MAT |
|---|---|---|
| **Source of transmitted image** | Screen-space: renders scene behind the surface into an FBO, then samples it | Environment map: samples a pre-baked or real-time cubemap, not the scene geometry behind the surface |
| **Blur / frosted effect** | Multi-sample jittered texture reads (configurable samples, thickness, roughness) | No transmission blur; roughness only affects specular reflection lobe |
| **Thickness control** | Yes -- scales refraction offset and blur radius per-pixel | No equivalent; opacity is uniform |
| **Anisotropic blur** | Yes -- directional bias on the sampling kernel | No |
| **Dynamic scene content** | Yes -- FBO is re-rendered every frame, so moving objects behind glass are visible and blurred | Only if environment map is updated from a Render TOP, and even then it is a cubemap projection (parallax incorrect for a flat panel) |
| **Performance** | Expensive: extra render pass + N texture samples per pixel | Cheap: standard PBR shading with environment lookup |
| **Physical accuracy** | Approximate (screen-space, not ray-traced) but visually convincing | Physically correct for environment reflections but incorrect for scene transmission |

**The key limitation**: PBR MAT's refraction in TouchDesigner samples the environment map (from an Environment Light COMP or cubemap), not the actual rendered scene behind the surface. This means you get a frosted-glass-like distortion of the environment, but the content nodes behind the panel would not be visible through it.

**Workaround**: You can feed a Render TOP of the background scene into PBR MAT's environment map input, effectively faking scene-based refraction. However, this is a cubemap projection, not screen-space -- it produces incorrect parallax for a flat panel. For it to look plausible:
1. Render background layer to a Render TOP.
2. Convert to equirectangular or cubemap format via a Projection TOP.
3. Feed into an Environment Light COMP as the environment map.
4. Apply PBR MAT with high Roughness + Refraction Weight to the panel geometry.

This is fragile (parallax shifts when camera moves) and produces inferior results compared to approaches A or B.

**Recommendation**: Do not rely on PBR MAT for this effect. Use Approach A (multi-pass Blur TOP) or Approach B (custom GLSL MAT) instead.

---

## 5b. Approach D: Depth-of-Field Post-Processing

An alternative to explicit blur passes is to use camera depth-of-field (DOF) to naturally blur objects at the content layer's depth while keeping the keyword layer sharp. This leverages the z-separation that already exists in the scene.

### Concept

Set the camera's focal plane at z=0 (keyword layer). Objects at z=-150 (content layer) are out of focus and appear blurred. The frosted glass effect emerges from the optical depth-of-field rather than a transmission material.

### How DOF Works in TouchDesigner

TouchDesigner does not have a single "DOF TOP" operator. Instead, DOF is achieved through one of these methods:

**Method 1: Render TOP with depth buffer + GLSL DOF post-process**

1. Render the full scene (both layers) with a Render TOP that outputs a depth buffer.
2. Use a GLSL TOP to implement circle-of-confusion (CoC) based blur:
   - Sample the depth buffer to compute CoC radius per pixel.
   - Blur pixels proportionally to their CoC radius.
   - Pixels at the focal distance (z=0) have CoC=0 (sharp).
   - Pixels at z=-150 have large CoC (blurred).

**Method 2: Post-process component from TD Palette**

TouchDesigner's Palette includes post-processing components that may include DOF. Check `Palette > Tools > Post` for available effects. These wrap GLSL DOF implementations in a reusable component.

**Method 3: Two-layer composite with selective blur (hybrid)**

This is essentially Approach A but motivated by DOF thinking:
1. Render background layer separately.
2. Apply blur proportional to depth distance from focal plane.
3. Composite sharp foreground over blurred background.

### DOF GLSL Implementation

A minimal DOF post-process shader for a GLSL TOP:

```glsl
// DOF post-process: blur based on depth distance from focal plane
// Input 0: color render (full scene)
// Input 1: depth buffer (linearized, 0=near, 1=far)

uniform float uFocalDepth;      // normalized depth of focus (keyword layer)
uniform float uAperture;        // controls blur strength (higher = more blur)
uniform float uMaxBlurRadius;   // maximum blur in pixels (clamp for perf)
uniform vec2 uResolution;

out vec4 fragColor;

void main()
{
    vec2 uv = vUV.st;
    vec2 px = 1.0 / uResolution;

    vec4 color = texture(sTD2DInputs[0], uv);
    float depth = texture(sTD2DInputs[1], uv).r;

    // Circle of confusion: proportional to distance from focal plane
    float coc = abs(depth - uFocalDepth) * uAperture;
    float blurRadius = min(coc * uResolution.y, uMaxBlurRadius);

    if (blurRadius < 0.5) {
        // At focal plane, no blur needed
        fragColor = TDOutputSwizzle(color);
        return;
    }

    // Disc-shaped blur sampling (Poisson or uniform ring)
    vec4 accum = vec4(0.0);
    float totalWeight = 0.0;
    int samples = 16;

    for (int i = 0; i < samples; i++) {
        float angle = float(i) * 6.28318 / float(samples);
        vec2 offset = vec2(cos(angle), sin(angle)) * blurRadius * px;
        float sampleDepth = texture(sTD2DInputs[1], uv + offset).r;

        // Prevent background bleeding into foreground:
        // only accumulate samples that are at similar or greater depth
        float sampleCoc = abs(sampleDepth - uFocalDepth) * uAperture;
        float weight = (sampleDepth >= depth - 0.01) ? 1.0 : 0.1;

        accum += texture(sTD2DInputs[0], uv + offset) * weight;
        totalWeight += weight;
    }

    fragColor = TDOutputSwizzle(accum / totalWeight);
}
```

### Network for DOF Approach

```
[Camera COMP: cam1]
  focal plane at z=0

[All Geometry] ──→ [Render TOP: render_scene]
                     depth output enabled
                            |
                     ┌──────┴──────┐
                     │             │
               [color output] [depth output]
                     │             │
                     └──────┬──────┘
                            │
                     [GLSL TOP: dof_post]
                       Input 0 = color
                       Input 1 = depth
                       uFocalDepth = computed from camera/keyword z
                       uAperture = mapped from thickness param
                            │
                     [Out TOP: final]
```

### Computing Focal Depth from Scene Z

The depth buffer value for a specific world-space Z position depends on the camera's near/far clip planes and projection. To set `uFocalDepth` correctly:

```python
# Python expression for uFocalDepth uniform
import math

cam = op('cam1')
near = cam.par.near.eval()    # e.g., 0.1
far = cam.par.far.eval()      # e.g., 100000
cam_z = cam.par.tz.eval()     # e.g., 10500
focal_z = 0.0                 # keyword layer

# Distance from camera to focal plane (along view axis)
focal_dist = cam_z - focal_z

# Linearized depth (0 = near, 1 = far)
focal_depth_linear = (focal_dist - near) / (far - near)
```

If the Render TOP outputs non-linear (perspective) depth, you need to linearize it in the GLSL shader or use a Depth TOP to linearize first.

### Mapping Thickness to Aperture

```python
# thickness (0-20) maps to aperture for DOF
thickness = op('thickness_slider').par.value0.eval()
# Aperture 0 = everything sharp, higher = stronger blur
aperture = thickness * 2.0  # tune to taste
```

### Advantages

- Single render pass for the scene (no separate background/foreground renders).
- Physically motivated: the blur looks like camera optics, which can be visually appealing.
- Continuous blur gradient: objects at intermediate depths get intermediate blur, not a hard boundary.
- No need for a transmission plane geometry at all.

### Disadvantages

- **Foreground/background bleeding**: DOF post-processing can leak blurred background pixels into sharp foreground edges (the "halo" artifact). The GLSL above mitigates this with depth-aware weighting, but it is not perfect.
- **No refraction distortion**: DOF blurs but does not displace. The frosted glass "refraction wobble" is absent.
- **Blur is depth-based, not panel-based**: You cannot restrict blur to "behind the panel" -- everything at that depth is blurred, even if it is beside the panel rather than behind it. For full-viewport coverage this is fine, but it prevents partial-panel effects.
- **Less artistic control**: The blur radius is determined by optical simulation (CoC formula), not a free parameter. You have to tune aperture and focal distance to get the desired blur amount, which can feel indirect.
- **Performance**: The DOF shader samples the depth buffer per pixel and performs variable-radius blur, which is roughly as expensive as the GLSL refraction approach (Approach B). It is not cheaper than multi-pass Blur TOP for uniform blur.

**Verdict**: DOF works as an alternative if you want a camera-optical look and are always blurring the entire background layer. However, the multi-pass Blur TOP (Approach A) gives more direct control and avoids the halo artifact. DOF is best reserved for cases where you want other scene elements at varying depths to also receive proportional blur (e.g., a multi-layered scene with more than two depth planes).

---

## 6. Detailed Node Network Layout (Approach A)

This is the complete operator graph for the recommended multi-pass approach, including the transmission plane, camera, and all geometry.

### Network Hierarchy

```
/project1/
├── camera1                    [Camera COMP]
│     FOV: 10 degrees
│     Near: 0.1, Far: 100000
│     Translate: driven by CHOPs (x, y, z)
│
├── light1                     [Ambient Light COMP]
│     Dimmer: 1.0
│
├── geo_content_nodes          [Geometry COMP]
│     ├── circle_sop           [Circle SOP] (or Rectangle SOP for rounded rects)
│     ├── instance CHOP refs   positions, colors, scales from Table/Script
│     └── material             [Constant MAT] with vertex colors
│
├── geo_keywords               [Geometry COMP]
│     ├── circle_sop           [Circle SOP] radius=10
│     ├── instance CHOP refs
│     └── material             [Constant MAT] with vertex colors
│
├── geo_edges                  [Geometry COMP]
│     ├── script_sop           [Script SOP] generating arc line geometry
│     └── material             [Constant MAT or Line MAT]
│
├── geo_transmission_plane     [Geometry COMP]
│     ├── grid_sop             [Grid SOP] 1x1, single quad
│     ├── transform_sop        [Transform SOP] scale driven by viewport calc
│     └── material             [Constant MAT] showing blurred texture
│
├── render_background          [Render TOP]
│     Camera: camera1
│     Geometry: geo_content_nodes
│     Resolution: 1920 x 1080
│     BG Alpha: 1.0
│     BG Color: match scene bg
│
├── blur_background            [Blur TOP]
│     Input: render_background
│     Size: driven by thickness param
│     Filter: Gaussian
│     Passes: 3
│     Extend: Mirror
│
├── null_blurred               [Null TOP]
│     Input: blur_background
│     (clean reference point)
│
├── render_foreground          [Render TOP]
│     Camera: camera1
│     Geometry: geo_keywords, geo_edges
│     Resolution: 1920 x 1080
│     BG Alpha: 0.0  (transparent)
│
├── composite_final            [Over TOP]
│     Input 0: render_foreground
│     Input 1: null_blurred
│
├── level_final                [Level TOP]
│     (optional: gamma/contrast adjust)
│
└── out1                       [Out TOP]
      Input: composite_final or level_final
```

### Alternative: Single Render Pass with Textured Plane

Instead of compositing two render passes, you can render everything in one pass by applying the blurred background texture to `geo_transmission_plane`:

```
render_background ──→ blur_background ──→ [applied as texture to geo_transmission_plane]

Main Render TOP:
  Geometry: geo_content_nodes (z=-150)
          + geo_transmission_plane (z = panel depth, textured with blur)
          + geo_keywords (z=0)
          + geo_edges (z=0)
  Camera: camera1
```

In this variant, the transmission plane's Constant MAT samples the blurred texture using screen-space UVs. The plane occludes the actual content geometry behind it, replacing it with the blurred version. This is simpler (one render pass for final output) but requires the plane's UVs to match screen space, which means either:

- A GLSL MAT that computes screen-space UVs in the fragment shader (similar to Approach B but without the jittered sampling), or
- A UV projection setup using a Camera MAP TOP to project the blurred texture from the camera's perspective.

---

## 7. Parameter Mapping

### R3F to TouchDesigner Parameter Translation

| R3F Parameter | R3F Value | TD Equivalent | TD Value / Expression | Notes |
|---|---|---|---|---|
| `transmission` | 0.97 | Constant MAT Opacity or GLSL uniform | 0.97 | In multi-pass approach, this maps to the blend ratio in Over TOP: `opacity = 0.97` on the blurred layer |
| `thickness` | 0-20 | Blur TOP Filter Size | `thickness * 3.0` pixels (at 1080p) | Linear mapping; adjust multiplier based on resolution |
| `roughness` | 1.0 | Blur quality / kernel shape | Gaussian filter, max diffusion | At roughness=1, maximum blur spread for given thickness |
| `anisotropicBlur` | 5.0 | Blur TOP X/Y asymmetry | X size = base * 1.5, Y size = base * 0.7 | Or implement in GLSL with directional kernel |
| `samples` | 16 | Blur TOP Passes | 3-4 passes | In Blur TOP, passes serve a similar quality role. In GLSL approach, map directly to sample count |
| `resolution` | 1024 | Render TOP resolution | 1024x1024 or match output | Background FBO resolution; lower = faster + blurrier |
| `distanceRatio` | configurable | Plane Z translate | `cameraZ * distanceRatio` | Python expression on Transform SOP or Geo COMP |

### Thickness to Blur Size Mapping

The relationship between `thickness` and visual blur depends on output resolution. The R3F implementation renders to a 1024x1024 FBO and applies refraction sampling in texture space, so the blur radius is resolution-independent at the FBO level.

For TouchDesigner at 1920x1080:

```python
# In a Script CHOP or parameter expression:
# thickness ranges 0-20
# blur_size ranges 0-60 pixels at 1080p

thickness = op('thickness_slider').par.value0
blur_size = thickness * 3.0  # pixels

# Scale with resolution for resolution-independence
resolution_scale = op('render_background').par.resy / 1080.0
blur_size_scaled = blur_size * resolution_scale
```

### Distance Ratio to Panel Z Position

```python
# In a Python expression on geo_transmission_plane Transform:
camera_z = op('camera1').par.tz
distance_ratio = op('panel_ratio_slider').par.value0
panel_z = camera_z * distance_ratio
```

---

## 8. Dynamic Sizing -- Making the Panel Track the Camera

The R3F implementation recalculates the panel's position and scale every frame in `useFrame` to ensure it always covers the viewport. In TouchDesigner, this is done with parameter expressions or a Script CHOP.

### The Math

Given a perspective camera with FOV (in degrees) and a panel at depth `panelZ`:

```
distanceToPanel = cameraZ - panelZ
fovRadians = FOV * pi / 180
visibleHeight = 2 * distanceToPanel * tan(fovRadians / 2)
visibleWidth = visibleHeight * aspectRatio
```

The panel (a unit quad from Grid SOP) must be scaled to `visibleWidth * 1.05` by `visibleHeight * 1.05` (5% margin).

### Implementation Options

#### Option 1: Parameter Expressions (Simplest)

On the `geo_transmission_plane` Geometry COMP or its internal Transform SOP:

```python
# Translate X (follows camera)
op('camera1').par.tx

# Translate Y (follows camera)
op('camera1').par.ty

# Translate Z (panel depth)
op('camera1').par.tz * op('panel_ratio').par.value0

# Scale X
import math
cam_z = op('camera1').par.tz
ratio = op('panel_ratio').par.value0
panel_z = cam_z * ratio
dist = cam_z - panel_z
fov_rad = 10.0 * math.pi / 180.0
vis_h = 2.0 * dist * math.tan(fov_rad / 2.0)
aspect = op('render_background').par.resx / op('render_background').par.resy
return vis_h * aspect * 1.05

# Scale Y
# Same as above but without aspect ratio
return vis_h * 1.05
```

#### Option 2: Script CHOP (More Robust)

A Script CHOP that outputs `tx`, `ty`, `tz`, `sx`, `sy` channels, driven by camera position:

```python
import math

def onCook(scriptOp):
    cam = op('camera1')
    cam_z = cam.par.tz.eval()
    cam_x = cam.par.tx.eval()
    cam_y = cam.par.ty.eval()
    ratio = op('panel_ratio').par.value0.eval()

    panel_z = cam_z * ratio
    dist = cam_z - panel_z

    if dist <= 0:
        # Invalid state, hide panel
        scriptOp['sx'].val = 0
        scriptOp['sy'].val = 0
        return

    fov_rad = 10.0 * math.pi / 180.0
    vis_h = 2.0 * dist * math.tan(fov_rad / 2.0)
    aspect = op('render_background').par.resx.eval() / max(1, op('render_background').par.resy.eval())
    vis_w = vis_h * aspect

    margin = 1.05

    scriptOp['tx'].val = cam_x
    scriptOp['ty'].val = cam_y
    scriptOp['tz'].val = panel_z
    scriptOp['sx'].val = vis_w * margin
    scriptOp['sy'].val = vis_h * margin
```

Wire this Script CHOP's outputs to the Geometry COMP's translate and scale parameters via CHOP exports.

#### Option 3: Screen-Aligned Quad (Bypass Sizing Entirely)

Instead of sizing a 3D plane, render the blurred background as a full-screen quad in the composite step. This eliminates the need to track the camera at all:

- `render_background` captures the background scene.
- `blur_background` blurs it.
- `Over TOP` composites the foreground render over the blurred background.

The "panel" is implicit -- it is the entire background layer being blurred. This is the simplest approach and avoids all the sizing math. The trade-off is that you lose the ability to have a panel that covers only part of the viewport (e.g., a floating frosted rectangle), but for the TopicsView use case where the panel always covers the full viewport, this is equivalent.

**Recommendation**: Use Option 3 (screen-aligned full composite) unless you specifically need a partial-coverage panel or want the panel to be visible as a distinct surface in the 3D scene.

---

## 9. Performance Considerations

### Approach Comparison -- GPU Cost Summary

| Approach | Render Passes | Per-Pixel Cost | Total 1080p Cost | Scaling Lever |
|---|---|---|---|---|
| **A: Multi-pass Blur TOP** | 2 Render TOPs + 1 Blur + 1 Over | Separable Gaussian (cheap per pixel) | 1.4-2.6 ms | Render at half res, reduce blur passes |
| **B: GLSL MAT refraction** | 1 Render TOP (bg) + 1 main render | N texture lookups per pixel on glass region | 1.5-3.0 ms | Reduce sample count, lower bg resolution |
| **C: Feedback blur** | 1 Render + 1 small Blur + 1 Feedback + Composite | Tiny per-frame, but converges over frames | 0.5-1.0 ms per frame (but temporal artifacts) | Reduce feedback mix rate |
| **D: DOF post-process** | 1 Render (with depth) + 1 GLSL DOF | N samples per pixel, variable radius | 1.5-3.5 ms | Reduce sample count, cap max blur radius |
| **drei MeshTransmissionMaterial** | 1 FBO render + main render | 16 jittered texture samples per pixel | 2-5 ms | Reduce `samples`, lower `resolution` |

TouchDesigner's native Blur TOP has a significant advantage over GLSL multi-sample approaches: the separable Gaussian implementation (horizontal pass then vertical pass) achieves O(2*radius) texture reads per pixel regardless of blur radius, compared to O(samples) for disc-based sampling. For a radius-30 blur, Blur TOP does ~60 texture reads in two passes, while a 16-sample disc blur does 16 reads but with lower quality (more noise, less smooth).

### Render TOP Resolution

The main cost driver is the background Render TOP resolution and the Blur TOP kernel size.

| Resolution | Blur Size 30px | Blur Size 60px | Notes |
|---|---|---|---|
| 512x512 | Very fast | Fast | Acceptable for heavy blur (detail hidden anyway) |
| 1024x1024 | Fast | Moderate | Good balance; matches R3F default |
| 1920x1080 | Moderate | Expensive | Only needed for minimal blur / sharp edges |

**Tip**: Since the background layer will be blurred, you can render it at half resolution (e.g., 960x540) and let the Blur TOP smooth out the lower resolution. This cuts render cost by 75% with negligible quality loss for `thickness > 5`.

To downsample the Render TOP output:
- Option 1: Set the Render TOP's Resolution parameters directly to 960x540.
- Option 2: Render at full res, then insert a Resolution TOP set to half resolution before the Blur TOP. This lets you keep the full-res render available for other uses.

### Blur TOP Performance

| Passes | Kernel Size | GPU Cost | Visual Quality |
|---|---|---|---|
| 1 | 30 | Low | Boxy, visible artifacts |
| 2 | 15+15 | Low-Medium | Good, slight stepping |
| 3 | 10+10+10 | Medium | Smooth, no visible artifacts |
| 4 | 8+8+8+8 | Medium-High | Diminishing returns vs. 3 |

Multi-pass Gaussian blur (separable, horizontal then vertical per pass) is the standard approach. TouchDesigner's Blur TOP handles this internally when you set Passes > 1.

**Why TD's native blur is faster than drei's approach**: drei's `MeshTransmissionMaterial` performs 16 random-offset texture lookups per pixel across the entire glass surface. This is a stochastic approximation of a blur kernel. TD's Blur TOP uses a mathematically exact separable Gaussian convolution, which is both higher quality (no noise) and more efficient for large radii. The trade-off is that Blur TOP cannot produce the refraction displacement effect -- it is a uniform blur, not a physically-motivated transmission.

### GLSL MAT Performance (Approach B)

The custom GLSL fragment shader cost scales linearly with `uSamples`. At 16 samples on a full-viewport quad at 1080p, you are executing approximately 33 million texture lookups per frame (1920 * 1080 * 16). This is well within modern GPU capability but not free.

| Samples | 1080p Cost | 4K Cost |
|---|---|---|
| 8 | Trivial | Low |
| 16 | Low | Medium |
| 32 | Medium | High |
| 64 | High | Very High |

**Recommendation**: Start with 16 samples. If performance is tight, drop to 8 and increase the per-sample blur radius to compensate.

### DOF Post-Process Performance (Approach D)

DOF is roughly equivalent to the GLSL MAT approach in cost because it also performs multiple texture samples per pixel with variable radius. The additional depth buffer read adds minor overhead. The main cost difference is that DOF processes every pixel in the frame (not just the glass region), though pixels near the focal plane early-out with zero blur.

### Total Frame Budget Impact

For a typical setup (1080p output, 500 keyword nodes, 1000 content nodes):

| Component | Estimated Cost | Notes |
|---|---|---|
| Background Render TOP | 0.5-1.0 ms | Instanced content nodes, simple material |
| Blur TOP (3 passes, size 30) | 0.3-0.5 ms | Separable Gaussian, GPU-bound |
| Foreground Render TOP | 0.5-1.0 ms | Keywords + edges |
| Over TOP composite | 0.1 ms | Trivial |
| **Total frosted glass overhead** | **1.4-2.6 ms** | ~8-15% of 16ms frame budget at 60fps |

This is manageable. The equivalent R3F `MeshTransmissionMaterial` with 16 samples costs 2-5 ms, so the multi-pass approach is competitive or cheaper.

### Profiling in TouchDesigner

Use TD's built-in performance tools to measure actual GPU cost:
- **Performance Monitor** (Alt+Y or `Window > Performance Monitor`): shows per-operator cook time.
- **GPU Timing**: Enable "GPU Direct Timing" in the Performance Monitor to see actual GPU execution time (not just CPU submission time).
- **Render TOP Stats**: Each Render TOP shows its render time in its info CHOP/DAT.
- **Halo indicator**: Operators with high cook times show an orange/red halo in the network editor.

---

## 10. Putting It Together -- Minimal Working Example

### Step-by-Step Build Instructions

1. **Create a Camera COMP** (`/project1/camera1`)
   - FOV: 10
   - Near Clip: 0.1
   - Far Clip: 100000
   - Translate Z: 10500 (initial zoom level)

2. **Create content node geometry** (`/project1/geo_content`)
   - Inside: Circle SOP (or Rectangle SOP with fillet for rounded rects)
   - Enable instancing on the Geometry COMP
   - Instance Source: Table DAT or CHOP with columns: tx, ty, tz (set tz = -150), r, g, b, sx, sy
   - Material: Constant MAT with "Use Vertex Color" enabled

3. **Create keyword node geometry** (`/project1/geo_keywords`)
   - Inside: Circle SOP, radius = 10
   - Same instancing pattern, tz = 0
   - Material: Constant MAT with vertex colors

4. **Create Render TOP for background** (`/project1/render_bg`)
   - Camera: `camera1`
   - Geometry: `geo_content` only
   - Resolution: 1024 x 1024
   - Background: match scene background color

5. **Create Blur TOP** (`/project1/blur_bg`)
   - Input: `render_bg`
   - Size X/Y: 20 (start here, tune to taste)
   - Filter: Gaussian
   - Passes: 3

6. **Create Render TOP for foreground** (`/project1/render_fg`)
   - Camera: `camera1`
   - Geometry: `geo_keywords` (and `geo_edges` if present)
   - Resolution: 1920 x 1080
   - Background Alpha: 0 (transparent)

7. **Create Over TOP** (`/project1/composite`)
   - Input 0: `render_fg`
   - Input 1: `blur_bg`
   - Pre-Multiply: auto

8. **Create Out TOP** (`/project1/out1`)
   - Input: `composite`

9. **Verify**: You should see blurred content nodes as background with crisp keyword circles on top.

10. **Add interactivity**: Wire a Slider COMP (`thickness_slider`, range 0-20) to the Blur TOP's Size parameter:
    ```
    op('thickness_slider').par.value0 * 3.0
    ```

### Extending with Panel Depth Control

To add the `distanceRatio` control (making blur intensity vary with panel position):

- The `distanceRatio` does not directly change blur strength in the multi-pass approach since the blur is applied in 2D texture space, not at a 3D depth.
- However, you can simulate depth-dependent blur by modulating the Blur TOP size based on `distanceRatio`: when the panel is closer to the camera (high ratio), more of the scene is "behind" it and should be blurrier.

```python
# Blur size expression that accounts for panel distance
thickness = op('thickness_slider').par.value0
ratio = op('ratio_slider').par.value0
# More blur when panel is closer to camera (higher ratio)
effective_blur = thickness * 3.0 * (0.5 + ratio * 0.5)
```

---

## 11. Dynamic Thickness -- Zoom-Responsive Blur

In the R3F implementation, the transmission panel's z-position moves as the camera zooms: `panelZ = cameraZ * distanceRatio`. As the camera zooms in (cameraZ decreases), the panel moves closer to the content layer and the visual blur effect changes. This section details how to replicate dynamic, zoom-responsive blur in each TD approach.

### Understanding the R3F Dynamic Behavior

The R3F `MeshTransmissionMaterial` thickness parameter controls how much the refraction samples spread. The panel's z-position affects what is visible through it (perspective changes), but the blur intensity itself is controlled by the `thickness` uniform, which in the current implementation is tied to a UI slider, not directly to camera distance.

However, the *perceived* frosted effect changes with zoom because:
1. As the camera zooms in, the panel-to-content distance shrinks, so content appears larger and the fixed blur radius covers fewer content features.
2. As the camera zooms out, content is small and the same blur radius smears it more aggressively.

To replicate this perceptual scaling in TD, blur intensity should respond to camera distance.

### Approach A (Multi-Pass Blur TOP): Drive Filter Size from Camera Z

The most direct method: compute blur radius as a function of camera distance and panel position.

```python
# Python expression on blur_background Blur TOP's Filter Size parameter:
import math

cam_z = op('camera1').par.tz.eval()
thickness = op('thickness_slider').par.value0.eval()  # 0-20
ratio = op('panel_ratio').par.value0.eval()

# Distance from panel to content layer
panel_z = cam_z * ratio
content_z = -150.0
panel_to_content = abs(panel_z - content_z)

# Base blur from thickness
base_blur = thickness * 3.0

# Scale blur by how much of the viewport the content occupies
# When zoomed in, content is large -> need less blur to frost it
# When zoomed out, content is tiny -> need more blur
fov_rad = math.radians(10.0)
vis_height = 2.0 * cam_z * math.tan(fov_rad / 2.0)
# Content rect is ~30 world units; ratio of content to viewport
content_screen_fraction = 30.0 / max(vis_height, 1.0)

# Modulate blur: more blur when content is small on screen
zoom_factor = max(0.3, min(2.0, 0.01 / max(content_screen_fraction, 0.001)))
effective_blur = base_blur * zoom_factor

# Resolution-independent scaling
res_scale = op('render_background').par.resy.eval() / 1080.0
return effective_blur * res_scale
```

A simpler linear mapping that works well in practice:

```python
# Simpler version: blur proportional to camera distance
cam_z = op('camera1').par.tz.eval()
thickness = op('thickness_slider').par.value0.eval()

# Normalize camera Z: 0 at minimum zoom, 1 at maximum zoom
t = max(0.0, min(1.0, (cam_z - 100.0) / (10500.0 - 100.0)))

# More blur when zoomed out, less when zoomed in
# Range: thickness*1.0 at closest to thickness*3.0 at farthest
return thickness * (1.0 + t * 2.0)
```

### Approach B (GLSL MAT): Animate Uniforms via CHOP Export

For the GLSL refraction shader, drive the `uThickness` and `uBlurRadius` uniforms dynamically:

```python
# Script CHOP producing control channels for GLSL MAT uniforms
import math

def onCook(scriptOp):
    scriptOp.clear()

    thickness_ch = scriptOp.appendChan('uThickness')
    blur_ch = scriptOp.appendChan('uBlurRadius')
    transmission_ch = scriptOp.appendChan('uTransmission')

    scriptOp.numSamples = 1

    cam_z = op('camera1').par.tz.eval()
    thickness = op('thickness_slider').par.value0.eval()
    ratio = op('panel_ratio').par.value0.eval()

    # Normalize zoom
    t = max(0.0, min(1.0, (cam_z - 100.0) / (10500.0 - 100.0)))

    # Thickness scales with zoom: thicker glass effect when zoomed out
    thickness_ch[0] = thickness * (0.5 + t * 1.5)

    # Blur radius in UV space: larger when zoomed out
    blur_ch[0] = thickness * 0.005 * (0.5 + t * 1.0)

    # Transmission stays constant
    transmission_ch[0] = 0.97
```

Wire this Script CHOP to the GLSL MAT's custom uniforms via CHOP export:
1. On the Script CHOP, enable the **Export** flag.
2. In the Export page, map `uThickness` channel to `glslmat_glass/uThickness`.
3. Map `uBlurRadius` channel to `glslmat_glass/uBlurRadius`.

Alternatively, reference the CHOP directly in the GLSL MAT's uniform parameter fields:
```
op('chop_glass_controls')['uThickness']
```

### Approach D (DOF): Drive Aperture from Camera Z

For the DOF post-process, the aperture parameter controls blur strength. Drive it from camera distance:

```python
# Python expression on the GLSL TOP's uAperture uniform
cam_z = op('camera1').par.tz.eval()
thickness = op('thickness_slider').par.value0.eval()

# Normalize zoom position
t = max(0.0, min(1.0, (cam_z - 100.0) / (10500.0 - 100.0)))

# More aperture (stronger blur) when zoomed out
return thickness * 2.0 * (0.3 + t * 0.7)
```

### Smoothing Dynamic Changes

Abrupt blur changes during zoom can be visually jarring. Apply smoothing:

**Option 1: Filter CHOP (recommended)**
```
Script CHOP (raw values) ──→ Filter CHOP (lag = 0.1s) ──→ export to Blur TOP / GLSL MAT
```
The Filter CHOP applies exponential smoothing with configurable lag time.

**Option 2: Lag CHOP**
```
Script CHOP ──→ Lag CHOP (lag = 3 frames) ──→ export
```
The Lag CHOP delays value changes by a fixed number of frames, creating smooth transitions.

**Option 3: In the Python expression**
```python
# Exponential smoothing in the Script CHOP
prev = scriptOp.storage.get('prev_blur', 0)
target = computed_blur_value
smoothing = 0.15  # 0 = instant, 1 = never changes
smoothed = prev + (target - prev) * (1.0 - smoothing)
scriptOp.storage['prev_blur'] = smoothed
blur_ch[0] = smoothed
```

---

## 11b. Additional Variations

### Partial Panel (Not Full-Screen)

If you want the frosted panel to cover only a portion of the viewport (e.g., a floating frosted rectangle):

1. Use the GLSL MAT approach (Approach B) on a sized 3D plane.
2. The plane clips the blur effect to its boundaries.
3. Content visible outside the plane remains unblurred.
4. This requires the full sizing math from section 8.

### Color Tint

The R3F panel has `transmission=0.97`, meaning 3% of light is absorbed/reflected by the panel surface. To replicate this subtle tint:

- Insert a Level TOP between Blur TOP and Over TOP.
- Reduce brightness by 3%: Brightness = 0.97.
- Optionally add a very slight color shift (e.g., warm tint for glass feel).

### Multiple Panel Layers

For deeper frosted effects, you can stack multiple blur passes at different depths, each with different blur intensities. This simulates thick glass with internal scattering but is rarely necessary for the TopicsView use case.

---

## 12. Summary of Recommendations

| Decision | Recommendation | Rationale |
|---|---|---|
| Primary approach | **Approach A: Multi-pass Blur TOP** | Simplest, most debuggable, good performance |
| When to use GLSL MAT | When you need true refraction distortion or partial-coverage panels | More complex but more faithful to R3F behavior |
| DOF post-process | Use when you have a multi-depth scene and want optical blur feel | Works well for full-viewport blur, but less direct control and halo artifacts |
| Feedback approach | Avoid for interactive graphs | Temporal convergence artifacts during camera motion |
| PBR MAT transmission | Do not use | Samples environment map, not scene geometry; no frosted blur effect |
| Background resolution | 1024x1024 or half output resolution | Blur hides resolution loss; saves render cost |
| Blur passes | 3 | Good quality without excessive cost |
| Panel sizing | Full-screen composite (skip 3D plane sizing) | Simpler; TopicsView panel always covers viewport |
| Thickness mapping | `thickness * 3.0` pixels at 1080p | Matches visual weight of R3F thickness parameter |
| Dynamic blur | Drive Blur TOP size from camera Z via Script CHOP + Filter CHOP for smoothing | Replicates zoom-responsive frosted glass behavior |
| Performance target | 1.5-2.5 ms total overhead | Competitive with drei's 2-5 ms; well within 60fps budget |

### Quick Reference -- Minimum Viable Frosted Glass

Five operators total:

```
Render TOP (background, content geo) ──→ Blur TOP (size 20, 3 passes) ──→ Over TOP ──→ Out TOP
Render TOP (foreground, keyword geo, transparent bg) ────────────────────↗
```

This gives you 90% of the visual effect with minimal complexity.
