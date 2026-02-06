# Geometry Instancing in TouchDesigner

Technical reference for porting instanced geometry rendering from R3F (React Three Fiber) to TouchDesigner. Covers keyword circles, content rounded-rectangles, materials, per-instance opacity, frustum culling, and render order.

---

## Table of Contents

1. [R3F Implementation Reference](#1-r3f-implementation-reference)
2. [Instanced Circles (Keyword Nodes)](#2-instanced-circles-keyword-nodes)
3. [Instanced Rounded Rectangles (Content Nodes)](#3-instanced-rounded-rectangles-content-nodes)
4. [Materials for Instanced Geometry](#4-materials-for-instanced-geometry)
5. [Per-Instance Opacity](#5-per-instance-opacity)
6. [Frustum Culling](#6-frustum-culling)
7. [Render Order Control](#7-render-order-control)
8. [Performance Characteristics](#8-performance-characteristics)
9. [Instance Data Sources: CHOP vs DAT](#9-instance-data-sources-chop-vs-dat)
10. [Instance Picking (Click/Hover)](#10-instance-picking-clickhover)
11. [Network Wiring Reference](#11-network-wiring-reference)

---

## 1. R3F Implementation Reference

The R3F renderer uses Three.js `InstancedMesh` for both keyword circles and content rounded-rectangles. Each category is a single draw call regardless of instance count.

| Element | Three.js Primitive | Material | Per-Instance Data |
|---|---|---|---|
| Keywords | `InstancedMesh` + `CircleGeometry(r=10, segs=64)` | `MeshBasicMaterial`, `vertexColors: true` | position(x,y,0), color(r,g,b), scale(uniform) |
| Content | `InstancedMesh` + `ShapeGeometry` (rounded rect) | `MeshBasicMaterial`, `vertexColors: true` | position(x,y,z=-500), color(r,g,b), scale(uniform) |

Key R3F parameters:
- `frustumCulled={false}` on both instanced meshes
- `depthTest: true`, `depthWrite: true`, `transparent: false`
- Colors are RGB only (no alpha channel). Dimming is achieved by `color.multiplyScalar(opacity)` -- premultiplied into the RGB values rather than using alpha blending
- Material is `MeshBasicMaterial` -- unlit, flat shading, no lighting response
- Instance color attribute is a `Float32Array` with 3 components (RGB), created via `InstancedBufferAttribute` before the material is attached, then the material is force-recompiled with `needsUpdate = true`

---

## 2. Instanced Circles (Keyword Nodes)

### 2.1 Template Geometry: Circle SOP

Create a Circle SOP inside a Geometry COMP. This is the single template shape that gets replicated for every keyword.

**Circle SOP parameters:**

| Parameter | Value | Notes |
|---|---|---|
| Type | **Polygon** | Not NURBS or Bezier. Must be polygon for filled rendering |
| Orientation | **XY Plane** | Circle faces the camera (normal along +Z) |
| Radius | `10` | Matching `BASE_DOT_RADIUS * DOT_SCALE_FACTOR` in R3F |
| Divisions | `64` | Matching `CIRCLE_SEGMENTS` in R3F. 32 is sufficient if performance matters |

**Important: filled disc vs outline.** The Circle SOP in Polygon mode may produce only a closed polygon outline (no interior face). To get a solid filled disc:

1. Check the Circle SOP's output in the SOP viewer. If you see only a wireframe ring, the geometry has no face.
2. Solution A: If your TD build has a **Fill** or **Solid** toggle on the Circle SOP, enable it.
3. Solution B: Add a **PolyFill SOP** (or **Triangulate SOP**) downstream of the Circle SOP. Wire: `circle1` -> `polyfill1`. This triangulates the interior and creates a proper filled polygon.
4. Verify: In the SOP viewer, switch from wireframe to shaded mode. You should see a solid disc.

### 2.2 Geometry COMP Setup

Create a Geometry COMP (`geo_keywords`) and wire the Circle SOP (or PolyFill SOP) into it.

**Render page:**
- **SOP**: point to your filled circle SOP
- **Material**: point to a Constant MAT (see Section 4)

**Instance page** -- this is where instancing is configured:

| Parameter (UI label) | Value | Notes |
|---|---|---|
| **Instancing** | **On** | Master toggle. Enables GPU instancing |
| **Instance OP** | `chop_keyword_instances` | Path to the CHOP (or DAT) providing instance data |
| **Translate X** | `tx` | Channel name in the CHOP |
| **Translate Y** | `ty` | Channel name in the CHOP |
| **Translate Z** | `tz` | `0` for all keywords (same Z plane) |
| **Rotate X/Y/Z** | (empty) | No rotation needed -- 2D graph |
| **Scale X** | `sx` | Uniform scale channel |
| **Scale Y** | `sy` | Same as sx for uniform |
| **Scale Z** | `sz` | Same as sx for uniform |
| **Color R** | `cr` | Instance red channel |
| **Color G** | `cg` | Instance green channel |
| **Color B** | `cb` | Instance blue channel |

**Internal parameter names** (for scripting via `op('geo_keywords').par.*`):
The Geometry COMP's Instance page parameters typically follow the naming pattern `instancetx`, `instancety`, `instancetz` for the channel name fields, `instanceop` for the Instance OP, and `instancing` for the toggle. However, these names can vary between TD builds. To get the exact names for your build, run this in Textport:

```python
geo = op('geo_keywords')
for page in geo.par.pages:
    if 'instance' in page.name.lower() or 'instance' in page.label.lower():
        for p in page.pars:
            print(f"{p.label:30s}  {p.name:25s}  {p.val}")
```

### 2.3 Instance CHOP Structure

The instance CHOP has one **sample** per keyword node, with channels for each attribute. For N keywords, the CHOP has N samples:

```
Channel:   tx       ty       tz      sx      sy      sz      cr      cg      cb
Sample 0:  -245.3   102.7    0.0     0.65    0.65    0.65    0.847   0.223   0.441
Sample 1:    87.1  -301.4    0.0     0.65    0.65    0.65    0.312   0.651   0.188
Sample 2:  ...
```

Instance index `i` maps to sample `i` in the CHOP. Channel length (number of samples) determines the number of instances rendered.

---

## 3. Instanced Rounded Rectangles (Content Nodes)

### 3.1 Rounded Rectangle Geometry

TouchDesigner's Rectangle SOP does not have a built-in corner radius or fillet parameter in most builds. There are three approaches to create a rounded rectangle:

#### Approach A: Script SOP (recommended for exact R3F match)

Use a Script SOP to generate a rounded rectangle polygon that matches the R3F `THREE.Shape` construction. The R3F code builds the shape with `quadraticCurveTo` for each corner:

```python
def onCook(scriptOp):
    scriptOp.clear()
    import math

    size = 30.0      # contentRadius * 2 (= 10 * 2.5 * 1.5 * 2)
    corner_r = 3.0   # contentRadius * 0.2
    corner_segs = 8   # Segments per corner arc
    half = size / 2.0

    points = []
    x0, y0 = -half, -half

    # Build counter-clockwise polygon matching R3F Shape:
    # Bottom edge
    points.append((x0 + corner_r, y0, 0))
    points.append((x0 + size - corner_r, y0, 0))

    # Bottom-right corner arc
    cx, cy = x0 + size - corner_r, y0 + corner_r
    for i in range(1, corner_segs + 1):
        t = i / corner_segs
        angle = -math.pi / 2 + t * (math.pi / 2)
        points.append((cx + corner_r * math.cos(angle),
                        cy + corner_r * math.sin(angle), 0))

    # Right edge
    points.append((x0 + size, y0 + size - corner_r, 0))

    # Top-right corner arc
    cx, cy = x0 + size - corner_r, y0 + size - corner_r
    for i in range(1, corner_segs + 1):
        t = i / corner_segs
        angle = t * (math.pi / 2)
        points.append((cx + corner_r * math.cos(angle),
                        cy + corner_r * math.sin(angle), 0))

    # Top edge
    points.append((x0 + corner_r, y0 + size, 0))

    # Top-left corner arc
    cx, cy = x0 + corner_r, y0 + size - corner_r
    for i in range(1, corner_segs + 1):
        t = i / corner_segs
        angle = math.pi / 2 + t * (math.pi / 2)
        points.append((cx + corner_r * math.cos(angle),
                        cy + corner_r * math.sin(angle), 0))

    # Left edge
    points.append((x0, y0 + corner_r, 0))

    # Bottom-left corner arc
    cx, cy = x0 + corner_r, y0 + corner_r
    for i in range(1, corner_segs + 1):
        t = i / corner_segs
        angle = math.pi + t * (math.pi / 2)
        points.append((cx + corner_r * math.cos(angle),
                        cy + corner_r * math.sin(angle), 0))

    # Create filled polygon
    poly = scriptOp.appendPoly(len(points), closed=True, addPoints=True)
    for i, (px, py, pz) in enumerate(points):
        pt = poly[i].point
        pt.x = px
        pt.y = py
        pt.z = pz
```

The Script SOP output feeds into a **PolyFill SOP** (or **Triangulate SOP**) to create a filled polygon face, then into the Geometry COMP.

#### Approach B: Rectangle TOP as Textured Quad

For content cards that display text, a cleaner approach:

1. Create a **Rectangle TOP** (which does support rounded corners in TOPs) as a mask/texture
2. Apply it to a simple **Grid SOP** (flat quad) as a texture via the material
3. Instance the quads

This gives pixel-perfect anti-aliased corners and is often faster than complex SOP geometry. The trade-off: the rounded corners are in texture space, not geometry, so they do not respond to 3D lighting or edge detection.

#### Approach C: Rectangle SOP + Fillet SOP (if available)

Some TD builds include a Fillet SOP that can round polygon corners. Wire: `rectangle1` -> `fillet1` -> `polyfill1`. This depends on your specific TD build having the Fillet SOP.

### 3.2 Instancing at Different Z-Depth

Content nodes render behind keywords at `z = CONTENT_Z_DEPTH` (500 world units behind keywords in the R3F version). In the instance CHOP for content nodes, set the `tz` channel to a constant negative value:

```
Channel:   tx       ty       tz        sx      sy      sz      cr      cg      cb
Sample 0:  -200.1    95.3    -500.0    0.40    0.40    0.40    0.847   0.223   0.441
```

The Geometry COMP for content (`geo_content`) uses an identical Instance page setup as keywords, just pointing to a different Instance CHOP (`chop_content_instances`).

---

## 4. Materials for Instanced Geometry

### 4.1 Constant MAT (MeshBasicMaterial Equivalent)

The Constant MAT is TouchDesigner's equivalent of Three.js `MeshBasicMaterial`. It is **unlit** -- it ignores scene lights and outputs a flat constant color. This matches the R3F implementation exactly.

**Constant MAT parameters for keyword/content nodes:**

| Parameter | Value | Notes |
|---|---|---|
| Color | `(1, 1, 1)` white | Base color. Instance colors multiply this via `Cd` |
| Alpha | `1.0` | R3F uses `transparent: false` |
| Depth Test | **On** | Matches R3F `depthTest: true` |
| Depth Write | **On** | Matches R3F `depthWrite: true` |
| Wireframe | **Off** | Filled geometry |

**Per-instance color via Cd attribute.** When instancing is enabled on the Geometry COMP and instance color channels (`cr`, `cg`, `cb`) are mapped, TD injects per-instance color into the render pipeline as the `Cd` (color diffuse) vertex attribute. The Constant MAT must be configured to use this attribute:

- Look for a parameter labeled **Color Map** or **Use Point Color** or **Vertex Color** on the Constant MAT
- If the Constant MAT in your build does not expose an explicit "use vertex color" toggle, the instance color from the Geometry COMP's Instance page is typically applied automatically when instancing is active
- Test by setting instance colors to a visible value (e.g., bright red) and verifying the rendered output matches. If instances render white despite colored CHOP data, the material is not reading `Cd`

### 4.2 Phong MAT as Alternative

If the Constant MAT does not pick up instance colors in your TD build, the Phong MAT has more explicit controls:

- Look for **Map Color to Diffuse** or **Use SOP Color (Cd)** parameters
- Set lighting to minimal: ambient light at full intensity, no directional/point lights
- This is heavier than Constant MAT (lighting calculations still run) but gives more explicit control over color attribute binding

### 4.3 GLSL MAT for Full Control

For maximum control over per-instance color (including alpha), use a custom GLSL MAT. TouchDesigner's GLSL MAT system provides built-in uniforms and vertex attributes from the instancing pipeline.

**Minimal unlit vertex-colored shader:**

Vertex shader:
```glsl
// TouchDesigner provides matrix uniforms. Exact names depend on your
// TD build's GLSL template. Common patterns:
uniform mat4 uTDMat;          // Combined MVP (or use separate P*V*M)

in vec3 P;                     // Vertex position (TD convention)
in vec4 Cd;                    // Per-instance color (RGBA, populated by instancing)

out vec4 vColor;

void main() {
    vColor = Cd;
    gl_Position = uTDMat * vec4(P, 1.0);
    // Note: TD's instancing pipeline automatically applies the instance
    // transform matrix before this shader runs, so P is already in
    // world space for the specific instance.
}
```

Fragment shader:
```glsl
in vec4 vColor;
out vec4 fragColor;

void main() {
    fragColor = vColor;        // Flat unlit output, alpha included
}
```

**Important caveat:** The exact uniform names (`uTDMat`, `TDDeform`, etc.) and attribute names (`P`, `Cd`, `N`) depend on which GLSL template TouchDesigner generates for your MAT. The default template includes `#include` directives that define TD-specific helpers. To see the actual names:

1. Create a GLSL MAT, open the vertex shader DAT
2. Examine the auto-generated template header (first ~50 lines)
3. The template will show the exact uniform/attribute declarations

In many TD builds, the vertex shader template uses `TDDeform(P)` instead of raw matrix multiplication, which handles instancing transforms automatically.

### 4.4 Material for Edges

For edge lines (covered in detail in a separate document), the material setup depends on rendering approach:

| Approach | Material | Notes |
|---|---|---|
| Open polygon primitives | Constant MAT, Wireframe: **On** | Simple, 1px lines |
| Ribbon geometry (Sweep SOP) | Constant MAT, Wireframe: **Off** | Thick lines, more geometry |
| GLSL line rendering | GLSL MAT with `GL_LINE_STRIP` | Most control, driver-dependent width |

Line width in OpenGL is often clamped to 1px on modern GPU drivers. For thick edges, use ribbon/quad geometry.

---

## 5. Per-Instance Opacity

### 5.1 How R3F Handles Opacity (Without Alpha)

The current R3F implementation does **not** use alpha transparency for per-instance opacity. Instead, it premultiplies opacity into the RGB color:

```typescript
// Dim 2-hop keywords to 60%
colorRef.current.multiplyScalar(0.6);

// Apply search opacity
colorRef.current.multiplyScalar(searchOpacity);
```

This darkens nodes toward black rather than making them transparent. The material has `transparent: false`. This avoids all alpha-related complications (blending, sorting, depth write conflicts).

### 5.2 Porting Premultiplied Opacity to TD

The simplest port matches R3F exactly: multiply opacity into the RGB channels in the instance CHOP, and use no alpha blending:

```
cr_final = cr * searchOpacity * tierOpacity
cg_final = cg * searchOpacity * tierOpacity
cb_final = cb * searchOpacity * tierOpacity
```

In a CHOP network: `Math CHOP` (multiply) on the `cr`, `cg`, `cb` channels.

### 5.3 True Alpha Transparency (If Desired)

If you want true transparency instead of darkening (e.g., seeing background through dimmed nodes), you need:

1. **Add an alpha channel** to the instance CHOP: channel `ca` with values 0.0-1.0
2. **Map it on the Instance page**: set **Color A** (or **Alpha**) to the `ca` channel name
3. **Enable blending on the material**:
   - On Constant MAT or GLSL MAT, find the **Common** page
   - **Blending**: **On**
   - **Blend Mode**: **Alpha** (standard alpha blending)
4. **Disable depth write for transparent geometry**:
   - **Depth Write**: **Off** (prevents transparent surfaces from occluding things behind them)
   - **Depth Test**: **On** (still occlude things in front)

**Caveats for transparent instancing:**

- GPU instancing renders all instances in a single draw call. Within that draw call, individual instances are **not depth-sorted**. If transparent instances overlap each other, you may see ordering artifacts.
- This is the same limitation as Three.js `InstancedMesh` with transparency -- the R3F codebase deliberately avoids alpha for this reason.
- If you need transparency with correct ordering between layers (e.g., content nodes behind keywords), use **separate Render TOPs** and composite them (see Section 7).
- For subtle transparency (alpha > 0.8), sorting artifacts are usually not noticeable.

### 5.4 Alpha Test (Hard Cutoff Alternative)

For nodes that should be either fully visible or fully hidden (no partial transparency), use **alpha test** instead of blending:

- On the material: **Alpha Test**: **On**, **Alpha Cutoff**: `0.5`
- Instances with alpha < 0.5 are discarded entirely (not rendered)
- No sorting issues, no blending overhead
- Good for zoom-dependent visibility where nodes pop in/out

---

## 6. Frustum Culling

### 6.1 R3F Behavior

The R3F implementation explicitly disables frustum culling on all instanced meshes:

```tsx
<instancedMesh frustumCulled={false} ... />
```

This is necessary because Three.js computes the frustum culling bounding sphere from the base geometry only, not accounting for instance transforms spread across a large area. With culling enabled, the entire instanced mesh disappears when the base geometry's origin leaves the camera frustum, even though many instances are still visible.

### 6.2 TouchDesigner Default Behavior

TouchDesigner handles frustum culling differently from Three.js:

- **Object-level culling**: TD may cull entire Geometry COMPs based on their bounding box. For instanced geometry, the bounding box should encompass all instance positions. Whether TD automatically expands bounds to cover instances depends on the build.
- **No per-instance culling**: Individual instances within a single Geometry COMP are not culled separately. The entire instanced draw call either renders or does not.

### 6.3 Controlling Culling in TD

If instances disappear when panning the camera, the Geometry COMP's bounding box is too small:

1. **Check the Geometry COMP** for a **Bounds** or **Bounding Box** parameter on its Render page. Some builds let you manually set bounds.
2. **Ensure camera clip planes are generous**: On the Camera COMP:
   - **Near**: `0.1` (matching R3F)
   - **Far**: `100000` (matching R3F)
   - Tight clip planes help reduce Z-fighting and overdraw but won't cull instances that are within the frustum.
3. **If culling is aggressive**, try setting the Geometry COMP's bounding box explicitly to encompass your entire graph area. Some builds expose a **Compute Bounds** toggle.

### 6.4 Backface Culling (Different Concept)

Note: TouchDesigner materials may have a **Cull Face** parameter (Back/Front/None). This is **backface culling** (hiding polygons facing away from camera), not frustum culling. For 2D graph nodes facing the camera:
- **Cull Face**: **None** or **Back** -- either works since circles/rects face the camera

---

## 7. Render Order Control

### 7.1 The Problem

Keywords render at `z=0`, content nodes at `z=-500` (behind keywords). Edges are at `z=0`. With opaque rendering and depth testing, the depth buffer handles ordering correctly: nearer objects occlude farther ones.

The complexity arises when transparency is involved, or when you want explicit layer control independent of Z-depth.

### 7.2 Approach A: Depth Buffer (Default, Recommended)

With `depthTest: true` and `depthWrite: true` on all materials, the Z-buffer handles render order automatically:

- Keyword nodes at z=0 render **in front of** content nodes at z=-500
- No manual sorting needed
- Works perfectly for opaque geometry
- This matches the R3F implementation

### 7.3 Approach B: Multiple Render TOPs (Layer Compositing)

For more explicit control, especially with transparency or overlay effects:

**Network:**
```
cam1 (Camera COMP, shared)

render_content (Render TOP)
  - Geometry: geo_content, geo_edges
  - Camera: cam1
  - Clear Color Alpha: 0 (transparent background)

render_keywords (Render TOP)
  - Geometry: geo_keywords
  - Camera: cam1
  - Clear Color Alpha: 0

over1 (Over TOP)
  - Input 0: render_content
  - Input 1: render_keywords
  - Result: keywords composited over content
```

**Render TOP parameters:**

| Parameter | render_content | render_keywords |
|---|---|---|
| Camera | `cam1` | `cam1` |
| Geometry | `geo_content geo_edges` | `geo_keywords` |
| Clear Color | `(0, 0, 0, 0)` | `(0, 0, 0, 0)` |
| Pixel Format | RGBA 8-bit or higher | RGBA 8-bit or higher |

The **Over TOP** composites the keyword layer on top of the content layer. The output goes to your display or downstream processing.

Advantages of multi-pass:
- Each layer can have independent blending/transparency settings
- Overlay geometry (labels, highlights) can be composited without depth interactions
- You can insert post-processing (blur, glow) between layers

Disadvantages:
- More Render TOPs = more GPU passes
- Depth interactions between layers require sharing depth buffers (complex)
- Slight performance overhead for a simple 2-layer scene

### 7.4 Approach C: Render Order / Priority Parameter

Some TD builds expose a **Render Order** or **Draw Priority** parameter on the Geometry COMP. If available:
- Content nodes: render order `0` (drawn first)
- Keywords: render order `1` (drawn second, on top)

Combined with appropriate depth test settings, this gives explicit draw order within a single Render TOP.

### 7.5 Depth Test/Write Overrides for Overlays

For geometry that should always render on top regardless of Z-position (e.g., hover highlights, selection indicators):

| Parameter | Value | Effect |
|---|---|---|
| Depth Test | **Off** | Ignores depth buffer, always renders |
| Depth Write | **Off** | Does not update depth buffer |

Apply these on the material of the overlay Geometry COMP. The overlay will render on top of everything in the same Render TOP.

---

## 8. Performance Characteristics

### 8.1 GPU Instancing vs Alternatives

TouchDesigner offers several ways to render many copies of the same geometry. GPU instancing (via the Geometry COMP Instance page) is the most efficient:

| Method | Draw Calls (N objects) | GPU Memory | CPU Cook Cost | Best For |
|---|---|---|---|---|
| **Geometry COMP Instancing** | 1 per material | Low (1 copy of geometry) | Minimal | Many identical shapes |
| **Copy SOP to Points** | 1 (merged SOP) | High (N copies baked into mesh) | High if positions change per-frame | Static or infrequent updates |
| **N Geometry COMPs** | N | N copies | High (per-object overhead) | Few objects with unique meshes |

### 8.2 Instance Count Scaling

Practical limits for simple geometry (circle with 64 divisions, or quad) with Constant MAT:

| Instance Count | Expected FPS | Bottleneck |
|---|---|---|
| < 1,000 | 60fps | None |
| 1,000 - 10,000 | 60fps | Fill rate if instances are large on screen |
| 10,000 - 50,000 | 30-60fps | Vertex throughput, fill rate |
| > 50,000 | Needs profiling | GPU-dependent |

These numbers assume:
- Simple base geometry (< 100 triangles per instance)
- Constant MAT (no lighting computation)
- Opaque rendering (no blending)
- Modern discrete GPU (GTX 1060 or better)

### 8.3 What Kills Performance

1. **High triangle count per instance**: A 64-division circle is ~64 triangles. A rounded rectangle with 8 segments per corner is ~40 triangles. Both are fine. A 256-division circle would be wasteful.

2. **Transparent blending with overdraw**: If many transparent instances overlap on screen, each pixel is blended multiple times. For a graph with hundreds of overlapping transparent circles, this becomes fill-rate bound. The R3F implementation avoids this by using opaque rendering with premultiplied opacity.

3. **Per-frame CHOP updates**: Updating a 7-channel CHOP with 1000 samples per frame is trivial for TD's CHOP engine. The bottleneck is usually the Python computation that generates the values, not the CHOP upload.

4. **Script SOP re-cooking**: For edges generated by Script SOP, Python per-vertex computation scales poorly beyond ~1000 edges. Mitigate with manual cook triggering, NumPy vectorization, or GLSL rendering.

### 8.4 Profiling in TouchDesigner

Use the **Performance Monitor** (Dialogs > Performance Monitor) to identify bottlenecks:

- **GPU Time**: How long the GPU spends rendering. High values indicate fill rate or vertex processing issues.
- **Cook Time**: How long operators take to update. High Script CHOP/SOP cook times indicate Python bottleneck.
- **Draw Calls**: Visible in render stats. Should be ~3 for the full graph (keywords + content + edges).

### 8.5 Draw Call Budget

The R3F implementation uses 3 draw calls for all geometry. Target the same in TD:

| Draw Call | Geometry COMP | Material |
|---|---|---|
| 1 | `geo_keywords` (instanced circles) | `mat_keywords` (Constant MAT) |
| 2 | `geo_content` (instanced rounded-rects) | `mat_content` (Constant MAT) |
| 3 | `geo_edges` (single SOP, all edge primitives) | `mat_edges` (Constant MAT) |

Changing material per-Geometry COMP does not add draw calls (each COMP already gets its own call). Changing material **within** a single Geometry COMP's SOP network (e.g., via Material SOP assigning different MATs to different primitives) may increase draw calls.

---

## 9. Instance Data Sources: CHOP vs DAT

### 9.1 When to Use CHOP

**Use a CHOP** for instance data that updates every frame (e.g., positions from a running force simulation, zoom-dependent scales):

- CHOP channels are contiguous float arrays in memory, similar to Three.js `Float32Array` buffers
- The Geometry COMP reads CHOPs with minimal overhead -- the CHOP-to-GPU upload path is optimized
- No string parsing or type conversion (unlike DAT)

**Script CHOP pattern** for generating instance data:

```python
def onCook(scriptOp):
    scriptOp.clear()
    n = 500  # number of instances

    tx = scriptOp.appendChan('tx')
    ty = scriptOp.appendChan('ty')
    tz = scriptOp.appendChan('tz')
    sx = scriptOp.appendChan('sx')
    sy = scriptOp.appendChan('sy')
    sz = scriptOp.appendChan('sz')
    cr = scriptOp.appendChan('cr')
    cg = scriptOp.appendChan('cg')
    cb = scriptOp.appendChan('cb')

    scriptOp.numSamples = n

    for i in range(n):
        tx[i] = positions[i][0]
        ty[i] = positions[i][1]
        tz[i] = 0.0
        sx[i] = sy[i] = sz[i] = scale_value
        cr[i] = colors[i][0]
        cg[i] = colors[i][1]
        cb[i] = colors[i][2]
```

Set Cook Type to **Frame** for per-frame updates.

### 9.2 When to Use DAT

**Use a Table DAT** for instance data that changes infrequently (e.g., cluster assignments, base colors computed once when data loads):

- Easier to inspect and debug (visible as a table)
- Good for data loaded from file or database
- Can be edited manually during development

**Table DAT structure:**

```
id        tx       ty       tz      sx      cr      cg      cb
keyword1  -245.3   102.7    0.0     0.65    0.847   0.223   0.441
keyword2    87.1  -301.4    0.0     0.65    0.312   0.651   0.188
```

When using a DAT, each **row** is one instance (the header row is skipped). Column names map to the Instance page fields.

### 9.3 Hybrid: CHOP Network Without Python

For maximum CHOP performance, avoid Python entirely by building the instance pipeline in native CHOP operators:

```
Table DAT (sim positions) -> DAT to CHOP -> Merge CHOP ---> geo_keywords Instance CHOP
                                               ^
CHOP (camera_z) -> Math CHOP (scale calc) ----/
Table DAT (node colors)   -> DAT to CHOP ----/
```

This is less flexible than Python but avoids all Script CHOP cooking overhead.

---

## 10. Instance Picking (Click/Hover)

### 10.1 The Problem

In R3F, clicking an `InstancedMesh` provides `event.instanceId` automatically. TouchDesigner does not have this built-in for instanced geometry.

### 10.2 GPU Color-Pick Pass (Recommended)

Render a hidden pass where each instance is drawn with a unique flat color encoding its instance index:

1. Create a second Render TOP (`render_pick`)
2. Create a GLSL MAT (`mat_pick`) that outputs instance index as color:
   ```glsl
   // Fragment shader
   uniform int uInstanceID;  // Or use gl_InstanceID if available
   out vec4 fragColor;
   void main() {
       // Encode instance ID as RGB (supports up to 16M instances)
       int id = gl_InstanceID;
       float r = float(id % 256) / 255.0;
       float g = float((id / 256) % 256) / 255.0;
       float b = float((id / 65536) % 256) / 255.0;
       fragColor = vec4(r, g, b, 1.0);
   }
   ```
3. Read the pixel under the mouse cursor from `render_pick` using a **TOP to CHOP** with a single-pixel crop at the mouse position
4. Decode the RGB value back to an instance index

Note: `gl_InstanceID` availability in TD's GLSL pipeline depends on the build and renderer version. If not available, pass instance index as a custom per-instance attribute from a CHOP channel.

### 10.3 CPU Ray Cast (Simpler, Less Accurate)

For a simpler approach with 2D graph nodes:

1. Read mouse position from **Mouse In CHOP**
2. Unproject screen coordinates to world space using the Camera COMP's projection matrix
3. Compare world mouse position against all node positions (from the instance CHOP)
4. Find the nearest node within a radius threshold

This is O(N) per frame but fast enough for < 5000 nodes. For a 2D graph (all nodes at z=0), the unprojection is straightforward.

---

## 11. Network Wiring Reference

### 11.1 Complete Operator Layout

```
/project1/topics/
  |
  |-- geo_keywords          (Geometry COMP)
  |   |-- circle1           (Circle SOP, r=10, divisions=64, polygon)
  |   |-- polyfill1          (PolyFill SOP, fills the circle)
  |   +-- mat_keywords       (Constant MAT, vertex colors)
  |
  |-- geo_content           (Geometry COMP)
  |   |-- roundrect1        (Script SOP, rounded rectangle)
  |   |-- polyfill2          (PolyFill SOP, fills the rect)
  |   +-- mat_content        (Constant MAT, vertex colors)
  |
  |-- geo_edges             (Geometry COMP)
  |   |-- script_edges       (Script SOP, generates all arc lines)
  |   +-- mat_edges          (Constant MAT, vertex colors, wireframe)
  |
  |-- cam1                  (Camera COMP, FOV=10, tz=10500)
  |
  |-- render1               (Render TOP, renders all Geo COMPs)
  |
  |-- chop_keyword_instances  (Script CHOP: tx,ty,tz,sx,sy,sz,cr,cg,cb)
  |-- chop_content_instances  (Script CHOP: same channels, tz=-500)
  |
  |-- sim_positions           (Table DAT, from force simulation)
  |-- content_positions       (Table DAT, from content simulation)
  |-- node_colors             (Table DAT, computed from PCA/cluster)
  +-- edge_list               (Table DAT, source/target pairs)
```

### 11.2 Instance Page Wiring

**geo_keywords Instance page:**
```
Instancing:       On
Instance OP:      ../chop_keyword_instances
Translate X:      tx
Translate Y:      ty
Translate Z:      tz
Scale X:          sx
Scale Y:          sy
Scale Z:          sz
Color R:          cr
Color G:          cg
Color B:          cb
```

**geo_content Instance page:** identical structure, pointing to `../chop_content_instances`.

### 11.3 Camera COMP Settings

| Parameter | Value | R3F Equivalent |
|---|---|---|
| FOV | `10` | `fov: 10` in Canvas |
| Near | `0.1` | `near: 0.1` |
| Far | `100000` | `far: 100000` |
| Translate Z | `10500` (initial) | `position: [0, 0, 10500]` |
| Look At | `(0, 0, 0)` | Camera target |

### 11.4 Render TOP Settings

| Parameter | Value |
|---|---|
| Camera | `cam1` |
| Geometry | `geo_keywords geo_content geo_edges` |
| Resolution | Match output display |
| Anti-Alias | MSAA 4x or 8x |

---

## Appendix: R3F to TD Concept Mapping

| R3F / Three.js Concept | TouchDesigner Equivalent |
|---|---|
| `InstancedMesh` | Geometry COMP with Instancing enabled |
| `CircleGeometry` | Circle SOP (Polygon type) |
| `ShapeGeometry` (rounded rect) | Script SOP + PolyFill SOP |
| `MeshBasicMaterial` | Constant MAT |
| `vertexColors: true` | Instance Color channels on Geometry COMP |
| `InstancedBufferAttribute` (color) | CHOP channels (`cr`, `cg`, `cb`) mapped on Instance page |
| `setMatrixAt(i, matrix)` | CHOP sample `i` with `tx`, `ty`, `tz`, `sx`, `sy`, `sz` |
| `setColorAt(i, color)` | CHOP sample `i` with `cr`, `cg`, `cb` |
| `instanceMatrix.needsUpdate` | Automatic: TD detects CHOP changes |
| `frustumCulled = false` | Ensure Geometry COMP bounds encompass all instances |
| `depthTest` / `depthWrite` | Material Common page: Depth Test / Depth Write |
| `transparent: true` + alpha | Material: Blending On, Blend Mode Alpha, Depth Write Off |
| `color.multiplyScalar(opacity)` | Multiply CHOP: `cr *= opacity`, `cg *= opacity`, `cb *= opacity` |
| `useFrame()` per-frame update | Script CHOP with Cook Type: Frame |
| `event.instanceId` (click) | GPU color-pick pass or CPU ray cast |
| Render order (component order) | Z-buffer, or multiple Render TOPs + Over TOP |
