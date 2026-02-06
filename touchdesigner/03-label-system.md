# Label/Text Rendering System -- R3F to TouchDesigner Conversion

This document covers the conversion of the label overlay subsystem from the R3F force-directed keyword graph visualization to TouchDesigner. The label system is the most complex subsystem in the project (~1200 lines across `label-overlays.ts`, `LabelsOverlay.tsx`, `LabelsUpdater.tsx`, and supporting CSS), responsible for rendering four distinct label types as DOM elements overlaid on a WebGL canvas.

## Table of Contents

1. [Source Architecture Summary](#1-source-architecture-summary)
2. [Approach A: Text TOP Per Label](#2-approach-a-text-top-per-label)
3. [Approach B: SDF Font Rendering in GLSL](#3-approach-b-sdf-font-rendering-in-glsl)
4. [Approach C: Texture Atlas with Instanced Quads](#4-approach-c-texture-atlas-with-instanced-quads)
5. [Approach D: Panel COMP Overlay](#5-approach-d-panel-comp-overlay)
6. [Approach E: Web Render TOP](#6-approach-e-web-render-top)
7. [Hybrid Architecture Recommendation](#7-hybrid-architecture-recommendation)
8. [World-to-Screen Projection](#8-world-to-screen-projection)
9. [Visibility, Opacity, and Font Scaling](#9-visibility-opacity-and-font-scaling)
10. [Hover and Interactive Labels](#10-hover-and-interactive-labels)
11. [Performance Analysis](#11-performance-analysis)
12. [Implementation Code](#12-implementation-code)

---

## 1. Source Architecture Summary

### Label Types and Their Roles

The R3F system renders four distinct label types, each with different visibility rules, styling, and update frequency:

| Label Type | Count | Text Length | Font Size | Visibility Rule | Update Frequency |
|---|---|---|---|---|---|
| **Cluster** | 5-20 | 2-5 words | 18px bold | Always visible when cluster exists, opacity scaled by `visibilityRatio` | Every frame (positions track centroid) |
| **Keyword** | 50-200 visible (of 500 total) | 1-3 words | 42px base, zoom-scaled | Degree threshold + zoom range (`keywordLabels.start` to `keywordLabels.full`) | Every frame (positions track nodes) |
| **Content** | 10-50 visible (of 1000 total) | Markdown paragraphs | 6px base, proportional to rect | When zoomed in (content crossfade), minimum screen size 50px | Every frame (positions track content nodes) |
| **Hover** | 0-1 | 1-3 words | 1.5x keyword size | Within 30 world-unit radius of cursor | Every frame (cursor tracking) |

### Data Flow

```
LabelsUpdater (inside Canvas, useFrame loop)
  --> reads camera.position into cameraStateRef
  --> calls labelManager.updateClusterLabels(nodes)
  --> calls labelManager.updateKeywordLabels(nodes, degrees)
  --> calls labelManager.updateContentLabels(nodes, parentColors)
  --> calls labelManager.updateLabelOpacity(scales)
  --> calls labelManager.updateHoverLabel(nodes)

LabelsOverlay (outside Canvas, DOM sibling)
  --> creates LabelOverlayManager with worldToScreen functions
  --> manages DOM element caches (Map<id, HTMLDivElement>)
  --> renders React portals for markdown content into chunk labels
```

### Key Behaviors to Replicate

1. **Degree-based filtering**: Only keywords with `degree >= threshold` show labels. The threshold varies continuously with camera Z: at `keywordLabels.start` (Z=13961) the threshold is `Infinity` (no labels), at `keywordLabels.full` (Z=1200) the threshold is `0` (all labels). Between those values, the threshold is linearly interpolated as `t * maxDegree`.

2. **Zoom crossfade**: Keyword label opacity = `t` (0 at near, 1 at far). Content label opacity = `(1-t)^2` (exponential fade-in when close). The crossfade range is `chunkCrossfade: { near: 50, far: 10347 }`.

3. **Change-detection DOM updates**: The system uses `updateLabelStyles()` to avoid layout thrashing. Style properties are only written to the DOM when the new value differs from the cached value by more than a threshold (1px for position, 0.5 for font size). This reduces layout recalculation from 5-20ms to <2ms per frame.

4. **Off-screen culling**: Labels outside the container bounds (with padding) are hidden via `display: none`.

5. **Search opacity overlay**: When a semantic search is active, each label's opacity is multiplied by a per-node search relevance score (0.0 to 1.0).

6. **Theme-aware styling**: Labels use CSS classes for light/dark mode colors, text shadows, and glow effects via `prefers-color-scheme`.

---

## 2. Approach A: Text TOP Per Label

### How Text TOP Works

TouchDesigner's Text TOP renders a string into a raster texture (a TOP image). Text is laid out and rasterized CPU-side (likely using a system text rendering library such as FreeType or DirectWrite on Windows), then uploaded to GPU texture memory. Each Text TOP is a separate operator with its own cook lifecycle.

### Key Parameters

Access parameter names for your specific build via Python:
```python
t = op('text1')
[(p.name, p.label, p.page) for p in t.pars()]
```

Common parameters (exact names may vary by TD version):

| Parameter | Purpose | Python Access |
|---|---|---|
| `text` | String content | `op('text1').par.text = 'hello'` |
| `font` / `fontface` | Font family | `op('text1').par.font = 'Arial'` |
| `fontsize` / `fontsizex` | Font size in pixels | `op('text1').par.fontsize = 18` |
| `bold`, `italic` | Style toggles | `op('text1').par.bold = True` |
| `alignx`, `aligny` | Horizontal/vertical alignment | `op('text1').par.alignx = 1` (center) |
| `fontr/g/b/a` | Text color RGBA | `op('text1').par.fontr = 1.0` |
| `bgcolorr/g/b/a` | Background color | `op('text1').par.bgcolora = 0` (transparent) |
| `resolutionw/h` | Output texture resolution | `op('text1').par.resolutionw = 256` |
| `wordwrap` | Enable word wrapping | `op('text1').par.wordwrap = True` |

### Dynamic Creation and Destruction via Python

Text TOPs can be created and destroyed at runtime:

```python
# Create a Text TOP inside the current component
t = parent().create('textTOP', 'label_42')
t.par.text = 'machine learning'
t.par.fontsize = 24
t.par.bgcolora = 0  # Transparent background

# Destroy when no longer needed
op('label_42').destroy()
```

**Overhead**: Creating/destroying operators triggers network graph rebuilds, resource allocation, and cooking graph updates. This is significantly more expensive than, say, updating a parameter. Creating 200 operators in a loop will cause a visible frame hitch. Best practice is to **pool operators** (create once at startup, reuse by changing parameters) rather than creating/destroying per frame.

### Performance Ceiling

The Text TOP performance limit is **operator-overhead-bound and update-frequency-bound**, not a hard number. Key factors:

- **Per-operator overhead**: Each Text TOP participates in TD's cooking graph. Even when not changing, operators have baseline overhead for dependency checking, memory footprint, and parameter evaluation.
- **Rasterization cost**: When text content, font size, or styling changes, the CPU must re-rasterize and re-upload the texture. This cost scales with output resolution and font complexity.
- **Compositing cost**: Stacking Text TOPs via Over TOP or Composite TOP creates a chain of texture reads/writes.

**Practical limits** (from community experience and profiling):

| Scenario | Comfortable Ceiling | Performance Degrades |
|---|---|---|
| Static text, no per-frame updates | ~100-200 TOPs | 300+ |
| Text updated every frame | ~30-50 TOPs | 100+ |
| High-resolution output (512x128 per label) | ~50-100 TOPs | 150+ |
| Low-resolution output (128x32 per label) | ~100-200 TOPs | 300+ |

These are approximate. Profile with TD's **Performance Monitor** (Alt+Y) for your specific project.

### Compositing Many Text TOPs

To combine Text TOP outputs into a single texture:

- **Over TOP**: Alpha-composites two inputs. Chaining N Over TOPs for N labels creates a deep operator chain -- O(N) depth.
- **Composite TOP**: Can take multiple inputs and composite them in one operator, but there are practical limits on input count.
- **GLSL TOP with multiple inputs**: More flexible, but input count is still limited per operator.

For more than ~20 labels, compositing via Over/Composite chains becomes both slow and unwieldy to manage in the network editor.

### Verdict

**Not viable as the primary label rendering system.** With 200-500 keyword labels plus cluster and content labels, this means 300-700+ Text TOPs -- far beyond the comfortable ceiling. The per-operator overhead alone would consume the frame budget.

**Acceptable for**: A single hover label (1 Text TOP), or a small fixed set of static labels (up to ~10-20).

---

## 3. Approach B: SDF Font Rendering in GLSL

### How SDF Text Rendering Works

Signed Distance Field (SDF) font rendering stores distance-to-edge information rather than rasterized pixels. For each texel in the font atlas, the value represents the signed distance from that point to the nearest glyph edge: positive inside the glyph, negative outside (or vice versa, depending on convention). At render time, a fragment shader samples this distance and applies a threshold to produce crisp edges at any scale.

**Multi-channel SDF (MSDF)** uses three color channels (RGB), each storing a distance field with slightly different edge definitions. This preserves sharp corners that single-channel SDF loses. The median of the three channels reconstructs the true distance.

### Advantages Over Bitmap Text

- **Resolution-independent**: A single 64x64 glyph SDF texture can render cleanly from ~8px to ~200px screen size. No atlas LODs needed.
- **GPU-native effects**: Outlines, glows, drop shadows, and soft edges come from simple distance threshold manipulation -- no extra rendering passes.
- **Scales with instancing**: One draw call renders thousands of glyphs.

### Generating an SDF Font Atlas

**Tool: msdfgen / msdf-atlas-gen** (open source, widely used)

```bash
# Generate MSDF atlas from a TrueType font
msdf-atlas-gen -font InterVariable.ttf -type msdf \
  -size 48 -pxrange 4 \
  -charset ascii \
  -imageout font_atlas.png \
  -json font_metrics.json
```

This produces:
1. **Atlas image** (`font_atlas.png`): RGBA texture with MSDF data in RGB channels
2. **Metrics file** (`font_metrics.json`): Per-glyph data including:
   - `planeBounds`: quad size in normalized font units (left, bottom, right, top)
   - `atlasBounds`: UV rectangle in atlas pixels (left, bottom, right, top)
   - `advance`: horizontal cursor movement after this glyph
   - `unicode`: character code point

**Alternative tools**: Hiero (bitmap-focused, less SDF support), fontbm, msdf-bmfont-xml.

### GLSL Shader for MSDF Text

**Median-of-three technique** for MSDF sampling:

```glsl
float median(float r, float g, float b) {
    return max(min(r, g), min(max(r, g), b));
}

// In fragment shader:
vec3 msd = texture(uFontAtlas, atlasUV).rgb;
float sd = median(msd.r, msd.g, msd.b);

// Threshold at 0.5 (where the distance field crosses zero)
float w = fwidth(sd);   // screen-space derivative for anti-aliasing
float alpha = smoothstep(0.5 - w, 0.5 + w, sd);

// For outline/glow: offset the threshold
float outlineAlpha = smoothstep(0.3 - w, 0.3 + w, sd);
```

### Implementation Architecture in TouchDesigner

To render SDF text in TD, you need **per-glyph instancing**:

```
Font Atlas (Movie File In TOP) --> GLSL MAT texture input
Font Metrics (Table DAT)       --> drives instance generation

For each label string:
  1. Look up each character in metrics table
  2. Compute glyph position: x_cursor += advance, apply kerning
  3. Output per-glyph instance: (position, atlas UV rect, color, opacity)

All glyphs for all labels --> single Geometry COMP with instancing
  Rectangle SOP (1 quad)
  Instance CHOP: tx, ty, sx, sy, u0, v0, u1, v1, r, g, b, a
  GLSL MAT: MSDF sampling + instance attribute consumption
```

### Feasibility Assessment: 200 Labels x 15 Characters = 3000 Glyphs

**Geometry**: 3000 instanced quads is trivial for any modern GPU. TD's instancing pipeline handles this well.

**CPU bottleneck -- glyph layout**: Computing 3000 glyph positions every frame (when labels move or zoom changes) requires:
- Looking up advance/kerning per character pair
- Accumulating cursor positions per string
- Transforming to screen space

In a Script CHOP, this Python loop runs at approximately 0.5-2ms for 3000 glyphs (depending on hardware and Python overhead). Acceptable, but not free.

**CHOP channel cooking**: Feeding 3000 samples across 12 channels (tx, ty, sx, sy, u0, v0, u1, v1, r, g, b, a) is 36,000 floats. CHOP cooking overhead is generally manageable at this scale.

### Per-Label Variable Opacity and Multi-Color

Yes. Per-glyph instance attributes support:
- **Variable opacity**: Set per-glyph `a` channel. All glyphs in a label share the same alpha, driven by zoom crossfade and degree filtering.
- **Multi-color**: Set per-glyph `r, g, b` channels. Different labels can have different colors (cluster colors, search highlighting).
- **Per-glyph effects**: Theoretically possible (e.g., character-by-character fade-in), but adds layout complexity.

### Complexity Assessment

| Component | Effort | Notes |
|---|---|---|
| Generate MSDF atlas | Low | One-time tooling, msdf-atlas-gen handles it |
| Load atlas + metrics into TD | Low | Movie File In TOP + Table DAT |
| Glyph layout engine (Python) | Medium-High | Character positioning, kerning, multi-line wrapping |
| GLSL MAT for MSDF rendering | Medium | Median-of-three sampling, instance attributes |
| Integration with label system | High | Wire up zoom scaling, degree filtering, search opacity |
| Unicode / special characters | Medium | Depends on character set needed |
| **Total from-scratch effort** | **2-4 weeks** | For a developer with GLSL + TD experience |

### Comparison: SDF Per-Glyph vs Pre-Rendered Label Atlas

| Factor | SDF Per-Glyph | Pre-Rendered Atlas |
|---|---|---|
| Zoom quality | Sharp at all scales | Blurs when upscaled beyond bake resolution |
| Implementation effort | 2-4 weeks | 1-2 weeks |
| Per-frame CPU cost | Higher (glyph layout every frame) | Lower (only position/opacity updates) |
| Dynamic text changes | Immediate (just update glyph buffer) | Requires atlas rebake (100-500ms) |
| Markdown / rich text | Not supported | Not supported |
| Glow / outline effects | Built-in via distance threshold | Requires baking or shader approximation |
| Multi-line word wrap | Must implement in layout engine | Handled at bake time by Pillow / Text TOP |
| Memory | Small atlas (~1-4MB) + glyph buffers | Larger atlas (~16-64MB) |

**Recommendation**: Start with pre-rendered label atlas (faster to implement). Upgrade to SDF if zoom-dependent blur becomes unacceptable or if label text changes frequently enough that atlas rebaking is a bottleneck.

---

## 4. Approach C: Texture Atlas with Instanced Quads

This is the **recommended primary approach** for keyword and cluster labels.

### Concept

1. **Bake step** (on data change, not per frame): Render all label strings into a single large texture atlas using Python (Pillow) or TD's Text TOP.
2. **Instance rendering** (per frame): Render one instanced quad per visible label, with per-instance position, scale, color, opacity, and UV sub-region.
3. **Single draw call**: All labels of a given type render in one instanced Geometry COMP.

### Atlas Baking via Pillow

TD's Python environment includes (or can include) Pillow. The bake runs at startup or when label data changes.

```python
from PIL import Image, ImageDraw, ImageFont
import math

def bake_label_atlas(labels, atlas_width=4096, font_path='fonts/Inter.ttf',
                     font_size=48, padding=6):
    """
    labels: list of (label_id, text, label_type)
    Returns: (atlas_image, placements_dict)
    """
    font = ImageFont.truetype(font_path, font_size)

    # 1. Compute tile sizes
    tiles = []
    for label_id, text, label_type in labels:
        lines = text.split('\n')
        max_w = max(font.getlength(line) for line in lines)
        line_h = font_size * 1.4
        total_h = len(lines) * line_h
        tiles.append({
            'id': label_id, 'text': text, 'type': label_type,
            'w': int(max_w + padding * 2),
            'h': int(total_h + padding * 2),
        })

    # 2. Shelf-pack into atlas
    tiles.sort(key=lambda t: -t['h'])
    shelf_y, shelf_h, cursor_x = 0, 0, 0
    for tile in tiles:
        if cursor_x + tile['w'] > atlas_width:
            shelf_y += shelf_h
            shelf_h, cursor_x = 0, 0
        tile['x'], tile['y'] = cursor_x, shelf_y
        cursor_x += tile['w']
        shelf_h = max(shelf_h, tile['h'])

    atlas_height = 2 ** math.ceil(math.log2(max(shelf_y + shelf_h, 1)))

    # 3. Render text
    atlas = Image.new('RGBA', (atlas_width, atlas_height), (0, 0, 0, 0))
    draw = ImageDraw.Draw(atlas)
    for tile in tiles:
        for j, line in enumerate(tile['text'].split('\n')):
            draw.text(
                (tile['x'] + padding, tile['y'] + padding + j * font_size * 1.4),
                line, font=font, fill=(255, 255, 255, 255)
            )

    # 4. Build UV lookup
    placements = {}
    for tile in tiles:
        placements[tile['id']] = {
            'u0': tile['x'] / atlas_width,
            'v0': tile['y'] / atlas_height,
            'u1': (tile['x'] + tile['w']) / atlas_width,
            'v1': (tile['y'] + tile['h']) / atlas_height,
            'tw': tile['w'], 'th': tile['h'],
        }

    return atlas, placements
```

**Loading into TD**: Save the atlas to disk as PNG, load via Movie File In TOP:
```python
atlas_path = project.folder + '/cache/label_atlas.png'
atlas.save(atlas_path)
op('atlas_file_in').par.file = atlas_path
op('atlas_file_in').par.reloadpulse.pulse()
```

### Alternative: Baking via Text TOP (TD-Native)

Instead of Pillow, reuse a single Text TOP to render tiles and composite them:

```python
text_top = op('atlas_renderer')
for tile in tiles:
    text_top.par.text = tile['text']
    text_top.par.fontsize = font_size
    text_top.par.resolutionw = tile['w']
    text_top.par.resolutionh = tile['h']
    text_top.par.bgcolora = 0
    text_top.cook(force=True)
    # Copy pixels to atlas position...
```

This approach gives higher-quality text rendering (TD's native font engine with hinting and anti-aliasing) but is harder to composite into a single atlas without an intermediate compositing step. The Pillow approach is simpler and more portable.

### Instancing Setup

**Operator chain:**

```
Rectangle SOP (1x1 unit quad, UVs [0,1])
  --> Geometry COMP (instancing enabled)
       Material: GLSL MAT with atlas texture
       Instance source: CHOP
       Instance channels: tx, ty, sx, sy, r, g, b, a
       Custom instance attributes: u0, v0, u1, v1
```

**Instancing parameter setup** on the Geometry COMP (Instancing page):
- Enable instancing (the exact parameter name varies by TD build; inspect via `[p.name for p in op('geo1').pars() if 'inst' in p.name.lower()]`)
- Point to the instance CHOP for translate (`tx`, `ty`), scale (`sx`, `sy`), color (`r`, `g`, `b`, `a`)
- Bind custom attributes (`u0`, `v0`, `u1`, `v1`) as instance texcoords or custom attributes

### GLSL MAT for Atlas UV Remapping

**Vertex shader:**

```glsl
out Vert {
    vec2 atlasUV;
    vec4 color;
} oVert;

void main() {
    // Instance transform: position and scale
    vec4 instPos = TDInstanceTranslate();
    vec2 instScale = TDInstanceScale().xy;

    // Offset vertex by instance position and scale
    vec4 worldPos = vec4(
        P.x * instScale.x + instPos.x,
        P.y * instScale.y + instPos.y,
        instPos.z,
        1.0
    );
    gl_Position = TDWorldToProj(worldPos);

    // UV remapping: read per-instance UV rect from custom attributes
    // TDInstanceCustomAttrib0() packs (u0, v0, u1, v1) into a vec4
    vec4 uvRect = TDInstanceCustomAttrib0();
    vec2 baseUV = uv[0].st;
    oVert.atlasUV = vec2(
        mix(uvRect.x, uvRect.z, baseUV.x),
        mix(uvRect.y, uvRect.w, baseUV.y)
    );

    // Instance color (includes per-label alpha for opacity control)
    oVert.color = TDInstanceColor();
}
```

**Fragment shader:**

```glsl
in Vert {
    vec2 atlasUV;
    vec4 color;
} iVert;

uniform sampler2D sAtlasTexture;

out vec4 fragColor;

void main() {
    vec4 texSample = texture(sAtlasTexture, iVert.atlasUV);
    float textAlpha = texSample.a;

    if (textAlpha < 0.01) discard;

    // Text is white in atlas; tint by instance color
    vec3 finalColor = iVert.color.rgb;
    float finalAlpha = textAlpha * iVert.color.a;

    fragColor = TDOutputSwizzle(vec4(finalColor, finalAlpha));
}
```

**Optional glow effect** (approximated in fragment shader):

```glsl
// Sample neighboring texels for cheap glow
float glowRadius = 0.002;  // In atlas UV space
float glow = 0.0;
glow += texture(sAtlasTexture, iVert.atlasUV + vec2(glowRadius, 0)).a;
glow += texture(sAtlasTexture, iVert.atlasUV - vec2(glowRadius, 0)).a;
glow += texture(sAtlasTexture, iVert.atlasUV + vec2(0, glowRadius)).a;
glow += texture(sAtlasTexture, iVert.atlasUV - vec2(0, glowRadius)).a;
glow = min(glow * 0.25, 1.0);

vec3 glowColor = vec3(1.0);  // White glow (or dark for light theme)
vec3 finalColor = mix(glowColor, iVert.color.rgb, textAlpha);
float finalAlpha = max(textAlpha, glow * 0.4) * iVert.color.a;
```

### Screen-Space vs World-Space Placement

**Screen-space (recommended for keyword/cluster labels):**
- Render labels in a separate pass with an orthographic camera
- Instance positions are in pixel coordinates, computed via world-to-screen projection in Python
- Matches the R3F behavior exactly (labels are always pixel-aligned, not affected by perspective)
- Composite over the 3D render via Over TOP

**World-space (alternative for content labels):**
- Place quads directly in the 3D scene at node positions
- Requires billboarding to face camera (see vertex shader below)
- Font size changes with distance -- can be desirable for content labels that should "live" in the scene

**Billboard vertex shader** for world-space labels:

```glsl
void main() {
    mat4 modelView = uTDMats[TDCameraIndex()].worldCam;
    vec3 camRight = vec3(modelView[0][0], modelView[1][0], modelView[2][0]);
    vec3 camUp    = vec3(modelView[0][1], modelView[1][1], modelView[2][1]);

    vec3 instancePos = TDInstanceTranslate().xyz;
    vec2 scale = TDInstanceScale().xy;
    vec3 vertexOffset = camRight * P.x * scale.x + camUp * P.y * scale.y;

    vec4 worldPos = vec4(instancePos + vertexOffset, 1.0);
    gl_Position = TDWorldToProj(worldPos);
}
```

### When to Rebake the Atlas

| Trigger | Action |
|---|---|
| Initial data load from Supabase | Full atlas bake |
| Cluster relabeling (Leiden or LLM label update) | Rebake cluster tiles (or full rebake) |
| Filter change (click-to-drill-down) | Rebake if visible label set changes substantially |
| Zoom change | **No rebake** -- visibility/opacity handled by instance attributes |
| Camera pan | **No rebake** -- position handled by instance transforms |
| Hover | **No rebake** -- hover uses Text TOP or Panel COMP, not atlas |

### Handling Dynamic Text Changes

For labels that change infrequently (keyword names, cluster labels), atlas rebaking is acceptable. The full bake for 500 labels takes approximately 100-500ms in Pillow, causing a single-frame hitch.

Mitigation strategies for the hitch:
1. **Run bake in a background thread** via Python's `threading` module. TD's Python GIL limits true parallelism, but the Pillow rendering is mostly in C code and releases the GIL.
2. **Incremental rebaking**: Reserve empty space in the atlas. When a label changes, re-render only that tile's region.
3. **Double-buffer atlases**: Bake to atlas B while atlas A is still in use, then swap.

### Managing Atlas UV Coordinates

Store UVs in a Table DAT for clean data flow:

```
id        | type     | u0       | v0       | u1       | v1       | tw  | th
kw_001    | keyword  | 0.000000 | 0.000000 | 0.031738 | 0.014648 | 130 | 28
kw_002    | keyword  | 0.031738 | 0.000000 | 0.067871 | 0.014648 | 148 | 28
cluster_0 | cluster  | 0.000000 | 0.014648 | 0.054688 | 0.039551 | 224 | 52
```

The instance data generation script reads this table to populate `u0, v0, u1, v1` CHOP channels per instance.

### Verdict

**Best balance of performance and implementation effort for keyword and cluster labels.** Single texture bind + single instanced draw call. Atlas only rebuilds on data changes. Per-frame cost is limited to Python instance data generation (~1-2ms for 500 labels).

**Limitations**: No markdown rendering, no dynamic text reflow, blur when zoomed significantly beyond bake resolution.

---

## 5. Approach D: Panel COMP Overlay

### What the Panel COMP System Is

TouchDesigner's Panel COMP system is a 2D UI framework built into TD. It provides containers, widgets, text fields, sliders, and layout management. Panels can be rendered to a TOP for compositing over 3D content.

### Capabilities

- **Dynamic text**: Text content can be set via Python (`op('text_comp').par.text = '...'`)
- **Font styling**: Font face, size, color, bold/italic, alignment, word wrapping
- **Layout**: Containers with child positioning (absolute, relative)
- **Interaction**: Mouse enter/leave/click events via Panel Execute DAT callbacks
- **Render to TOP**: `panelCOMP.panel.render()` or using a Panel CHOP to output the panel's rendered pixels as a texture

### Performance with Many Elements

Panel COMPs are designed for UI applications (settings panels, control surfaces), not for hundreds of floating labels. Each panel child is a full COMP with its own cook cycle.

**Practical limits:**

| Element Count | Performance |
|---|---|
| 10-30 | Fine |
| 50-100 | Noticeable overhead, especially if many update per frame |
| 200+ | Significant performance impact; not recommended |

### Compositing Over 3D Render

```
[Render TOP: 3D scene] ---> [Over TOP] ---> Final output
                              ^
[Panel COMP render to TOP] ---+
```

The Panel render adds latency (1+ frames) since it runs through TD's UI rendering pipeline.

### Verdict

**Good for**: Hover preview (1 active label), pinned expanded preview (1 active), small numbers of interactive labels with event handling.

**Not suitable for**: Rendering 200+ keyword labels. The per-COMP overhead makes this unworkable at scale.

---

## 6. Approach E: Web Render TOP

### What It Is

TouchDesigner (2023+ builds) includes a **Web Render TOP** that embeds a Chromium-based browser (CEF -- Chromium Embedded Framework) and renders web content to a texture. This is conceptually similar to an Electron BrowserView or an off-screen Chromium renderer.

**Note**: The exact operator name and availability depend on your TD build. In some versions it may be called "Web Browser TOP" or "Web Render TOP". Check your OP Create dialog under TOPs. If unavailable, the approach described here may require a third-party plugin or alternative.

### How It Works

1. The Web Render TOP loads an HTML page (from URL or local file)
2. CEF renders the page using its Chromium engine (layout, paint, composite)
3. The rendered pixels are uploaded to GPU memory as a TOP texture
4. The TOP can be composited with other TOPs via Over/Composite

### Using Web Render TOP for Content/Markdown Labels

The idea: render a single HTML page containing all visible content labels, positioned via CSS to match their 3D-projected screen coordinates. This is architecturally similar to the R3F `LabelsOverlay` component.

**HTML template** (served as a local file or injected via JavaScript):

```html
<!DOCTYPE html>
<html>
<head>
<style>
  body { margin: 0; background: transparent; overflow: hidden; }
  .content-label {
    position: absolute;
    font-family: 'Inter', sans-serif;
    color: #333;
    overflow: hidden;
    word-wrap: break-word;
  }
  .content-label h1, .content-label h2 { font-size: 1.2em; }
  .content-label p { margin: 0.3em 0; }
</style>
</head>
<body>
  <div id="labels"></div>
  <script>
    // TD communicates with this page via JavaScript execution
    function updateLabels(labelData) {
      const container = document.getElementById('labels');
      container.innerHTML = '';
      for (const label of labelData) {
        const div = document.createElement('div');
        div.className = 'content-label';
        div.style.left = label.x + 'px';
        div.style.top = label.y + 'px';
        div.style.width = label.width + 'px';
        div.style.height = label.height + 'px';
        div.style.fontSize = label.fontSize + 'px';
        div.style.opacity = label.opacity;
        div.innerHTML = label.html;  // Pre-rendered markdown HTML
        container.appendChild(div);
      }
    }
  </script>
</body>
</html>
```

**TD-side update** (per frame, in a Script DAT or Execute DAT):

```python
import json

def update_web_labels(content_labels):
    """
    content_labels: list of dicts with x, y, width, height, fontSize, opacity, html
    """
    web_top = op('web_render1')
    label_json = json.dumps(content_labels)
    # Execute JavaScript in the embedded browser
    web_top.executeJavaScript(f'updateLabels({label_json})')
```

### Resolution

Match the Web Render TOP resolution to your final output:
- 1920x1080 for HD output
- 3840x2160 for 4K (but this quadruples the rendering cost)

Set via `op('web_render1').par.resolutionw = 1920`.

### Alpha Channel / Transparency

Alpha transparency from Web Render TOP is **uncertain and version-dependent**. Some implementations:
- Support `background: transparent` in CSS, outputting alpha in the texture
- Others always output opaque pixels regardless of CSS background

**Fallback strategies if alpha is not supported:**
1. Render with a known solid color background (e.g., bright green) and use a Key TOP to chroma-key it out
2. Render two versions (white background + black background) and derive alpha mathematically
3. Render only the label regions (skip full-page rendering) and composite as opaque blocks

### Performance Implications

Web rendering is CPU-intensive:

| Factor | Impact |
|---|---|
| DOM layout/paint | CPU-bound, scales with element count and complexity |
| Pixel upload to GPU | Bandwidth-limited, scales with resolution |
| JavaScript execution | Single-threaded in CEF, can block rendering |
| Update latency | At least 1 frame delay from JS call to texture availability |
| Markdown rendering | Requires a JS markdown library (marked, markdown-it) running in CEF |

**Estimated performance for 10-50 content labels at 1920x1080:**
- DOM update + layout: 2-10ms (depends on markdown complexity)
- Paint + upload: 2-5ms
- Total: 4-15ms, well within frame budget for 30fps
- At 60fps, this consumes 25-90% of the frame budget -- potentially tight

### Interaction Events

The Web Render TOP can forward mouse events to the embedded browser:
- Mouse position injection via TD parameters
- Click events via JavaScript execution
- Return values can be read back via callbacks or polling

However, this adds latency and complexity. For click handling on content labels, consider using Render Pick on the 3D content node geometry instead.

### Verdict

**Best option for markdown content labels** where rich text formatting (headings, paragraphs, bold/italic, lists) is needed. The HTML/CSS rendering engine handles all the layout complexity that would be extremely difficult to replicate in TD natively.

**Trade-offs**: CPU overhead, 1+ frame latency, uncertain alpha support. Not suitable for high-frequency updates (hundreds of labels changing every frame).

---

## 7. Hybrid Architecture Recommendation

Based on the analysis of all five approaches, the recommended architecture uses **three complementary systems**, each matched to the label type it handles best:

### Architecture Summary

| Label Type | Rendering Approach | Reason |
|---|---|---|
| **Keyword** (50-200) | Texture Atlas + Instanced Screen-Space Quads | Best performance for many short labels with per-frame position/opacity updates |
| **Cluster** (5-20) | Same atlas system as keywords | Simplifies pipeline; shares atlas and instancing infrastructure |
| **Content** (10-50, markdown) | Web Render TOP (primary) or Texture Atlas (fallback) | Web Render provides HTML/CSS layout for markdown. Atlas fallback if web rendering has alpha/perf issues |
| **Hover** (0-1) | Single Text TOP or Panel COMP | Negligible overhead for one label; full styling control |

### Rendering Pipeline

```
Layer 1: 3D Scene
  [Render TOP: perspective camera]
    - Keyword node circles (instanced)
    - Content node rectangles (instanced)
    - Edges (line geometry)
    - Transmission panel (frosted glass)

Layer 2: Keyword + Cluster Labels (screen-space)
  [Render TOP: orthographic camera]
    - Geometry COMP: instanced quads with atlas GLSL MAT
    - Instance data: Python Script CHOP (per-frame)
    - Atlas texture: Movie File In TOP (rebaked on data change)

Layer 3: Content Labels (markdown overlay)
  [Web Render TOP: HTML/CSS page]
    - Positioned divs with markdown content
    - Updated via executeJavaScript per frame
    - Resolution matches output

Layer 4: Hover Preview
  [Text TOP or Panel COMP]
    - Single dynamic label
    - Positioned from hovered node screen coords

Compositing:
  [Over TOP] Layer 1 + Layer 2
  [Over TOP] result + Layer 3
  [Over TOP] result + Layer 4
  --> Final output
```

### Fallback Architecture (If Web Render TOP Is Unavailable)

If the Web Render TOP is not available in your TD build, or if alpha transparency is problematic:

```
Content labels:
  - Pre-render content text to atlas using Pillow (plain text, no markdown)
  - Instance as textured quads (same system as keyword labels)
  - Word-wrap text at bake time using textwrap.fill()
  - Lose markdown formatting (headings, bold, lists)

Hover preview:
  - Panel COMP with Text COMP child (plain text with basic formatting)
```

### Network Topology

```
[Supabase Data] --> [Script DAT: data_loader]
                        |
                        v
              [Table DAT: keyword_nodes]      [Table DAT: node_degrees]
              [Table DAT: cluster_assignments] [Table DAT: cluster_labels]
                        |
                        v
              [Script DAT: atlas_baker]  (runs on data change)
                        |
                        +---> [Movie File In TOP: atlas_texture]
                        +---> [Table DAT: atlas_uvs]

              [Camera COMP: cam1] --> [CHOP: camera_state]
                        |
                        v
              [Script CHOP: kw_instance_data]   (per-frame)
              [Script CHOP: cluster_instance_data] (per-frame)
                        |
                        v
              [Geo COMP: keyword_labels]   -- Rect SOP + GLSL MAT
              [Geo COMP: cluster_labels]   -- Rect SOP + GLSL MAT
                        |
                        v
              [Render TOP: label_render]   (orthographic camera)
                        |
                        v
              [Over TOP: composite_labels_3d]
                ^                        \
                |                         v
              [Render TOP: scene_render]  [Over TOP: composite_content]
                                            ^
                                            |
                                          [Web Render TOP: content_labels]
                                            |
                                            v
                                          [Over TOP: composite_hover]
                                            ^
                                            |
                                          [Text TOP: hover_label]
                                            |
                                            v
                                          [Final output]
```

---

## 8. World-to-Screen Projection

### The Problem

Labels must be positioned in screen pixel coordinates matching 3D node positions. The R3F system uses `worldToScreen()` and `worldToScreen3D()` functions that convert world-space positions to screen pixels using the camera's FOV, position, and aspect ratio.

### R3F Reference Implementation

**Simplified projection (z=0 plane, for keyword/cluster labels):**
```javascript
const visibleHeight = 2 * cameraZ * Math.tan(fovRadians / 2);
const visibleWidth = visibleHeight * aspect;
const ndcX = (worldX - cameraX) / (visibleWidth / 2);
const ndcY = (worldY - cameraY) / (visibleHeight / 2);
const screenX = ((ndcX + 1) / 2) * containerWidth;
const screenY = ((1 - ndcY) / 2) * containerHeight;
```

**Full perspective projection (for content labels at z=-150):**
```javascript
const dx = worldX - cameraX;
const dy = worldY - cameraY;
const dz = worldZ - cameraZ;
if (dz >= 0) return null;  // Behind camera
const ndcX = dx / (-dz * halfFovTan * aspect);
const ndcY = dy / (-dz * halfFovTan);
```

### TouchDesigner Implementation

#### Option 1: Manual Projection in Python (Recommended)

Direct port of the R3F math. Runs in a Script CHOP or Script DAT for all labels per frame.

```python
import math

FOV_DEG = 10.0
FOV_RAD = math.radians(FOV_DEG)
HALF_FOV_TAN = math.tan(FOV_RAD / 2)

def world_to_screen_2d(wx, wy, cam_x, cam_y, cam_z, res_w, res_h):
    """
    Project a point on the z=0 plane to screen pixels.
    Used for keyword and cluster labels.
    """
    aspect = res_w / res_h
    vis_h = 2 * cam_z * HALF_FOV_TAN
    vis_w = vis_h * aspect

    ndc_x = (wx - cam_x) / (vis_w / 2)
    ndc_y = (wy - cam_y) / (vis_h / 2)

    sx = ((ndc_x + 1) / 2) * res_w
    sy = ((1 - ndc_y) / 2) * res_h
    return sx, sy

def world_to_screen_3d(wx, wy, wz, cam_x, cam_y, cam_z, res_w, res_h):
    """
    Full perspective projection for arbitrary Z depth.
    Used for content labels at z=-150.
    """
    aspect = res_w / res_h
    dx = wx - cam_x
    dy = wy - cam_y
    dz = wz - cam_z

    if dz >= 0:
        return None  # Behind camera

    ndc_x = dx / (-dz * HALF_FOV_TAN * aspect)
    ndc_y = dy / (-dz * HALF_FOV_TAN)

    sx = ((ndc_x + 1) / 2) * res_w
    sy = ((1 - ndc_y) / 2) * res_h
    return sx, sy
```

#### Option 2: Camera COMP Built-in Method

Some TD versions expose `Camera COMP.worldToScreen()`:

```python
cam = op('cam1')
# Returns normalized coordinates (0 to 1)
norm_pos = cam.worldToScreen(wx, wy, wz)
if norm_pos:
    pixel_x = norm_pos[0] * op('render1').width
    pixel_y = norm_pos[1] * op('render1').height
```

**Caveat**: This method may not be available in all TD builds. Performance may also be worse than manual math when called in a loop for hundreds of labels (each call may involve matrix operations internally). The manual Python projection above is more portable and predictable.

#### Option 3: Full Matrix Projection

For cases where you need the full model-view-projection pipeline:

```python
import tdu

def project_with_matrices(wx, wy, wz, camera_op, render_width, render_height):
    """
    Project using camera world transform and projection matrix.
    """
    # View matrix = inverse of camera world transform
    cam_world = camera_op.worldTransform  # tdu.Matrix (4x4)
    view_matrix = cam_world.inverted()

    # Projection matrix from camera parameters
    fov = camera_op.par.fov.eval()
    near = camera_op.par.near.eval()
    far = camera_op.par.far.eval()
    aspect = render_width / render_height
    proj_matrix = tdu.Matrix.perspective(fov, aspect, near, far)
    # Note: tdu.Matrix.perspective() availability is version-dependent

    # Transform point
    point = tdu.Position(wx, wy, wz)
    clip = proj_matrix * view_matrix * point

    if clip.w <= 0:
        return None

    ndc_x = clip.x / clip.w
    ndc_y = clip.y / clip.w

    px = (ndc_x * 0.5 + 0.5) * render_width
    py = (1.0 - (ndc_y * 0.5 + 0.5)) * render_height
    return px, py
```

**Warning**: TD's coordinate conventions (Y-up vs Y-down, NDC depth range, handedness) may differ from Three.js/OpenGL. Test projection output against known positions and adjust signs/flips as needed.

#### Option 4: Inverse Approach -- Render Labels in 3D

If you render label quads in the 3D scene (world-space billboards), TD's camera handles projection automatically. No Python projection math needed. However, you lose pixel-perfect sizing and alignment.

### Screen-to-World (for Hover Detection)

The inverse operation: convert mouse pixel position to world coordinates on the z=0 plane.

```python
def screen_to_world(screen_x, screen_y, cam_x, cam_y, cam_z, res_w, res_h):
    """Convert screen pixel position to world XY on the z=0 plane."""
    aspect = res_w / res_h
    ndc_x = (screen_x / res_w) * 2 - 1
    ndc_y = 1 - (screen_y / res_h) * 2

    vis_h = 2 * cam_z * HALF_FOV_TAN
    vis_w = vis_h * aspect

    world_x = cam_x + ndc_x * (vis_w / 2)
    world_y = cam_y + ndc_y * (vis_h / 2)
    return world_x, world_y
```

---

## 9. Visibility, Opacity, and Font Scaling

### Degree-Based Keyword Label Filtering

Port the R3F degree threshold logic to a Script CHOP:

```python
def compute_keyword_visibility(camera_z, node_degrees, kw_start=13961, kw_full=1200):
    """
    Returns dict of node_id -> visible (bool).
    """
    max_degree = max(node_degrees.values()) if node_degrees else 1

    if camera_z >= kw_start:
        threshold = float('inf')
    elif camera_z <= kw_full:
        threshold = 0
    else:
        t = (camera_z - kw_full) / (kw_start - kw_full)
        threshold = t * max_degree

    return {nid: degree >= threshold for nid, degree in node_degrees.items()}
```

### Zoom Crossfade Opacity

```python
def compute_zoom_opacities(camera_z, near=50.0, far=10347.0):
    """
    Returns (keyword_label_opacity, content_label_opacity).
    """
    t = max(0, min(1, (camera_z - near) / (far - near)))
    return t, (1.0 - t) ** 2
```

### Combined Opacity Calculation

Each label's final opacity is the product of multiple factors:

```
final_alpha = zoom_opacity * degree_visibility * search_opacity * cluster_visibility
```

In TD, this can be computed in a single Script CHOP per label type, or as a chain of Math CHOPs (multiply mode). For smooth transitions, pipe the result through a **Filter CHOP** (lag) to replicate the CSS `transition: opacity 0.15s ease-out`.

### Font Scaling

**Keyword labels**: Base font size 42px, scaled by zoom:

```python
atlas_font = 48.0  # Pre-baked at this size in atlas
base_font = 42.0
zoom_scale = min(1.0, 1500.0 / camera_z)
target_font = base_font * zoom_scale

# Hover: 1.5x multiplier
if is_hovered:
    target_font *= 1.5

# Instance scale ratio
scale_ratio = target_font / atlas_font
instance_sx = tile_width_px * scale_ratio
instance_sy = tile_height_px * scale_ratio
```

**Content labels**: Font proportional to screen rect size:

```python
base_font = 6.0
base_chunk_size = 100.0
font_size = (screen_rect_width / base_chunk_size) * base_font
```

**Cluster labels**: Fixed 18px bold, opacity varies.

### Multi-Resolution Atlas Strategy

If keyword labels span a wide zoom range (e.g., 8px to 63px screen size), a single 48px atlas bake produces acceptable quality for most cases (bilinear filtering handles downscaling well). For extreme cases:

- **Dual atlas**: Bake at 24px and 48px, select based on target screen size
- **SDF upgrade**: Switch to SDF rendering for resolution-independent scaling

### Off-Screen Culling

Check screen coordinates against viewport bounds before including in instance data:

```python
def is_visible(sx, sy, res_w, res_h, padding=50):
    return -padding <= sx <= res_w + padding and -padding <= sy <= res_h + padding
```

Set alpha to 0 for off-screen instances, or better, exclude them from the instance table entirely to reduce vertex processing.

---

## 10. Hover and Interactive Labels

### Hover Detection

**Mouse In CHOP** provides cursor pixel position. Convert to world coordinates using `screen_to_world()`, then find the nearest keyword node:

```python
def find_nearest_keyword(cursor_wx, cursor_wy, keyword_positions, threshold=30.0):
    """
    keyword_positions: dict of id -> (x, y)
    Returns: (nearest_id, distance) or (None, None)
    """
    nearest_id = None
    nearest_dist = threshold

    for kid, (kx, ky) in keyword_positions.items():
        dist = math.hypot(cursor_wx - kx, cursor_wy - ky)
        if dist < nearest_dist:
            nearest_dist = dist
            nearest_id = kid

    return nearest_id, nearest_dist if nearest_id else (None, None)
```

### Hover Label Rendering

Since only 0-1 hover labels are active at a time, use a **single Text TOP**:

```python
def update_hover_label(hovered_id, keyword_names, screen_positions):
    text_top = op('hover_text')
    if hovered_id is None:
        text_top.par.text = ''
        return

    text_top.par.text = keyword_names[hovered_id]
    text_top.par.fontsize = 42 * min(1.0, 1500.0 / camera_z) * 1.5

    # Position via Transform TOP or composite at screen coordinates
    sx, sy = screen_positions[hovered_id]
    # ... position logic
```

Alternatively, include the hovered label in the instanced keyword label system with an enlarged scale multiplier, matching the R3F behavior where the regular label is simply scaled up on hover.

### Click Interaction via Render Pick

**Render Pick CHOP** detects which geometry/instance is under the mouse cursor:

1. Connect Render Pick CHOP to the Render TOP containing label quads
2. Feed mouse position (from Mouse In CHOP)
3. Read output channels: picked object name, position, and potentially instance index

```
[Mouse In CHOP] --> [Render Pick CHOP]
                        Input: [Render TOP: label_render]
                        Camera: [Camera COMP: ortho_cam]
                        Output: picked object, instance, position
                            |
                            v
                    [Script DAT: pick_handler]
                        Map instance index --> label ID via instance table
                        Trigger: filter, drill-down, navigation
```

**If instance index is not available** from Render Pick (version-dependent), use an **ID buffer** approach:
1. Render the same instanced quads to a separate Render TOP
2. Each instance outputs a unique color encoding its ID (e.g., instance 42 = RGB(0, 0, 42/255))
3. Sample the pixel under the mouse and decode to label ID

### Click on Text vs Click on Node

In the R3F system, clicking on a keyword label span and clicking on the keyword node circle are different events. In TD:

- **Node click**: Render Pick on the 3D scene geometry
- **Label click**: Render Pick on the label quad geometry (separate Render TOP pass)

If you render labels in the same scene, you may need to distinguish which geometry was picked (node circle vs label quad) by checking the picked SOP/COMP.

---

## 11. Performance Analysis

### Label Count Budget

| Label Type | Typical Count | Max Count | Per-Frame Work |
|---|---|---|---|
| Cluster | 5-30 | 50 | Centroid computation + projection |
| Keyword | 50-300 visible (of 500) | 500 | Projection + degree filtering + opacity |
| Content | 0-200 visible (of 1000) | 1000 | Projection + opacity (when zoomed in) |
| Hover | 0-1 | 1 | Nearest-node search |

Total: up to ~800 labels updating positions every frame, ~1500 tiles in the atlas.

### Performance Targets

| Operation | Budget | Notes |
|---|---|---|
| Atlas bake | < 2 seconds | Runs only on data change, not per frame |
| Per-frame instance data (Python) | < 2ms | Position, opacity, visibility for 800 labels |
| GPU instanced rendering | < 0.5ms | 1000 textured quads is trivial |
| Web Render TOP update | < 10ms | Content labels only, when visible |
| Hover computation | < 0.5ms | Linear scan of keyword positions |

### Bottleneck Analysis

**CPU**: The main per-frame cost is the Python Script CHOP computing instance data (world-to-screen projection, degree filtering, opacity multiplication) for all visible labels. At 500 labels, this is approximately 1-2ms. Optimizations:
- Use numpy if available in TD's Python for vectorized math
- Cache previous frame's positions, skip unchanged labels
- Separate label types into independent Script CHOPs (parallel cooking)

**GPU**: Instanced quad rendering is negligible. The atlas texture (4096x4096 RGBA = 64MB) fits easily in GPU memory. Fragment shader cost is low (one texture sample + discard).

**Memory**: Atlas textures (keyword + cluster + content) total approximately 100-200MB VRAM. Web Render TOP adds another frame buffer (1920x1080x4 = ~8MB).

### Optimization Strategies

1. **Separate Geometry COMPs by label type**: Keyword labels, cluster labels, and content labels each get their own Geo COMP. This allows:
   - Independent material/shader per type
   - Toggle visibility per type (hide content labels when far away, skip the entire CHOP + render)
   - Smaller per-type atlases (better cache coherence)

2. **Conditional content label processing**: When `camera_z > 10347` (content fully faded), disable the content label system entirely:
   ```python
   if camera_z > 10347:
       op('content_label_geo').par.display = False
       # Skip content instance CHOP cooking
   ```

3. **Spatial culling in Python**: Before writing instance data, compute viewport bounds in world space and cull labels outside. This reduces instance count and GPU work.

4. **Filter CHOP for smooth opacity**: Instead of per-frame opacity calculation in Python, use a Filter CHOP (lag) on the opacity channel. This smooths transitions and reduces the need for per-frame Python opacity updates.

5. **Cook-on-change for atlas**: Wire a DAT Execute callback to the label data table so the atlas only rebakes when data actually changes.

---

## 12. Implementation Code

### Complete Atlas Baker (Script DAT)

```python
"""
Atlas baker for label textures.
Run on data change, not every frame.

Input: Table DAT 'label_data' with columns: id, text, type, font_size
Output: Atlas texture via Movie File In TOP, UV table in 'atlas_uvs' DAT
"""

import math
from PIL import Image, ImageDraw, ImageFont

def onCook(scriptOp):
    label_table = op('label_data')
    if label_table.numRows <= 1:
        return

    atlas_width = 4096
    padding = 6
    font_path = project.folder + '/fonts/InterVariable.ttf'

    # Collect tiles with size estimates
    tiles = []
    font_cache = {}
    for i in range(1, label_table.numRows):
        label_id = label_table[i, 'id'].val
        text = label_table[i, 'text'].val
        label_type = label_table[i, 'type'].val
        font_size = int(label_table[i, 'font_size'].val)

        if font_size not in font_cache:
            font_cache[font_size] = ImageFont.truetype(font_path, font_size)
        font = font_cache[font_size]

        lines = text.split('\n')
        max_w = max(font.getlength(line) for line in lines)
        line_h = font_size * 1.4
        total_h = len(lines) * line_h

        tiles.append({
            'id': label_id, 'text': text, 'type': label_type,
            'font_size': font_size,
            'w': int(max_w + padding * 2),
            'h': int(total_h + padding * 2),
        })

    # Shelf-pack (sort by height descending for better packing)
    tiles.sort(key=lambda t: -t['h'])
    shelf_y, shelf_h, cursor_x = 0, 0, 0
    for tile in tiles:
        if cursor_x + tile['w'] > atlas_width:
            shelf_y += shelf_h
            shelf_h, cursor_x = 0, 0
        tile['x'], tile['y'] = cursor_x, shelf_y
        cursor_x += tile['w']
        shelf_h = max(shelf_h, tile['h'])

    atlas_height = 2 ** math.ceil(math.log2(max(shelf_y + shelf_h, 1)))

    # Render atlas
    atlas = Image.new('RGBA', (atlas_width, atlas_height), (0, 0, 0, 0))
    draw = ImageDraw.Draw(atlas)

    for tile in tiles:
        font = font_cache[tile['font_size']]
        for j, line in enumerate(tile['text'].split('\n')):
            draw.text(
                (tile['x'] + padding, tile['y'] + padding + j * tile['font_size'] * 1.4),
                line, font=font, fill=(255, 255, 255, 255)
            )

    # Save and load into TD
    atlas_path = project.folder + '/cache/label_atlas.png'
    atlas.save(atlas_path)
    op('atlas_file_in').par.file = atlas_path
    op('atlas_file_in').par.reloadpulse.pulse()

    # Write UV lookup table
    uv_table = op('atlas_uvs')
    uv_table.clear()
    uv_table.appendRow(['id', 'type', 'u0', 'v0', 'u1', 'v1', 'tw', 'th'])

    for tile in tiles:
        u0 = tile['x'] / atlas_width
        v0 = tile['y'] / atlas_height
        u1 = (tile['x'] + tile['w']) / atlas_width
        v1 = (tile['y'] + tile['h']) / atlas_height
        uv_table.appendRow([
            tile['id'], tile['type'],
            f'{u0:.6f}', f'{v0:.6f}',
            f'{u1:.6f}', f'{v1:.6f}',
            str(tile['w']), str(tile['h'])
        ])

    debug(f'Atlas baked: {len(tiles)} labels, {atlas_width}x{atlas_height}')
```

### Per-Frame Instance Table Updater (Script CHOP)

```python
"""
Per-frame computation of keyword label instance transforms and visibility.
Reads: node positions, camera state, zoom scales, degree data, atlas UVs.
Writes: CHOP channels for Geometry COMP instancing.
"""

import math

FOV_RAD = math.radians(10.0)
HALF_FOV_TAN = math.tan(FOV_RAD / 2)

def cook(scriptOp):
    # Camera state
    cam_state = op('camera_state')
    cam_x = cam_state['cam_x'].eval()
    cam_y = cam_state['cam_y'].eval()
    cam_z = cam_state['cam_z'].eval()

    res_w = op('render1').width
    res_h = op('render1').height
    aspect = res_w / res_h

    # Viewport dimensions in world units
    vis_h = 2 * cam_z * HALF_FOV_TAN
    vis_w = vis_h * aspect

    # Zoom opacity
    near, far = 50.0, 10347.0
    t = max(0, min(1, (cam_z - near) / (far - near)))
    kw_opacity = t

    # Degree threshold
    kw_start, kw_full = 13961.0, 1200.0
    degree_table = op('node_degrees')
    max_degree = 1
    for i in range(1, degree_table.numRows):
        d = int(degree_table[i, 'degree'].val)
        if d > max_degree:
            max_degree = d

    if cam_z >= kw_start:
        deg_threshold = float('inf')
    elif cam_z <= kw_full:
        deg_threshold = 0
    else:
        dt = (cam_z - kw_full) / (kw_start - kw_full)
        deg_threshold = dt * max_degree

    # Font scaling
    atlas_font = 48.0
    base_font = 42.0
    zoom_scale = min(1.0, 1500.0 / cam_z)
    font_ratio = (base_font * zoom_scale) / atlas_font

    # Data sources
    uv_table = op('atlas_uvs')
    pos_table = op('keyword_positions')

    # Build output channels
    n = pos_table.numRows - 1
    scriptOp.numSamples = n
    scriptOp.clear()
    for ch in ['tx', 'ty', 'sx', 'sy', 'r', 'g', 'b', 'a', 'u0', 'v0', 'u1', 'v1']:
        scriptOp.appendChan(ch)

    # Pixels per world unit (for node radius offset)
    ppu = res_h / vis_h
    node_radius_screen = 10.0 * ppu  # BASE_DOT_RADIUS * ppu

    for i in range(1, pos_table.numRows):
        idx = i - 1
        label_id = pos_table[i, 'id'].val
        wx = float(pos_table[i, 'x'].val)
        wy = float(pos_table[i, 'y'].val)

        # World to screen
        ndc_x = (wx - cam_x) / (vis_w / 2)
        ndc_y = (wy - cam_y) / (vis_h / 2)
        sx = ((ndc_x + 1) / 2) * res_w
        sy = ((1 - ndc_y) / 2) * res_h

        # Cull off-screen
        if sx < -50 or sx > res_w + 50 or sy < -50 or sy > res_h + 50:
            scriptOp['a'][idx] = 0
            continue

        # Degree check
        degree = 0
        for di in range(1, degree_table.numRows):
            if degree_table[di, 'id'].val == label_id:
                degree = int(degree_table[di, 'degree'].val)
                break
        if degree < deg_threshold:
            scriptOp['a'][idx] = 0
            continue

        # Atlas UV lookup
        uv_row = None
        for ui in range(1, uv_table.numRows):
            if uv_table[ui, 'id'].val == label_id:
                uv_row = ui
                break
        if uv_row is None:
            scriptOp['a'][idx] = 0
            continue

        tile_w = float(uv_table[uv_row, 'tw'].val)
        tile_h = float(uv_table[uv_row, 'th'].val)

        # Set instance data
        scriptOp['tx'][idx] = sx + node_radius_screen + 4
        scriptOp['ty'][idx] = sy
        scriptOp['sx'][idx] = tile_w * font_ratio
        scriptOp['sy'][idx] = tile_h * font_ratio
        scriptOp['r'][idx] = 0.2  # Theme color
        scriptOp['g'][idx] = 0.2
        scriptOp['b'][idx] = 0.2
        scriptOp['a'][idx] = kw_opacity
        scriptOp['u0'][idx] = float(uv_table[uv_row, 'u0'].val)
        scriptOp['v0'][idx] = float(uv_table[uv_row, 'v0'].val)
        scriptOp['u1'][idx] = float(uv_table[uv_row, 'u1'].val)
        scriptOp['v1'][idx] = float(uv_table[uv_row, 'v1'].val)
```

### GLSL MAT: Complete Atlas-Based Label Shader

**Vertex shader (`label_vertex.glsl`):**

```glsl
out Vert {
    vec2 atlasUV;
    vec4 color;
} oVert;

void main() {
    // Instance transform
    vec4 instPos = TDInstanceTranslate();
    vec2 instScale = TDInstanceScale().xy;

    vec4 worldPos = vec4(
        P.x * instScale.x + instPos.x,
        P.y * instScale.y + instPos.y,
        instPos.z,
        1.0
    );
    gl_Position = TDWorldToProj(worldPos);

    // Remap UV: base quad [0,1] --> atlas tile [u0,u1] x [v0,v1]
    vec4 uvRect = TDInstanceCustomAttrib0();
    vec2 baseUV = uv[0].st;
    oVert.atlasUV = vec2(
        mix(uvRect.x, uvRect.z, baseUV.x),
        mix(uvRect.y, uvRect.w, baseUV.y)
    );

    oVert.color = TDInstanceColor();
}
```

**Fragment shader (`label_pixel.glsl`):**

```glsl
in Vert {
    vec2 atlasUV;
    vec4 color;
} iVert;

uniform sampler2D sAtlasTexture;

// Theme-aware glow (set via TOP parameter or uniform)
uniform float uGlowIntensity;  // 0.0 = no glow, 0.4 = subtle
uniform vec3  uGlowColor;      // vec3(1.0) for light mode, vec3(0.0) for dark

out vec4 fragColor;

void main() {
    vec4 texSample = texture(sAtlasTexture, iVert.atlasUV);
    float textAlpha = texSample.a;

    // Early discard for transparent pixels
    if (textAlpha < 0.01 && uGlowIntensity < 0.01) discard;

    // Optional glow: sample neighbors
    float glow = 0.0;
    if (uGlowIntensity > 0.0) {
        float r = 0.002;
        glow += texture(sAtlasTexture, iVert.atlasUV + vec2(r, 0)).a;
        glow += texture(sAtlasTexture, iVert.atlasUV - vec2(r, 0)).a;
        glow += texture(sAtlasTexture, iVert.atlasUV + vec2(0, r)).a;
        glow += texture(sAtlasTexture, iVert.atlasUV - vec2(0, r)).a;
        glow = min(glow * 0.25 * uGlowIntensity, 1.0);
    }

    // Composite: glow behind text
    vec3 finalColor = mix(uGlowColor, iVert.color.rgb, textAlpha);
    float finalAlpha = max(textAlpha, glow) * iVert.color.a;

    if (finalAlpha < 0.01) discard;

    fragColor = TDOutputSwizzle(vec4(finalColor, finalAlpha));
}
```

### MSDF Fragment Shader (For SDF Text Upgrade Path)

```glsl
in Vert {
    vec2 atlasUV;
    vec4 color;
} iVert;

uniform sampler2D sMSDFAtlas;

out vec4 fragColor;

float median(float r, float g, float b) {
    return max(min(r, g), min(max(r, g), b));
}

void main() {
    vec3 msd = texture(sMSDFAtlas, iVert.atlasUV).rgb;
    float sd = median(msd.r, msd.g, msd.b);

    // Anti-aliased edge
    float w = fwidth(sd);
    float alpha = smoothstep(0.5 - w, 0.5 + w, sd);

    if (alpha < 0.01) discard;

    // Optional outline: wider threshold
    float outlineAlpha = smoothstep(0.35 - w, 0.35 + w, sd);

    // Composite: outline color behind text color
    vec3 outlineColor = vec3(0.0);  // Black outline
    vec3 finalColor = mix(outlineColor, iVert.color.rgb, alpha);
    float finalAlpha = outlineAlpha * iVert.color.a;

    fragColor = TDOutputSwizzle(vec4(finalColor, finalAlpha));
}
```

### Cluster Label Centroid Computation (Script DAT)

```python
"""
Compute cluster label positions from node positions and cluster assignments.
Equivalent to computeClusterLabels() in cluster-labels.ts.
"""

def compute_cluster_centroids(node_positions_dat, node_clusters_dat):
    """
    Returns: dict of cluster_id -> (centroid_x, centroid_y, label_text)
    """
    clusters = {}

    pos = op(node_positions_dat)
    clu = op(node_clusters_dat)

    for i in range(1, pos.numRows):
        node_id = pos[i, 'id'].val
        x = float(pos[i, 'x'].val)
        y = float(pos[i, 'y'].val)

        # Find cluster assignment
        for ci in range(1, clu.numRows):
            if clu[ci, 'node_id'].val == node_id:
                cluster_id = int(clu[ci, 'cluster_id'].val)
                label = clu[ci, 'label'].val
                if cluster_id not in clusters:
                    clusters[cluster_id] = {'xs': [], 'ys': [], 'label': label}
                clusters[cluster_id]['xs'].append(x)
                clusters[cluster_id]['ys'].append(y)
                break

    result = {}
    for cid, data in clusters.items():
        cx = sum(data['xs']) / len(data['xs'])
        cy = sum(data['ys']) / len(data['ys'])
        result[cid] = (cx, cy, data['label'])

    return result
```

---

## Key Differences from R3F

1. **No DOM layout engine.** The R3F system relies on the browser's text layout for word wrapping, line breaking, and font metric computation. In TD, pre-compute text layout via Pillow's `textbbox` or TD's Text TOP when baking the atlas. For rich text (markdown), use the Web Render TOP.

2. **No CSS transitions.** The R3F system uses `transition: opacity 0.15s ease-out` for smooth fading. In TD, replicate with a **Filter CHOP** (lag/lowpass) on the opacity channels before feeding them to instance attributes.

3. **No React portals.** The R3F system uses React portals to render markdown (via ReactMarkdown) into chunk label containers. TD has no equivalent. For content labels, use Web Render TOP with a markdown-to-HTML library (marked.js, markdown-it) running inside CEF, or fall back to plain text in the atlas.

4. **No per-element event listeners.** The R3F system adds click handlers to individual label spans. In TD, use Render Pick to detect which instanced quad was clicked, then map instance index back to label ID via the instance table.

5. **Single-threaded Python.** Atlas baking runs in TD's Python interpreter. For large atlases (1000+ labels), expect 100-500ms. Mitigate by running bakes in a background thread, baking incrementally, or using double-buffered atlases.

6. **No theme media queries.** The R3F system uses `prefers-color-scheme` for light/dark mode. In TD, drive theme colors via a custom parameter (toggle or menu) that feeds into GLSL MAT uniforms (`uGlowColor`, text color channels in instance data).
