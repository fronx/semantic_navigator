# Camera Controls & Interaction -- TouchDesigner Conversion

This document details how to replicate the R3F force-directed keyword graph's camera controls and interaction system in TouchDesigner. It covers camera setup, zoom-to-cursor math, gesture classification, panning, smooth damping, instance picking, cursor-to-world conversion, hover highlighting via embedding similarity, throttling, and zoom-dependent scaling.

Source files referenced:

- `src/components/topics-r3f/CameraController.tsx`
- `src/lib/three/zoom-to-cursor.ts`
- `src/lib/three/pan-camera.ts`
- `src/lib/three/pan-handler.ts`
- `src/lib/three/gesture-classifier.ts`
- `src/lib/three/camera-controller.ts`
- `src/lib/content-scale.ts`
- `src/lib/content-zoom-config.ts`
- `src/lib/zoom-phase-config.ts`
- `src/lib/topics-hover-controller.ts`
- `src/lib/hover-highlight.ts`
- `src/lib/spatial-semantic.ts`
- `src/components/topics-r3f/KeywordNodes.tsx`

---

## 1. Camera COMP Setup

The R3F implementation uses a perspective camera with a very narrow FOV (10 degrees) positioned at large Z distances. This creates a near-orthographic projection that eliminates parallax between the 3D keyword nodes at z=0 and the DOM-based label overlay. TouchDesigner's Camera COMP supports the same approach.

### Camera COMP Parameters

The Camera COMP has parameter pages organized as **Transform** (position/rotation/scale) and **View** (projection settings). The parameters relevant to this 2.5D setup:

**Transform page:**

| UI Label | Python `par` | Value | Notes |
|----------|-------------|-------|-------|
| Translate X | `par.tx` | 0 | Centered on graph origin |
| Translate Y | `par.ty` | 0 | Centered on graph origin |
| Translate Z | `par.tz` | 10500 | Starting zoom distance |
| Rotate X | `par.rx` | 0 | Fixed -- never modify |
| Rotate Y | `par.ry` | 0 | Fixed -- never modify |
| Rotate Z | `par.rz` | 0 | Fixed -- never modify |

**View page:**

| UI Label | Python `par` | Value | Notes |
|----------|-------------|-------|-------|
| Projection | `par.projection` | Perspective | Not Orthographic -- the near-ortho effect comes from the narrow FOV |
| FOV | `par.fov` | 10 | Matches `CAMERA_FOV_DEGREES = 10` |
| Near | `par.near` | 1 | Narrow FOV means objects are far away |
| Far | `par.far` | 50000 | Must exceed `CAMERA_Z_MAX` (20000) with margin |

### Restricting to 2D Pan + Z Zoom Only

There is no "lock rotation" toggle on the Camera COMP. In practice, this is enforced by only writing to `par.tx`, `par.ty`, and `par.tz` from your interaction code. Rotation parameters (`par.rx`, `par.ry`, `par.rz`) are set once to 0 and never modified.

If using CHOP exports to drive camera position, export only the `tx`, `ty`, `tz` channels. Rotation channels are not exported, so they stay at their manually-set values.

Disable any Look At behavior on the Camera COMP (no Look At COMP reference, no constraint) -- camera position is driven entirely by Python scripts responding to mouse input.

### Key Constants (from `content-zoom-config.ts`)

```python
import math

BASE_CAMERA_Z = 1000
CAMERA_Z_MIN = BASE_CAMERA_Z * 0.05     # = 50
CAMERA_Z_MAX = BASE_CAMERA_Z * 20.0     # = 20000
CAMERA_Z_SCALE_BASE = 500               # from camera-controller.ts

CAMERA_FOV_DEGREES = 10
CAMERA_FOV_RADIANS = CAMERA_FOV_DEGREES * math.pi / 180
```

### Operator Setup

Create a Camera COMP named `/project1/camera_main`:

1. On the **View** page, set **FOV** to `10`, **Near** to `1`, **Far** to `50000`, **Projection** to `Perspective`.
2. On the **Transform** page, set **Translate Z** to `10500`, **Translate X** and **Translate Y** to `0`.
3. Ensure all **Rotate** values are `0`.
4. Do not set a Look At target.

Wire this Camera COMP into your Render TOP's "Camera" parameter.

Python verification:

```python
cam = op('/project1/camera_main')
cam.par.fov = 10
cam.par.near = 1
cam.par.far = 50000
cam.par.tx = 0
cam.par.ty = 0
cam.par.tz = 10500
cam.par.rx = 0
cam.par.ry = 0
cam.par.rz = 0
```

---

## 2. Zoom-to-Cursor Math

The zoom-to-cursor algorithm keeps the world point under the mouse cursor fixed in screen space while changing the camera's Z distance. This is more natural than zoom-to-center because the user can focus on any part of the graph.

### Algorithm

Given the current camera position `(camX, camY, camZ)`, a new Z distance `newZ`, and the cursor position in normalized device coordinates (NDC, range -1 to +1), the algorithm:

1. Computes the visible world rectangle at z=0 for the old camera Z.
2. Finds the world position under the cursor using NDC + visible dimensions.
3. Computes the new visible world rectangle at z=0 for the new camera Z.
4. Adjusts camera X and Y so the same world point maps to the same NDC position.

The core math simplifies to: `newCameraXY = cursorWorldXY + (oldCameraXY - cursorWorldXY) * (newZ / oldZ)`. The expanded form below makes each step explicit for clarity.

### Python Port

```python
import math

CAMERA_FOV_DEGREES = 10
CAMERA_FOV_RADIANS = CAMERA_FOV_DEGREES * math.pi / 180
ZOOM_FACTOR_BASE = 1.003
PINCH_ZOOM_MULTIPLIER = 3

CAMERA_Z_MIN = 50
CAMERA_Z_MAX = 20000

def calculate_zoom_factor(delta_y, is_pinch=False):
    """
    Exponential zoom factor from scroll delta.
    Gives consistent perceptual zoom speed at all zoom levels.
    """
    effective_delta = delta_y * PINCH_ZOOM_MULTIPLIER if is_pinch else delta_y
    return ZOOM_FACTOR_BASE ** effective_delta

def calculate_zoom_to_cursor(old_z, new_z, cam_x, cam_y, cursor_ndc_x, cursor_ndc_y, aspect):
    """
    Calculate new camera position for zoom-to-cursor behavior.
    The point under the cursor remains fixed in screen space during zoom.

    Parameters:
        old_z: current camera Z position
        new_z: target camera Z position after zoom
        cam_x, cam_y: current camera X, Y
        cursor_ndc_x, cursor_ndc_y: cursor in NDC (-1 to +1)
        aspect: viewport width / height

    Returns:
        (new_cam_x, new_cam_y, graph_x, graph_y)
        where graph_x, graph_y is the world point that stayed fixed
    """
    half_fov = CAMERA_FOV_RADIANS / 2

    # Visible world dimensions at z=0 before zoom
    old_visible_h = 2 * old_z * math.tan(half_fov)
    old_visible_w = old_visible_h * aspect

    # World position under cursor before zoom
    graph_x = cam_x + cursor_ndc_x * (old_visible_w / 2)
    graph_y = cam_y + cursor_ndc_y * (old_visible_h / 2)

    # Visible world dimensions at z=0 after zoom
    new_visible_h = 2 * new_z * math.tan(half_fov)
    new_visible_w = new_visible_h * aspect

    # Adjust camera so cursor still points at the same world position
    new_cam_x = graph_x - cursor_ndc_x * (new_visible_w / 2)
    new_cam_y = graph_y - cursor_ndc_y * (new_visible_h / 2)

    return (new_cam_x, new_cam_y, graph_x, graph_y)
```

### Integration with Mouse In CHOP

This function is called whenever a scroll/pinch event occurs. The Mouse In CHOP provides the scroll wheel delta and cursor position. See section 8 for the full Mouse In CHOP setup and section 4 for how the result feeds into smooth damping before reaching the Camera COMP.

---

## 3. Gesture Classification

The R3F code classifies wheel events to decide between pan and zoom. This is critical for natural trackpad interaction.

### R3F Gesture Classification

| Condition | Gesture | Action |
|-----------|---------|--------|
| `ctrlKey` set (browser sets this for trackpad pinch) | `pinch` | Zoom with pinch multiplier |
| `metaKey` or `altKey` | `scroll-zoom` | Zoom (standard rate) |
| No modifier keys | `scroll-pan` | Pan |

The key insight: on macOS, when a user pinch-zooms on a trackpad, the browser synthesizes a `WheelEvent` with `ctrlKey = true`. This is how R3F distinguishes pinch from scroll without any native gesture API.

### TouchDesigner Gesture Handling

TouchDesigner's input model differs significantly from the browser's event model. There is no automatic `ctrlKey` synthesis for trackpad pinch gestures.

**Mouse In CHOP** provides these scroll-related channels:

- `scrollx` -- horizontal scroll (accumulated value, not delta)
- `scrolly` -- vertical scroll (accumulated value, not delta)

The CHOP does not have separate channels for pinch vs scroll. Both trackpad two-finger scroll and scroll wheel produce the same `scrollx`/`scrolly` channel output.

**Trackpad pinch-to-zoom on macOS:**
- On macOS, trackpad pinch gestures may or may not reach TouchDesigner as scroll events. The OS-level gesture routing depends on how TD handles `NSMagnificationGestureRecognizer` vs `NSScrollWheel` events. In practice, trackpad pinch often arrives as scroll data through the same pathway, but with smaller delta values. This is hardware and TD-build dependent.
- TouchDesigner does not provide a `Touch In CHOP` equivalent that reliably distinguishes pinch gestures from two-finger scroll on macOS trackpads. The `Touch In CHOP` is designed for multi-touch screens and TUIO devices, not macOS trackpad gestures.

**Windows touch:**
- On Windows touch screens, `Touch In CHOP` provides per-touch-point tracking (touch ID, x, y, state). You can detect pinch by tracking two simultaneous touch points and computing the distance between them.
- On Windows with a precision trackpad, the situation is similar to macOS -- two-finger scroll and pinch may not be distinguishable at the CHOP level.

### Recommended TD Gesture Strategy

Since reliable pinch detection is not available through Mouse In CHOP, use modifier keys to disambiguate:

| Input | Gesture | Action |
|-------|---------|--------|
| Scroll wheel (no modifier) | scroll-pan | Pan camera X/Y |
| Scroll wheel + Alt/Option held | scroll-zoom | Zoom (scroll Y drives camera Z) |
| Left-click drag | drag-pan | Pan camera X/Y |

**Panel Execute DAT** provides modifier key state that Mouse In CHOP does not:

```python
# Panel Execute DAT on the render panel

def onMouseWheel(panelValue, u, v, wheel):
    """
    Called on scroll wheel events within the panel.

    Parameters:
        panelValue: the Panel value object
        u, v: normalized panel coordinates (0-1)
        wheel: scroll delta (positive = scroll up)
    """
    # Check modifier keys via panel state
    alt_held = panelValue.owner.panel.alt
    ctrl_held = panelValue.owner.panel.ctrl

    if alt_held or ctrl_held:
        # Zoom mode
        handle_zoom(u, v, wheel, is_pinch=ctrl_held)
    else:
        # Pan mode
        handle_scroll_pan(wheel)
```

**Alternative: dedicated zoom gesture.** If modifier keys feel awkward, assign scroll wheel to zoom (the more common desktop convention) and use left-click drag exclusively for panning. This avoids the gesture classification problem entirely:

| Input | Action |
|-------|--------|
| Scroll wheel | Zoom to cursor |
| Left-click drag | Pan |

This matches many desktop CAD and mapping applications.

### Platform Differences Summary

| Platform | Two-finger scroll | Pinch | Discrete scroll wheel |
|----------|-------------------|-------|----------------------|
| macOS trackpad | `scrollx`/`scrolly` channels | Usually arrives as scroll data, not distinguishable | Same channels |
| Windows trackpad | `scrollx`/`scrolly` channels | Same as macOS -- not reliably distinguishable | Same channels |
| Windows touch screen | Not applicable | Detectable via `Touch In CHOP` (two points) | Not applicable |
| External mouse | `scrolly` channel (typically larger discrete steps) | Not applicable | `scrolly` channel |

---

## 4. Smooth Damping

The R3F implementation uses OrbitControls with `enableDamping` and `dampingFactor=0.05` for smooth camera deceleration. In TouchDesigner, this effect is achieved with CHOP-based filtering.

### Approach A: Filter CHOP (Simplest)

Place a **Filter CHOP** between the Python-computed camera target values and the Camera COMP parameters.

1. Create three Constant CHOPs (or a single multi-channel one) for `target_tx`, `target_ty`, `target_tz` -- these are the values that the zoom/pan Python scripts write to.
2. Pipe them into a **Filter CHOP**.
3. Set Filter CHOP type to **Low Pass** with a **Filter Width** of approximately `0.1` to `0.2` seconds. This creates the exponential decay that matches the `dampingFactor=0.05` feel at 60fps.
4. Export the Filter CHOP outputs to the Camera COMP's Translate X, Y, Z parameters.

```
[Constant CHOP: camera_target]  -->  [Filter CHOP: camera_smooth]  -->  [Camera COMP]
   tx, ty, tz (set by Python)          type=lowpass, width=0.15           exported params
```

The Filter CHOP performs frequency-domain filtering. For camera smoothing, the Low Pass type with a cutoff specified in seconds is the right choice. Lower Filter Width values = faster response (less smoothing), higher values = more inertia.

### Approach B: Lag CHOP (More Intuitive)

The **Lag CHOP** provides first-order exponential smoothing with a more intuitive parameterization than Filter CHOP. It performs `output += (input - output) * factor` each frame -- exactly matching the Three.js damping model.

Key Lag CHOP parameters:

| UI Label | Description |
|----------|-------------|
| Lag | Time constant in seconds. Higher = slower approach to target. |
| Lag 1 / Lag 2 | Some builds expose separate rise/fall lag for asymmetric smoothing (rising input vs falling input). |
| Method | Exponential (default). |
| Overshoot | Not available -- Lag CHOP is first-order, so it never overshoots. For spring-like overshoot, use Filter CHOP in a resonant mode or implement manually. |

Lag CHOP is preferred over Filter CHOP when you want direct control over the "approach speed" and do not need frequency-domain thinking.

```
[Constant CHOP: camera_target]  -->  [Lag CHOP: camera_smooth]  -->  [Camera COMP]
   tx, ty, tz (set by Python)          lag=0.15 seconds                  exported params
```

### Approach C: Python Lerp (Most Control)

If you want to match the exact Three.js lerp behavior:

```python
# In an Execute DAT (frame callback) or Script CHOP

DAMPING_FACTOR = 0.05

class CameraSmooth:
    def __init__(self):
        self.current_x = 0
        self.current_y = 0
        self.current_z = 10500
        self.target_x = 0
        self.target_y = 0
        self.target_z = 10500

    def set_target(self, tx, ty, tz):
        self.target_x = tx
        self.target_y = ty
        self.target_z = tz

    def update(self):
        """Call once per frame. Returns (x, y, z) for camera position."""
        # Three.js MathUtils.lerp equivalent: current += (target - current) * factor
        self.current_x += (self.target_x - self.current_x) * DAMPING_FACTOR
        self.current_y += (self.target_y - self.current_y) * DAMPING_FACTOR
        self.current_z += (self.target_z - self.current_z) * DAMPING_FACTOR

        return (self.current_x, self.current_y, self.current_z)

camera_smooth = CameraSmooth()
```

**Script CHOP implementation** -- for tighter integration with the CHOP pipeline:

```python
# Script CHOP onCook callback
# Reads target from input CHOP, applies damping, outputs smoothed values

DAMPING_FACTOR = 0.05

def onCook(scriptOp):
    # Read target from input
    target = scriptOp.inputs[0]
    target_tx = target['tx'][0]
    target_ty = target['ty'][0]
    target_tz = target['tz'][0]

    # Fetch previous smoothed values (persisted between cooks)
    current_tx = scriptOp.fetch('current_tx', target_tx)
    current_ty = scriptOp.fetch('current_ty', target_ty)
    current_tz = scriptOp.fetch('current_tz', target_tz)

    # Lerp toward target
    current_tx += (target_tx - current_tx) * DAMPING_FACTOR
    current_ty += (target_ty - current_ty) * DAMPING_FACTOR
    current_tz += (target_tz - current_tz) * DAMPING_FACTOR

    # Store for next frame
    scriptOp.store('current_tx', current_tx)
    scriptOp.store('current_ty', current_ty)
    scriptOp.store('current_tz', current_tz)

    # Output
    scriptOp.clear()
    scriptOp.numSamples = 1
    scriptOp.appendChan('tx')[0] = current_tx
    scriptOp.appendChan('ty')[0] = current_ty
    scriptOp.appendChan('tz')[0] = current_tz
```

### Convergence Threshold

The R3F code skips zoom updates smaller than 0.01 world units (`Math.abs(newZ - oldZ) < 0.01`). Apply the same threshold in the Python lerp to avoid floating-point drift:

```python
def update(self):
    dx = self.target_x - self.current_x
    dy = self.target_y - self.current_y
    dz = self.target_z - self.current_z

    if abs(dx) > 0.01:
        self.current_x += dx * DAMPING_FACTOR
    else:
        self.current_x = self.target_x

    # Same for y and z...
```

### Spring-Damper Feel (Second-Order Smoothing)

If you want overshoot and oscillation (a "springy" camera), you need a second-order system. CHOP options:

1. **Filter CHOP with resonance** -- some Filter CHOP modes support resonance/Q factor that creates ringing. Experiment with the filter type and width.
2. **Manual spring in Script CHOP** -- track both position and velocity, apply spring force `F = -k * (pos - target) - damping * velocity`:

```python
# Second-order spring in a Script CHOP

SPRING_K = 0.1        # Spring stiffness
SPRING_DAMPING = 0.3  # Velocity damping (>2*sqrt(k) = overdamped)

def onCook(scriptOp):
    target = scriptOp.inputs[0]
    target_z = target['tz'][0]

    pos_z = scriptOp.fetch('pos_z', target_z)
    vel_z = scriptOp.fetch('vel_z', 0.0)

    # Spring force
    force = -SPRING_K * (pos_z - target_z) - SPRING_DAMPING * vel_z
    vel_z += force
    pos_z += vel_z

    scriptOp.store('pos_z', pos_z)
    scriptOp.store('vel_z', vel_z)

    scriptOp.clear()
    scriptOp.numSamples = 1
    scriptOp.appendChan('tz')[0] = pos_z
```

### Recommended Setup

Use Approach A (Filter CHOP) or B (Lag CHOP) for the initial port. They require no custom code and integrate cleanly with the CHOP pipeline. Switch to Approach C only if you need frame-exact matching with the Three.js behavior or want to add custom easing curves.

---

## 5. Render Pick for Click/Hover Detection

In R3F, clicking an `<instancedMesh>` fires an `onClick` event with `event.instanceId` identifying which instance was hit. The Three.js raycaster handles this internally. In TouchDesigner, the equivalent is the **Render Pick CHOP** or **Render Pick DAT**.

### How Instance Picking Works in R3F

The `KeywordNodes.tsx` component:
1. Renders an `<instancedMesh>` with N circle instances.
2. Attaches `onClick={handleClick}` to the mesh.
3. R3F's event system raycasts on click and returns `event.instanceId` (the index into the instance array).
4. The handler maps `instanceId` to `simNodes[instanceId].id` to get the keyword ID.

### TouchDesigner Render Pick Setup

TD's picking system uses a GPU-based ID buffer approach rather than CPU raycasting. It renders the scene with each object/instance encoded as a unique color, then reads back the pixel under the cursor to identify what was hit.

**Step 1: Render Pick CHOP**

Create a **Render Pick CHOP** and configure:

| Parameter | Value | Notes |
|-----------|-------|-------|
| Render TOP | Your main render TOP path | The scene being picked from |
| Camera | `/project1/camera_main` | Must match the rendering camera |
| X | Mouse In CHOP `tx` (0-1 range) | Or Panel Execute `u` value |
| Y | Mouse In CHOP `ty` (0-1 range) | Or Panel Execute `v` value |
| Activate | `Mouse In CHOP lselect` (for click) or `1` (for continuous hover) | Controls when picking occurs |

The Render Pick CHOP outputs channels including:
- `picked` -- whether something was hit (0 or 1)
- `instanceid` -- the index of the hit instance (when picking instanced geometry)
- `geo` -- path string to the picked Geometry COMP
- `u`, `v` -- pick coordinates in render space

**Step 2: Instanced Geometry Requirement**

For Render Pick to report instance IDs, the geometry must use TouchDesigner's native instancing (via the Geo COMP's Instance page). The instance index in the pick result corresponds to the **sample index** in the Instance CHOP (0-based, matching the order instances are defined).

On the Geometry COMP's **Instance** page:
- Enable instancing (toggle on)
- Set **Instance OP** to your positions CHOP
- Map channels: **Translate X** = `tx`, **Translate Y** = `ty`, **Translate Z** = `tz`
- Optionally map color channels: **Color R** = `r`, **Color G** = `g`, **Color B** = `b`
- Instance count is automatically determined by the number of samples in the Instance CHOP

**Step 3: Python Script to Handle Picks**

Attach a CHOP Execute DAT to respond to pick results:

```python
# CHOP Execute DAT on the Render Pick CHOP output

def onValueChange(channel, sampleIndex, val, prev):
    """
    Triggered when any output channel of the Render Pick CHOP changes.

    Parameters:
        channel: td.Channel object (has .name, .owner, etc.)
        sampleIndex: sample index in the channel
        val: new value
        prev: previous value
    """
    if channel.name == 'picked' and val == 1:
        instance_id = int(op('render_pick')['instanceid'])
        handle_keyword_click(instance_id)

def handle_keyword_click(instance_id):
    """Map instance index to keyword ID and trigger filter."""
    # sim_nodes is a Table DAT or Python list containing keyword data
    keyword_table = op('keyword_data')
    if instance_id < keyword_table.numRows:
        keyword_id = keyword_table[instance_id + 1, 'id'].val  # +1 for header row
        print(f'Clicked keyword: {keyword_id}')
        # Update filter state (see section 9)
        op('interaction_state').store('selected_keyword', keyword_id)
```

### Render Pick DAT Alternative

The **Render Pick DAT** provides more detailed pick information as a table. Typical columns in recent TD builds include:

| Column | Description |
|--------|-------------|
| `u`, `v` | Pick position in render UV space |
| `hit` | Whether geometry was hit (0/1) |
| `hitGeo` or `hitComp` | Path to the picked Geometry COMP |
| `hitPrim` | Primitive index within the hit geometry |
| `hitInstance` | Instance index (for instanced geometry) |
| `hitPositionx/y/z` | World-space hit position |
| `hitNormalx/y/z` | Surface normal at hit point |
| `depth` | Depth value at hit point |

The exact column names can vary between TD builds. To verify in your target build: create a Render Pick DAT, perform a pick, and inspect the output table headers.

The DAT is useful when you need:
- World-space hit position (for tooltip placement)
- Primitive-level identification (which face of a mesh was hit)
- Multiple simultaneous picks (DAT can report multiple results)

### Hover Detection via Continuous Pick

For hover (not just click), set the Render Pick CHOP to activate continuously:

1. Set **Activate** to always-on (drive from a Constant CHOP set to `1`).
2. Drive **X** and **Y** from the Mouse In CHOP's `tx` and `ty` channels.
3. Sample the result every frame in an Execute DAT.

However, for the semantic hover highlighting system described in section 6, the R3F implementation does NOT use raycasting for hover -- it uses spatial proximity in world coordinates. The Render Pick is only strictly needed for click detection. Hover highlighting uses a radius-based spatial query because it needs to highlight semantically related nodes across the entire graph, not just the node directly under the cursor.

### Click vs Label Click Disambiguation

In the R3F app, clicking a keyword node (instanced geometry) triggers graph filtering, while clicking a label (DOM element) triggers article navigation. In TD, these are naturally separated:

- **Keyword node click**: Handled by Render Pick CHOP on the 3D geometry.
- **Label click**: If using Panel COMPs for labels, handle via Panel Execute DAT. If using Text TOPs composited over the render, you need a separate picking mechanism (possibly a second Render Pick on a label-only render pass, or hit-testing label bounding boxes in Python).

---

## 6. Cursor-to-World Conversion

The hover system needs the cursor position in world space (XY coordinates on the z=0 plane). Because the camera is fixed-orientation (looking down -Z, no rotation), this is a straightforward trigonometric calculation rather than a full matrix inverse.

### Direct Calculation (Recommended)

For a fixed-orientation camera looking down -Z at the z=0 plane, the conversion is simple:

```python
def screen_to_world(screen_x, screen_y, cam_x, cam_y, cam_z, viewport_w, viewport_h):
    """
    Convert screen pixel coordinates to world coordinates at z=0.

    Parameters:
        screen_x, screen_y: pixel position (0,0 = top-left)
        cam_x, cam_y, cam_z: camera position
        viewport_w, viewport_h: render resolution in pixels
    """
    half_fov = CAMERA_FOV_RADIANS / 2

    # NDC: -1 to +1
    ndc_x = (screen_x / viewport_w) * 2 - 1
    ndc_y = -((screen_y / viewport_h) * 2 - 1)  # Flip Y

    # Visible world dimensions at z=0
    visible_h = 2 * cam_z * math.tan(half_fov)
    visible_w = visible_h * (viewport_w / viewport_h)

    world_x = cam_x + ndc_x * (visible_w / 2)
    world_y = cam_y + ndc_y * (visible_h / 2)

    return (world_x, world_y)

def screen_radius_to_world(screen_radius_px, cam_z, viewport_h):
    """Convert a screen-space radius (pixels) to world units."""
    half_fov = CAMERA_FOV_RADIANS / 2
    visible_h = 2 * cam_z * math.tan(half_fov)
    pixels_per_unit = viewport_h / visible_h
    return screen_radius_px / pixels_per_unit
```

### General-Purpose Ray-Plane Intersection

If the camera were to rotate (not our case, but useful as a fallback), you would need proper unprojection. TouchDesigner provides matrix utilities via `tdu.Matrix`:

```python
# General approach using tdu.Matrix (for reference)
# This handles arbitrary camera orientation

cam = op('/project1/camera_main')

# Camera world transform: local space -> world space
world_xform = cam.worldTransform       # tdu.Matrix (4x4)

# View matrix: world space -> camera space
view_matrix = world_xform.inverse()    # tdu.Matrix has .inverse() method

# For a projection matrix, use the camera's parameters directly:
# cam.projection(width, height) may be available depending on TD build.
# Check: dir(cam) in the Textport to see available methods.

# tdu.Matrix operations:
#   M * tdu.Position(x, y, z)  -- transform a point
#   M * tdu.Vector(x, y, z)    -- transform a direction
#   M.inverse()                 -- compute inverse matrix
#   A * B                       -- multiply two matrices
```

**Ray-plane intersection for arbitrary camera:**

```python
def screen_to_world_general(u, v, camera_comp, viewport_w, viewport_h):
    """
    General screen-to-world for arbitrary camera orientation.
    Intersects camera ray with z=0 plane.

    Parameters:
        u, v: normalized panel coordinates (0-1)
        camera_comp: reference to Camera COMP
        viewport_w, viewport_h: render dimensions
    """
    # Convert to NDC
    ndc_x = u * 2 - 1
    ndc_y = v * 2 - 1

    # Camera position in world space
    cam_pos = tdu.Position(
        camera_comp.par.tx.eval(),
        camera_comp.par.ty.eval(),
        camera_comp.par.tz.eval()
    )

    # Compute ray direction from camera through pixel
    # Using FOV and aspect to construct the ray in camera space
    fov_rad = camera_comp.par.fov.eval() * math.pi / 180
    aspect = viewport_w / viewport_h
    half_h = math.tan(fov_rad / 2)
    half_w = half_h * aspect

    # Ray direction in camera local space (looking down -Z)
    ray_local = tdu.Vector(
        ndc_x * half_w,
        ndc_y * half_h,
        -1.0
    )

    # Transform ray to world space using camera's world transform
    world_xform = camera_comp.worldTransform
    ray_world = world_xform * ray_local  # Transform direction

    # Intersect with z=0 plane
    # Solve: cam_pos.z + t * ray_world.z = 0
    if abs(ray_world.z) < 1e-10:
        return None  # Ray parallel to plane

    t = -cam_pos.z / ray_world.z
    world_x = cam_pos.x + t * ray_world.x
    world_y = cam_pos.y + t * ray_world.y

    return (world_x, world_y)
```

For our 2.5D case with fixed camera orientation, the direct calculation in the first section is preferred -- it avoids matrix operations and is faster.

### Using Mouse In CHOP Coordinates

The Mouse In CHOP reports `tx`, `ty` in 0-1 range relative to the panel (bottom-left = 0,0). Convert to the formats needed:

```python
def mouse_to_ndc(tx, ty):
    """
    Convert Mouse In CHOP coordinates (0-1) to NDC (-1 to +1).
    Mouse In: (0,0) = bottom-left, (1,1) = top-right
    NDC: (-1,-1) = bottom-left, (1,1) = top-right
    """
    ndc_x = tx * 2 - 1
    ndc_y = ty * 2 - 1  # Mouse In already has Y-up orientation
    return (ndc_x, ndc_y)

def mouse_to_screen_pixels(tx, ty, viewport_w, viewport_h):
    """
    Convert Mouse In CHOP coordinates to screen pixels.
    Note: screen pixels have Y-down convention (0,0 = top-left).
    """
    screen_x = tx * viewport_w
    screen_y = (1 - ty) * viewport_h  # Flip Y for screen convention
    return (screen_x, screen_y)
```

---

## 7. Hover Highlighting

The R3F hover system has two layers:

1. **Spatial proximity**: Find keyword nodes near the cursor using world-space distance.
2. **Semantic expansion**: Compute the centroid embedding of nearby nodes, then highlight all nodes globally whose embeddings are similar to that centroid.

This creates a "semantic flashlight" effect -- hovering near a cluster highlights semantically related keywords across the entire graph, not just the geometrically nearby ones.

### Data Structures Required

Before hover can work, you need:

1. **Node positions**: A Table DAT or Python dict mapping keyword ID to (x, y) world position.
2. **Embedding vectors**: A Table DAT or numpy array with one 1536-dimensional embedding per keyword.
3. **Adjacency map**: A Table DAT or Python dict mapping each keyword ID to its set of neighbor IDs (from similarity edges).

### Python Port of Hover Highlight

```python
import math
import numpy as np

class HoverHighlighter:
    def __init__(self, nodes, embeddings, adjacency, similarity_threshold=0.75):
        """
        Parameters:
            nodes: list of dicts with 'id', 'x', 'y' keys
            embeddings: dict mapping keyword ID -> numpy array (1536,)
            adjacency: dict mapping keyword ID -> set of neighbor IDs
            similarity_threshold: cosine similarity cutoff (0-1)
        """
        self.nodes = nodes
        self.embeddings = embeddings
        self.adjacency = adjacency
        self.similarity_threshold = similarity_threshold
        self.highlighted_ids = set()

    def compute_highlight(self, world_x, world_y, world_radius):
        """
        Compute highlighted keyword IDs from cursor world position.

        Parameters:
            world_x, world_y: cursor position in world coordinates
            world_radius: search radius in world units

        Returns:
            set of keyword IDs to highlight, or None if cursor is in empty space
        """
        # Step 1: Find nodes within spatial radius
        spatial_nodes = []
        for node in self.nodes:
            dx = node['x'] - world_x
            dy = node['y'] - world_y
            dist = math.sqrt(dx * dx + dy * dy)
            if dist <= world_radius:
                spatial_nodes.append(node)

        spatial_ids = set(n['id'] for n in spatial_nodes)

        if len(spatial_nodes) == 0:
            self.highlighted_ids = set()
            return None  # Empty space -- no dimming

        # Step 2: Compute centroid embedding of spatial nodes
        spatial_embeddings = []
        for node in spatial_nodes:
            emb = self.embeddings.get(node['id'])
            if emb is not None:
                spatial_embeddings.append(emb)

        if len(spatial_embeddings) == 0:
            self.highlighted_ids = spatial_ids
            return spatial_ids

        centroid = np.mean(spatial_embeddings, axis=0)
        centroid = centroid / (np.linalg.norm(centroid) + 1e-10)  # Normalize

        # Step 3: Filter ALL nodes by similarity to centroid
        similar_ids = set()
        for node in self.nodes:
            emb = self.embeddings.get(node['id'])
            if emb is not None:
                similarity = np.dot(emb, centroid)
                if similarity >= self.similarity_threshold:
                    similar_ids.add(node['id'])

        # Step 4: Re-add spatial nodes that are direct neighbors of highlighted nodes
        highlighted = set(similar_ids)
        for candidate_id in spatial_ids:
            if candidate_id in highlighted:
                continue
            neighbors = self.adjacency.get(candidate_id, set())
            if neighbors & highlighted:  # If any neighbor is highlighted
                highlighted.add(candidate_id)

        # Fallback: if nothing passed similarity, use spatial nodes
        if len(highlighted) == 0:
            highlighted = spatial_ids

        self.highlighted_ids = highlighted
        return highlighted
```

### Applying Highlights to Instance Colors

Once you have the set of highlighted IDs, update instance colors in the keyword Geo COMP:

```python
# In an Execute DAT frame callback

BASE_DIM = 0.15  # Dimming factor for non-highlighted nodes (from hoverConfig.baseDim)

def apply_highlight(highlighted_ids, keyword_nodes, color_chop):
    """
    Update the instance color CHOP to dim non-highlighted nodes.

    Parameters:
        highlighted_ids: set of keyword IDs to keep bright (or None for no dimming)
        keyword_nodes: list of node dicts in instance order
        color_chop: reference to the CHOP controlling instance colors
    """
    if highlighted_ids is None:
        # No dimming -- all nodes at full brightness
        for i, node in enumerate(keyword_nodes):
            color_chop[i].r = node['base_r']
            color_chop[i].g = node['base_g']
            color_chop[i].b = node['base_b']
        return

    for i, node in enumerate(keyword_nodes):
        if node['id'] in highlighted_ids:
            # Full brightness
            color_chop[i].r = node['base_r']
            color_chop[i].g = node['base_g']
            color_chop[i].b = node['base_b']
        else:
            # Dimmed
            color_chop[i].r = node['base_r'] * BASE_DIM
            color_chop[i].g = node['base_g'] * BASE_DIM
            color_chop[i].b = node['base_b'] * BASE_DIM
```

### Throttling Hover Computation

The R3F code uses `requestAnimationFrame` to throttle hover computation to 60fps. In TouchDesigner, the execution model is different -- there is no event queue with RAF. Instead, you have two primary patterns:

**Pattern A: Execute DAT Frame Callback (Per-Frame)**

The Execute DAT's `onFrameStart` or `onFrameEnd` callbacks run once per project frame. This is the closest equivalent to RAF:

```python
# Execute DAT callbacks

def onFrameStart(frame):
    """Called once per frame at the start of the cook cycle."""
    update_hover()

def onFrameEnd(frame):
    """Called once per frame at the end of the cook cycle."""
    pass
```

If hover computation is too expensive for every frame, skip frames:

```python
def onFrameStart(frame):
    if frame % 2 == 0:  # Run hover every other frame (30fps at 60fps project)
        update_hover()
```

**Pattern B: Panel Execute DAT (Event-Based)**

The Panel Execute DAT fires Python callbacks only when mouse events occur within a panel. This is more efficient than polling every frame because it only runs when the user actually moves the mouse:

```python
# Panel Execute DAT on the render panel

def onMouseMove(panelValue, u, v, button, state):
    """
    Called when mouse moves within the panel.

    Parameters:
        panelValue: Panel value object
        u, v: normalized panel coordinates (0-1)
        button: which button is held (0=none, 1=left, etc.)
        state: modifier key state
    """
    update_hover_at(u, v)

def onMouseDown(panelValue, u, v, button, state):
    """Called on mouse button press within panel."""
    handle_click(u, v, button)

def onMouseUp(panelValue, u, v, button, state):
    """Called on mouse button release within panel."""
    handle_click_release(u, v, button)
```

**Pattern C: Time-Gated Expensive Computation**

For the semantic similarity computation (the expensive part), gate execution with a time check:

```python
import time

_last_hover_time = 0
_hover_interval = 0.033  # ~30fps throttle for expensive computation

def update_hover_at(u, v):
    """Called from Panel Execute on mouse move."""
    global _last_hover_time

    now = time.time()
    if now - _last_hover_time < _hover_interval:
        return  # Skip -- too soon since last computation
    _last_hover_time = now

    # Convert to world coordinates
    viewport_w = op('render_top').width
    viewport_h = op('render_top').height
    screen_x, screen_y = mouse_to_screen_pixels(u, 1 - v, viewport_w, viewport_h)

    cam = op('/project1/camera_main')
    world_x, world_y = screen_to_world(
        screen_x, screen_y,
        cam.par.tx.eval(), cam.par.ty.eval(), cam.par.tz.eval(),
        viewport_w, viewport_h
    )

    # Run expensive similarity computation
    highlighter = op('interaction_state').fetch('highlighter', None)
    if highlighter:
        hover_radius = screen_radius_to_world(viewport_h * 0.15, cam.par.tz.eval(), viewport_h)
        highlighted = highlighter.compute_highlight(world_x, world_y, hover_radius)
        apply_highlight(highlighted, keyword_nodes, op('instance_colors'))
```

**Pattern D: CHOP Execute DAT (Value-Change Triggered)**

The CHOP Execute DAT fires when CHOP channel values change. Useful for triggering hover updates only when the mouse actually moves (rather than polling):

```python
# CHOP Execute DAT watching mouse_in CHOP

def onValueChange(channel, sampleIndex, val, prev):
    """
    Fires when a channel value changes.

    Parameters:
        channel: td.Channel object
        sampleIndex: sample index
        val: new value
        prev: previous value
    """
    if channel.name in ('tx', 'ty'):
        # Mouse moved -- update hover
        update_hover()
```

### Recommended Throttling Strategy

Use **Panel Execute DAT** (Pattern B) for mouse events combined with **time-gating** (Pattern C) for the expensive similarity computation. This gives you:
- No wasted computation when the mouse is not moving
- Controlled update rate for the expensive part
- Clean separation of input handling from computation

---

## 8. Mouse In CHOP Configuration

The Mouse In CHOP is the primary input source for all camera interaction. Create one Mouse In CHOP (`/project1/mouse_in`) with the following configuration.

### Required Channels

| Channel | Description | Usage |
|---------|-------------|-------|
| `tx` | Mouse X position (0-1, left to right) | Cursor position for hover, zoom-to-cursor NDC |
| `ty` | Mouse Y position (0-1, bottom to top) | Same |
| `lselect` | Left button state (0 or 1) | Click detection, pan start/end |
| `mselect` | Middle button state (0 or 1) | Alternative pan trigger |
| `rselect` | Right button state (0 or 1) | Context menu (if needed) |
| `scrollx` | Scroll delta X | Horizontal scroll for panning |
| `scrolly` | Scroll delta Y | Vertical scroll: zoom (with modifier) or pan |

### Mouse In CHOP Settings

| Parameter | Value | Notes |
|-----------|-------|-------|
| Active | When Panel is Under Mouse | Respond only when hovering over the render |
| Panel | (your render Panel COMP) | Limits mouse capture to the visualization area |
| Monitor | Relative to Panel | Coordinates relative to the visualization panel |

### Scroll Delta Handling

The `scrolly` channel on the Mouse In CHOP reports **accumulated scroll**, not per-frame delta. To get the delta needed by `calculate_zoom_factor`, use one of these approaches:

**Approach A: Speed CHOP (preferred)**

A Speed CHOP computes the derivative of the input channel automatically. Wire: `mouse_in` -> `Speed CHOP` -> use the output for scroll delta. The Speed CHOP produces the per-frame change in the scroll value.

**Approach B: Manual delta tracking in Python**

```python
# Track previous scroll value
prev_scroll_y = 0

def get_scroll_delta():
    global prev_scroll_y
    current = op('mouse_in')['scrolly'].eval()
    delta = current - prev_scroll_y
    prev_scroll_y = current
    return delta
```

### Complete Input Processing Script

```python
# Execute DAT - onFrameStart callback
# Reads mouse input and updates camera target

import math

def onFrameStart(frame):
    mouse = op('mouse_in')
    cam = op('camera_main')

    tx = mouse['tx'].eval()
    ty = mouse['ty'].eval()
    lselect = mouse['lselect'].eval()
    scroll_delta = get_scroll_delta()

    viewport_w = op('render_top').width
    viewport_h = op('render_top').height
    aspect = viewport_w / viewport_h

    cam_x = cam.par.tx.eval()
    cam_y = cam.par.ty.eval()
    cam_z = cam.par.tz.eval()

    state = op('interaction_state').fetch('state', InteractionState())

    # --- Zoom ---
    if abs(scroll_delta) > 0.01:
        ndc_x, ndc_y = mouse_to_ndc(tx, ty)
        zoom_factor = calculate_zoom_factor(scroll_delta)
        new_z = max(CAMERA_Z_MIN, min(CAMERA_Z_MAX, cam_z * zoom_factor))

        new_cam_x, new_cam_y, _, _ = calculate_zoom_to_cursor(
            cam_z, new_z, cam_x, cam_y, ndc_x, ndc_y, aspect
        )

        # Set targets (smooth damping will interpolate)
        op('camera_target')['tx'] = new_cam_x
        op('camera_target')['ty'] = new_cam_y
        op('camera_target')['tz'] = new_z

    # --- Pan (click-drag) ---
    if lselect and state.is_panning:
        result = state.on_mouse_move(
            tx * viewport_w, (1 - ty) * viewport_h,
            cam_z, viewport_w, viewport_h
        )
        if result:
            world_dx, world_dy = result
            op('camera_target')['tx'] = cam_x + world_dx
            op('camera_target')['ty'] = cam_y + world_dy
    elif lselect and not state.is_panning:
        state.on_mouse_down(tx * viewport_w, (1 - ty) * viewport_h, 0)
    elif not lselect and state.is_panning:
        state.on_mouse_up()

    # --- Hover ---
    screen_x, screen_y = mouse_to_screen_pixels(tx, ty, viewport_w, viewport_h)
    world_x, world_y = screen_to_world(
        screen_x, screen_y, cam_x, cam_y, cam_z, viewport_w, viewport_h
    )

    # Compute hover radius: ~20% of viewport height in world units
    hover_screen_radius = viewport_h * 0.15
    hover_world_radius = screen_radius_to_world(hover_screen_radius, cam_z, viewport_h)

    highlighter = op('interaction_state').fetch('highlighter', None)
    if highlighter:
        highlighted = highlighter.compute_highlight(world_x, world_y, hover_world_radius)
        apply_highlight(highlighted, keyword_nodes, op('instance_colors'))

    op('interaction_state').store('state', state)
```

---

## 9. Pan Controls

Panning translates the camera in X/Y so the user can drag the visible area. Two pan modes exist:

1. **Scroll panning**: Two-finger trackpad scroll (or scroll wheel when scroll=pan is chosen in section 3).
2. **Click-drag panning**: Left mouse button drag. The pan handler tracks `mousedown` -> `mousemove` -> `mouseup` and converts screen pixel deltas to world-space deltas.

### Python Port

```python
def calculate_pan(screen_dx, screen_dy, camera_z, container_w, container_h):
    """
    Convert screen-space mouse delta to world-space camera movement.

    Parameters:
        screen_dx, screen_dy: pixel movement (positive = right/down)
        camera_z: current camera Z position
        container_w, container_h: viewport dimensions in pixels

    Returns:
        (world_dx, world_dy) to add to camera position
    """
    half_fov = CAMERA_FOV_RADIANS / 2

    # Visible world dimensions at z=0
    visible_h = 2 * camera_z * math.tan(half_fov)
    visible_w = visible_h * (container_w / container_h)

    # Pixels per world unit
    pixels_per_unit = container_h / visible_h

    # Invert: dragging right moves camera left (grabs the canvas)
    world_dx = -screen_dx / pixels_per_unit
    # Flip Y: screen Y goes down, world Y goes up
    world_dy = screen_dy / pixels_per_unit

    return (world_dx, world_dy)
```

### Click-Drag Pan State Machine

```python
class PanState:
    def __init__(self):
        self.is_panning = False
        self.last_mouse_x = 0
        self.last_mouse_y = 0

    def on_mouse_down(self, mouse_x, mouse_y, button):
        """Call on left mouse button press."""
        if button != 0:  # Only left button
            return
        self.is_panning = True
        self.last_mouse_x = mouse_x
        self.last_mouse_y = mouse_y

    def on_mouse_move(self, mouse_x, mouse_y, camera_z, container_w, container_h):
        """
        Call on mouse move. Returns (world_dx, world_dy) or None if not panning.
        """
        if not self.is_panning:
            return None

        dx = mouse_x - self.last_mouse_x
        dy = mouse_y - self.last_mouse_y
        self.last_mouse_x = mouse_x
        self.last_mouse_y = mouse_y

        return calculate_pan(dx, dy, camera_z, container_w, container_h)

    def on_mouse_up(self):
        self.is_panning = False
```

---

## 10. Zoom-Dependent Scaling

The R3F visualization crossfades between keyword-focused and content-focused views based on camera Z distance. As the user zooms in, keywords shrink and content nodes appear; as they zoom out, keywords grow and content fades.

### Scale Calculation (from `content-scale.ts`)

```python
# Zoom range configuration (from content-zoom-config.ts)
BASE_CAMERA_Z = 1000
CONTENT_TRANSITION_NEAR = BASE_CAMERA_Z * 0.05   # = 50 (fully zoomed in)
CONTENT_TRANSITION_FAR = BASE_CAMERA_Z * 10.0     # = 10000 (fully zoomed out)

def normalize_zoom(camera_z, near=CONTENT_TRANSITION_NEAR, far=CONTENT_TRANSITION_FAR):
    """
    Normalize camera Z to 0-1 range.
    Returns: 0.0 when close (zoomed in), 1.0 when far (zoomed out)
    """
    actual_near = min(near, far)
    actual_far = max(near, far)
    span = max(actual_far - actual_near, 1)
    if camera_z <= actual_near:
        return 0.0
    if camera_z >= actual_far:
        return 1.0
    return (camera_z - actual_near) / span

def calculate_scales(camera_z, near=CONTENT_TRANSITION_NEAR, far=CONTENT_TRANSITION_FAR):
    """
    Calculate all scale/opacity values from camera Z position.

    Returns dict with:
        keyword_scale: 0.3 (close) to 1.0 (far) -- linear
        content_scale: 1.0 (close) to 0.0 (far) -- exponential (invT^2)
        content_edge_opacity: same curve as content_scale
        keyword_label_opacity: 0.0 (close) to 1.0 (far) -- linear
        content_label_opacity: same curve as content_scale
    """
    t = normalize_zoom(camera_z, near, far)
    inv_t = 1.0 - t

    MIN_KEYWORD_SCALE = 0.3

    return {
        'keyword_scale': MIN_KEYWORD_SCALE + t * (1.0 - MIN_KEYWORD_SCALE),
        'content_scale': inv_t ** 2,
        'content_edge_opacity': inv_t ** 2,
        'keyword_label_opacity': t,
        'content_label_opacity': inv_t ** 2,
    }
```

### CHOP Expression Chain

This is the recommended TouchDesigner approach -- pure CHOP math, no Python needed per frame.

**Step 1: Camera Z Input**

Create a **Constant CHOP** `camera_z` that tracks the current camera Z. If using the Filter CHOP approach from section 4, tap the smoothed Z output.

**Step 2: Normalize to t (0-1)**

Use a **Math CHOP** in `Range` mode:
- Input: `camera_z`
- From Range: `50` to `10000` (near to far)
- To Range: `0` to `1`
- Clamp: On

This outputs a channel `t` where 0 = zoomed in, 1 = zoomed out.

**Step 3: Compute inv_t**

Use a **Math CHOP** in `Multiply` mode:
- Multiply by `-1`, then **Add** `1`.
- Or use an **Expression CHOP**: `1 - me.inputVal`

**Step 4: Compute Scale Values**

Create an **Expression CHOP** with multiple output channels:

```
# Channel expressions (reference the t and inv_t CHOPs)

# keyword_scale: linear 0.3 -> 1.0
keyword_scale = 0.3 + op('t_chop')['chan1'] * 0.7

# content_scale: exponential fade-in
content_scale = op('inv_t_chop')['chan1'] ** 2

# content_edge_opacity: same curve
content_edge_opacity = op('inv_t_chop')['chan1'] ** 2

# keyword_label_opacity: linear 0 -> 1
keyword_label_opacity = op('t_chop')['chan1']

# content_label_opacity: same as content_scale
content_label_opacity = op('inv_t_chop')['chan1'] ** 2
```

Or more concisely, use a single **Script CHOP** that reads camera Z and outputs all five channels:

```python
# Script CHOP cook callback

def onCook(scriptOp):
    camera_z = op('camera_smooth')['tz'].eval()
    scales = calculate_scales(camera_z)

    scriptOp.clear()
    for name, value in scales.items():
        scriptOp.appendChan(name).vals = [value]
```

**Step 5: Apply to Instances**

- **Keyword instance scale**: Multiply the base keyword scale by the `keyword_scale` channel. Feed this into the Geo COMP's Instance Scale parameter (uniform XYZ).
- **Content instance scale**: Same pattern with `content_scale`.
- **Opacity**: Multiply instance color alpha by the relevant opacity channel. If using Constant MAT with vertex colors, multiply the color CHOP's alpha channel. If using a GLSL MAT, pass opacity as a uniform or per-instance attribute.

### Visibility Threshold

The R3F code hides entire instanced meshes when their scale drops below 0.01:

```python
VISIBILITY_THRESHOLD = 0.01

# In the keyword Geo COMP render callback or via a Switch TOP
if keyword_scale < VISIBILITY_THRESHOLD:
    op('keyword_geo').render = False
else:
    op('keyword_geo').render = True
```

---

## 11. State Management

The R3F implementation uses React refs and component state to track interaction state. In TouchDesigner, there are several equivalent patterns.

### Option A: Storage Operators (Recommended)

Use the `store()` and `fetch()` methods on any operator to persist Python objects between frames:

```python
# Store state
op('interaction_state').store('hover_ids', highlighted_ids)
op('interaction_state').store('selected_keyword', 'kw:machine_learning')
op('interaction_state').store('is_panning', False)
op('interaction_state').store('camera_smooth', camera_smooth_instance)

# Retrieve state
hover_ids = op('interaction_state').fetch('hover_ids', set())
selected = op('interaction_state').fetch('selected_keyword', None)
```

Create a dedicated **Base COMP** named `interaction_state` as the storage container. This keeps all state in one discoverable location.

### Option B: Python Extension Class

For more structured state, create a Python extension on a Base COMP:

```python
# interaction_state_ext.py -- Python extension for interaction_state Base COMP

class InteractionStateExt:
    def __init__(self, ownerComp):
        self.ownerComp = ownerComp

        # Camera state
        self.camera_target_x = 0.0
        self.camera_target_y = 0.0
        self.camera_target_z = 10500.0

        # Pan state
        self.is_panning = False
        self.last_mouse_x = 0.0
        self.last_mouse_y = 0.0

        # Hover state
        self.highlighted_ids = set()
        self.hovered_keyword_id = None
        self.cursor_world_x = 0.0
        self.cursor_world_y = 0.0

        # Selection state
        self.selected_keyword_id = None
        self.is_filtered = False

        # Highlighter (initialized when data loads)
        self.highlighter = None

    def InitHighlighter(self, nodes, embeddings, adjacency):
        """Call when keyword data is loaded/updated."""
        self.highlighter = HoverHighlighter(nodes, embeddings, adjacency)

    def SetCameraTarget(self, x, y, z):
        self.camera_target_x = x
        self.camera_target_y = y
        self.camera_target_z = z

    def OnKeywordClick(self, keyword_id):
        """Handle keyword click -- toggle filter."""
        if self.selected_keyword_id == keyword_id:
            # Clicking same keyword clears filter
            self.selected_keyword_id = None
            self.is_filtered = False
        else:
            self.selected_keyword_id = keyword_id
            self.is_filtered = True

    def OnMouseLeave(self):
        """Clear hover state when mouse exits the visualization."""
        self.highlighted_ids = set()
        self.hovered_keyword_id = None
        self.cursor_world_x = 0.0
        self.cursor_world_y = 0.0
```

Access from anywhere in the project:

```python
state = op('interaction_state').ext.InteractionStateExt
state.SetCameraTarget(100, 200, 5000)
state.OnKeywordClick('kw:neural_networks')
```

### Option C: Custom Parameters

For values that need to be visible in the TouchDesigner UI (useful for debugging and live tweaking), expose state as Custom Parameters on a Base COMP:

- `Cameratargetx`, `Cameratargety`, `Cameratargetz` (Float)
- `Hoveredkeyword` (String)
- `Selectedkeyword` (String)
- `Ispanning` (Toggle)
- `Isfiltered` (Toggle)

These can be referenced in parameter expressions and exported to other operators.

### State That Maps to R3F Refs

| R3F Ref | Purpose | TD Equivalent |
|---------|---------|---------------|
| `isHoveringRef` | Whether cursor is inside the canvas | Storage or custom par `Ishovering` |
| `cursorWorldPosRef` | World position under cursor | Storage tuple or custom pars `Cursorworldx`, `Cursorworldy` |
| `cursorScreenPosRef` | Screen position of cursor | Mouse In CHOP channels directly |
| `projectInteractionRef` | Suppress click after project drag | Storage boolean |
| `highlightedIdsRef` | Currently highlighted keyword IDs | Storage set |
| `controlsRef` (OrbitControls) | Camera controls reference | Camera COMP op reference |

---

## 12. Full Operator Network Diagram

Below is the recommended operator layout for the camera and interaction subsystem.

```
/project1/
|-- mouse_in               (Mouse In CHOP)
|   tx, ty, lselect, mselect, scrollx, scrolly
|
|-- scroll_speed            (Speed CHOP on mouse_in scrolly)
|   scrolly_delta
|
|-- camera_controller       (Execute DAT - frame callback)
|   reads: mouse_in, scroll_speed, interaction_state
|   writes: camera_target
|
|-- camera_target           (Constant CHOP)
|   tx, ty, tz  (set by Python)
|
|-- camera_smooth           (Lag CHOP or Filter CHOP, lag=0.15)
|   input: camera_target
|   output: smoothed tx, ty, tz  -->  exported to camera_main
|
|-- camera_main             (Camera COMP, FOV=10)
|   tx, ty, tz driven by camera_smooth
|
|-- scale_computer          (Script CHOP or Expression CHOP)
|   input: camera_smooth tz channel
|   output: keyword_scale, content_scale, content_edge_opacity,
|           keyword_label_opacity, content_label_opacity
|
|-- render_pick             (Render Pick CHOP)
|   Render TOP, Camera: camera_main
|   X, Y from mouse_in
|   output: picked, instanceid
|
|-- pick_handler            (CHOP Execute DAT on render_pick)
|   calls interaction_state on click
|
|-- interaction_state       (Base COMP with Python extension)
|   stores: PanState, HoverHighlighter, selected keyword,
|           highlighted IDs, camera targets
|
|-- instance_colors         (Script CHOP or Table CHOP)
|   r, g, b per keyword instance
|   modified by hover highlighting
|
|-- keyword_geo             (Geo COMP with instancing)
|   Instance page:
|     Instance OP = simulation output CHOP
|     Translate X/Y/Z = tx/ty/tz
|     Color R/G/B = r/g/b (from instance_colors)
|   Scale driven by: scale_computer keyword_scale
|
|-- render_top              (Render TOP)
|   Geometry: keyword_geo (+ others)
|   Camera: camera_main
|
|-- render_panel            (Panel COMP or Container COMP displaying render_top)
|   Panel Execute DAT attached for mouse event callbacks
```

### Data Flow Summary

```
Mouse In CHOP
  |
  +--> Scroll delta (via Speed CHOP) --> calculate_zoom_factor()
  |                                        --> calculate_zoom_to_cursor()
  |                                              |
  +--> Click state --> PanState.on_mouse_down/move/up --> calculate_pan()
  |                                              |
  |                                   camera_target CHOP (tx, ty, tz)
  |                                         |
  |                                   Lag/Filter CHOP (smooth damping)
  |                                         |
  |                                   Camera COMP (final position)
  |                                         |
  |                              +----------+-----------+
  |                              |                      |
  |                        scale_computer         Render Pick CHOP
  |                              |                      |
  |                  keyword_scale,              instanceid on click
  |                  content_scale, etc.                |
  |                              |              pick_handler
  |                              |                      |
  +--> World position --> HoverHighlighter       interaction_state
                               |
                        instance_colors (dimming)
```

---

## Appendix A: Fit-to-Nodes Camera Animation

The R3F code includes a `fitToNodes()` function that animates the camera to show all nodes with padding. Port for TouchDesigner:

```python
def fit_to_nodes(nodes, padding=0.2):
    """
    Calculate camera position to frame all nodes in view.

    Parameters:
        nodes: list of dicts with 'x', 'y' keys
        padding: extra margin as fraction (0.2 = 20%)

    Returns:
        (center_x, center_y, camera_z) target values
    """
    if not nodes:
        return (0, 0, 10500)

    xs = [n.get('x', 0) for n in nodes]
    ys = [n.get('y', 0) for n in nodes]

    min_x, max_x = min(xs), max(xs)
    min_y, max_y = min(ys), max(ys)

    graph_w = max(max_x - min_x, 1)
    graph_h = max(max_y - min_y, 1)
    center_x = (min_x + max_x) / 2
    center_y = (min_y + max_y) / 2

    half_fov = CAMERA_FOV_RADIANS / 2
    viewport_w = op('render_top').width
    viewport_h = op('render_top').height
    aspect = viewport_w / viewport_h

    padded_w = graph_w * (1 + padding)
    padded_h = graph_h * (1 + padding)

    z_for_height = padded_h / (2 * math.tan(half_fov))
    z_for_width = padded_w / (2 * math.tan(half_fov) * aspect)

    camera_z = max(z_for_height, z_for_width, CAMERA_Z_MIN)

    return (center_x, center_y, camera_z)
```

To animate smoothly, set the camera target CHOP to these values and let the Lag/Filter CHOP handle the interpolation. For a more controlled animation with ease-out, use a Timer CHOP:

```python
def animate_fit(target_x, target_y, target_z, duration=0.5):
    """Start a smooth camera animation using a Timer CHOP."""
    state = op('interaction_state').ext.InteractionStateExt

    state.anim_start_x = op('camera_smooth')['tx'].eval()
    state.anim_start_y = op('camera_smooth')['ty'].eval()
    state.anim_start_z = op('camera_smooth')['tz'].eval()
    state.anim_target_x = target_x
    state.anim_target_y = target_y
    state.anim_target_z = target_z

    timer = op('fit_timer')
    timer.par.length = duration
    timer.par.start.pulse()

# Timer CHOP callback
def onTimerFraction(fraction):
    state = op('interaction_state').ext.InteractionStateExt
    # Ease-out cubic: 1 - (1-t)^3
    eased = 1 - (1 - fraction) ** 3

    x = state.anim_start_x + (state.anim_target_x - state.anim_start_x) * eased
    y = state.anim_start_y + (state.anim_target_y - state.anim_start_y) * eased
    z = state.anim_start_z + (state.anim_target_z - state.anim_start_z) * eased

    # Bypass the Lag/Filter CHOP during animation -- write directly to camera
    op('camera_main').par.tx = x
    op('camera_main').par.ty = y
    op('camera_main').par.tz = z
```

---

## Appendix B: Zoom-Phase Configuration

The R3F code uses a `ZoomPhaseConfig` object to configure multiple zoom-dependent behaviors independently. Each subsystem has its own near/far range:

```python
DEFAULT_ZOOM_PHASE_CONFIG = {
    'keyword_labels': {
        'start': 13961,   # Z above which keyword labels are hidden
        'full': 1200,     # Z below which all keyword labels show
    },
    'chunk_crossfade': {
        'near': 50,       # Chunk nodes fully visible
        'far': 10347,     # Chunk nodes fully hidden
    },
    'blur': {
        'near': 50,       # Maximum blur
        'far': 2456,      # No blur
        'max_radius': 12.5,  # Blur radius in pixels at max
    },
}
```

In TouchDesigner, create a Base COMP with Custom Parameters for each of these ranges, allowing real-time tweaking without code changes. Wire each range into its own normalize/scale chain.

---

## Appendix C: Cosine Similarity Helper

The hover highlighting system depends on cosine similarity between embedding vectors. If not using numpy:

```python
import math

def cosine_similarity(a, b):
    """Compute cosine similarity between two vectors."""
    dot = sum(x * y for x, y in zip(a, b))
    norm_a = math.sqrt(sum(x * x for x in a))
    norm_b = math.sqrt(sum(x * x for x in b))
    if norm_a < 1e-10 or norm_b < 1e-10:
        return 0.0
    return dot / (norm_a * norm_b)

def normalize_vector(v):
    """Normalize a vector to unit length."""
    norm = math.sqrt(sum(x * x for x in v))
    if norm < 1e-10:
        return v
    return [x / norm for x in v]
```

With numpy (recommended for 1536-dimensional vectors, much faster):

```python
import numpy as np

def cosine_similarity_np(a, b):
    return np.dot(a, b) / (np.linalg.norm(a) * np.linalg.norm(b) + 1e-10)

# Batch similarity: compare one centroid against all embeddings at once
def batch_cosine_similarity(centroid, embedding_matrix):
    """
    Parameters:
        centroid: (1536,) numpy array
        embedding_matrix: (N, 1536) numpy array of all keyword embeddings

    Returns:
        (N,) array of similarity scores
    """
    norms = np.linalg.norm(embedding_matrix, axis=1)
    centroid_norm = np.linalg.norm(centroid)
    dots = embedding_matrix @ centroid
    return dots / (norms * centroid_norm + 1e-10)
```

The batch version is significantly faster for large keyword sets (1000+) and is recommended for the TouchDesigner port where you have direct numpy access.

---

## Appendix D: TouchDesigner Python API Quick Reference

Key TD Python patterns used throughout this document:

```python
# Operator references
cam = op('/project1/camera_main')       # Reference by path
mouse = op('mouse_in')                   # Reference by relative name

# Parameter access
cam.par.tx.eval()                        # Read current value
cam.par.tx = 100                         # Set value
cam.par.fov = 10                         # Set on any page

# CHOP channel access
op('mouse_in')['tx'].eval()              # Read channel value
op('camera_target')['tx'] = 50.0         # Write to Constant CHOP

# Render TOP dimensions
op('render_top').width                   # Pixel width
op('render_top').height                  # Pixel height

# Persistent storage (survives between frames, cleared on project reload)
op('my_comp').store('key', value)        # Store any Python object
op('my_comp').fetch('key', default)      # Retrieve with fallback

# Transform matrices (tdu module)
cam.worldTransform                       # tdu.Matrix (4x4), local -> world
cam.worldTransform.inverse()             # World -> local (view matrix)
tdu.Position(x, y, z)                    # 3D point
tdu.Vector(x, y, z)                      # 3D direction
M * tdu.Position(x, y, z)               # Transform a point by matrix

# Panel state (from Panel Execute DAT)
panelValue.owner.panel.alt               # Alt/Option key held
panelValue.owner.panel.ctrl              # Ctrl key held
panelValue.owner.panel.shift             # Shift key held

# Time
absTime.frame                            # Current absolute frame number
absTime.seconds                          # Current absolute time in seconds
```
