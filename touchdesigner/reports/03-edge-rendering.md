# TouchDesigner Curved Edge Rendering Implementation Plan

## Current R3F System Analysis

The R3F edge rendering system implements:

**Rendering Strategy:**
- Single merged `BufferGeometry` with all edges in one draw call
- 16 segments per arc (17 vertices total)
- NaN "break" vertices between edges to create discontinuous line strips
- Per-vertex colors for gradient effects and search highlighting
- Updates every frame via `useFrame()` hook

**Arc Computation** (sagitta-based circular arc math):
1. Compute chord length between endpoints
2. Sagitta = chordLength × curveIntensity × direction
3. Radius = (L²/4 + h²) / (2h)
4. Arc center = midpoint + (radius - |sagitta|) along perpendicular
5. Sample 17 points between start/end angles

**Key Parameters:**
- `EDGE_SEGMENTS = 16` (17 vertices per edge)
- `curveIntensity = 0.25`
- `direction = ±1` (bow away from graph centroid)
- Opacity: 0.4 for keyword edges
- Z-depth: 0 for keyword edges, -500 for chunk edges

## TouchDesigner Implementation Options

### 1. Arc Computation - Python Script SOP (RECOMMENDED)

Port `computeArcPoints()` to Python in a Script SOP. The function translates directly:

```python
def compute_arc_points(x1, y1, x2, y2, curve_intensity, direction, segments=16):
    """Port of computeArcPoints() from edge-curves.ts"""
    # Full implementation in report
    pass
```

**Performance Note:** Consider NumPy vectorization for large graphs.

### 2. Line Rendering Options

#### Option A: Single Script SOP with Open Polygons (RECOMMENDED)

Create one open polygon primitive per edge within a single Script SOP.

```python
def onCook(scriptOp):
    scriptOp.clear()

    for each edge:
        arc_pts = compute_arc_points(...)
        poly = scriptOp.appendPoly(len(arc_pts), closed=False, addPoints=True)

        for i, (px, py) in enumerate(arc_pts):
            pt = poly[i].point
            pt.x = px
            pt.y = py
            pt.z = z_depth
            pt.Cd = tdu.Vector(edge_r, edge_g, edge_b)
```

**Pros:**
- Single draw call for all edges
- Per-vertex colors via `Cd` attribute
- Straightforward implementation
- Works with Line MAT or Constant MAT

**Cons:**
- Script SOP re-cooking expensive for 1000+ edges
- Python overhead for arc math

#### Option B: GLSL Geometry Shader

For 10,000+ edges, implement arc rendering on GPU. Store edge endpoints in texture, compute arc positions in vertex shader.

**Pros:**
- Maximum performance
- Scales to 100,000+ edges

**Cons:**
- Complex to implement
- Harder to debug

### 3. Discontinuous Lines (NaN Trick Alternative)

TouchDesigner doesn't support NaN vertices. Solution: Use separate primitives per edge (Option A above). TD automatically handles primitive separation - no manual break vertices needed.

### 4. Per-Vertex Colors

Use the `Cd` point/vertex attribute:

```python
pt.Cd = tdu.Vector(red, green, blue)  # 0.0-1.0
```

In Material: Enable "Use Vertex Color" parameter

**Color Blending for Edges:**
```python
edge_r = (source_r + target_r) / 2
```

**Gradient Edges (Optional):**
```python
for i in range(len(arc_pts)):
    t = i / len(arc_pts)
    r = source_r * (1 - t) + target_r * t
```

### 5. Performance Comparison

| Approach | Edge Count | FPS | Complexity | Recommendation |
|---|---|---|---|---|
| Script SOP (Python loops) | < 500 | 60fps | Low | Good for prototyping |
| Script SOP (NumPy vectorized) | < 2000 | 60fps | Medium | **Best balance** |
| GLSL MAT (GPU compute) | 10,000+ | 60fps | High | Only if needed |

**Optimization Strategies:**
1. Manual cook triggering (only when positions change)
2. Pre-allocate geometry (update positions only)
3. Reduce segments for distant edges (LOD)
4. Cull off-screen edges

### 6. Complete Code Skeleton

Full Python Script SOP implementation provided in report with:
- `compute_outward_direction()` function
- `compute_arc_points()` function with sagitta math
- Complete `onCook()` handler
- Material setup instructions

## Material Setup

**Line MAT** (recommended):
- Use Vertex Color: On
- Line Width: 1.5 pixels
- Alpha: 0.4
- Depth Test: On
- Depth Write: Off

**Constant MAT** (alternative):
- Use Vertex Color: On
- Alpha: 0.4
- Wireframe: On (if rendering filled polygons as lines)

## Summary

For 1000+ edges at 60fps, use Python Script SOP with `compute_arc_points()` creating separate open polygon primitives. TouchDesigner's automatic batching (single material, merged geometry) achieves single draw call performance matching R3F.

Upgrade to GLSL only if Script SOP can't maintain 60fps with your edge count.
