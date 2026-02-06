# Force Simulation: R3F to TouchDesigner Conversion

This document covers porting the D3-force simulation subsystem from React Three Fiber to TouchDesigner. The simulation has two layers: a **keyword simulation** that positions ~200-2000 keyword nodes via link, many-body, center, and collision forces; and a **content simulation** that arranges content chunks around their parent keywords via spring tethering and collision avoidance.

---

## Table of Contents

1. [Source Architecture Summary](#1-source-architecture-summary)
2. [Approach Options](#2-approach-options)
3. [Python Script CHOP Implementation](#3-python-script-chop-implementation)
4. [GLSL Compute Shader Approach](#4-glsl-compute-shader-approach)
5. [External Process via OSC/WebSocket](#5-external-process-via-oscwebsocket)
6. [Hybrid Approach](#6-hybrid-approach)
7. [Content Node Simulation](#7-content-node-simulation)
8. [Performance Analysis](#8-performance-analysis)
9. [Integration with Instancing](#9-integration-with-instancing)

---

## 1. Source Architecture Summary

### Keyword Simulation (`ForceSimulation.tsx`)

The keyword simulation uses D3-force with these exact parameters:

| Force | D3 Call | Parameters |
|---|---|---|
| Link (spring) | `d3.forceLink()` | `distance = 40 + (1 - similarity) * 150`, `strength = 0.2 + similarity * 0.8` |
| Many-body (repulsion) | `d3.forceManyBody()` | `strength = -200` (constant) |
| Center | `d3.forceCenter(0, 0)` | Default strength (1.0) |
| Alpha decay | `.alphaDecay(0.01)` | Slower than D3 default (0.0228) |
| Velocity decay | `.velocityDecay(0.5)` | Moderate damping |
| Initial alpha | `.alpha(0.3)` | Starting energy |

**Zoom-dependent energy injection** (`simulation-zoom-config.ts`):
- Camera Z maps through a power curve (`t^0.65`) to control simulation energy
- At low Z (zoomed in, < 1800): alpha drops to 0.01 (halted), velocity decay rises to 0.9
- At high Z (zoomed out, up to 20000): alpha at 0.30 (full energy), velocity decay at 0.5
- This prevents layout jitter when the user is reading content up close

### Content Simulation (`useContentSimulation.ts`)

A separate simulation for content chunks that orbit their parent keywords:

| Force | Implementation | Parameters |
|---|---|---|
| Collision | `d3.forceCollide()` | `radius = BASE_DOT_RADIUS * DOT_SCALE_FACTOR * sizeMultiplier * 1.2`, `strength = 0.8`, `iterations = 2` |
| Tether to parent | Custom force function | `springStrength = 0.1`, `baseDistanceMultiplier = 2.5`, `contentSpreadFactor = 1.5` |
| Alpha decay | `.alphaDecay(0.02)` | Slower cooling |
| Velocity decay | `.velocityDecay(0.3)` | Higher damping for stability |

The tether force applies a spring toward the parent keyword and enforces a hard maximum distance constraint:
```
maxDistance = keywordRadius * 2.5 + sqrt(contentCount) * contentRadius * 1.5
```

### D3-Force Core Algorithm: Velocity Verlet

Every `tick()` of D3-force performs:

```
1. alpha += (alphaTarget - alpha) * alphaDecay
2. For each force: force.apply(alpha)
3. For each node:
     velocity *= (1 - velocityDecay)
     x += velocity_x
     y += velocity_y
```

This is a simplified Velocity Verlet integrator. The key insight: forces do not directly move nodes. They modify velocity, which is then damped and integrated into position. Alpha serves as a global energy multiplier that cools the system toward equilibrium.

---

## 2. Approach Options

### Option A: Python Script CHOP

**How**: A Script CHOP runs Python code per-frame (or per cook). The script maintains node positions and velocities as Python lists/arrays, applies forces, integrates, and writes output positions to CHOP channels.

| Aspect | Assessment |
|---|---|
| Complexity | Moderate -- direct algorithmic port |
| Performance (200 nodes) | Good -- well within Python's per-frame budget |
| Performance (1000 nodes) | Marginal -- O(n^2) many-body becomes expensive |
| Interactivity | Full -- can inject perturbations, reheat, respond to zoom |
| Integration | Natural -- CHOP output feeds directly to Geo COMP instancing |

**Best for**: Prototyping, datasets under ~500 nodes, interactive installations where layout responds to input.

### Option B: GLSL Compute TOP

**How**: Store positions and velocities in floating-point textures (RGBA32F). A GLSL TOP (or series of GLSL TOPs) implements force computation and integration as pixel shaders. Each pixel represents one node; texture dimensions encode the data.

| Aspect | Assessment |
|---|---|
| Complexity | High -- must encode graph topology in textures, manage multi-pass pipeline |
| Performance (200 nodes) | Overkill -- GPU overhead not justified |
| Performance (1000 nodes) | Excellent -- GPU parallelism dominates |
| Performance (5000+ nodes) | Only viable option |
| Interactivity | Full, but parameter changes require uniform updates |
| Integration | Moderate -- must read back from TOP to CHOP for instancing, or use TOP-to-CHOP |

**Best for**: Large graphs (1000+), installations where the graph is the primary visual, situations requiring real-time layout at 60fps with thousands of nodes.

### Option C: External Node.js Process via OSC/WebSocket

**How**: Run D3-force in a separate Node.js process. Stream positions to TouchDesigner via OSC or WebSocket. TD receives position updates and applies them to instances.

| Aspect | Assessment |
|---|---|
| Complexity | Low on TD side, moderate on bridge |
| Performance | Excellent -- D3-force is highly optimized in JS |
| Latency | 1-3 frames depending on transport |
| Interactivity | Bidirectional but with latency penalty |
| Integration | OSC In CHOP or WebSocket DAT -> Table DAT -> CHOP |

**Best for**: When you want to reuse the exact D3-force behavior without porting, rapid prototyping, or when the simulation runs at a different rate than rendering.

### Option D: Hybrid (Pre-compute + Lightweight Interactive Forces)

**How**: Run D3-force once in Node.js to compute the converged layout. Load positions into TD as static data. Then use a lightweight Python simulation in TD for interactive perturbation (drag, zoom-based energy injection, gentle re-settling on data changes).

| Aspect | Assessment |
|---|---|
| Complexity | Low initial, moderate for interactive layer |
| Performance | Near-zero per-frame cost (only when perturbed) |
| Interactivity | Good -- responds to drag, zoom, but won't do full re-layout |
| Integration | Table DAT -> DAT to CHOP -> Geo COMP |

**Best for**: Installations where topology is stable, video renders, and situations where layout quality matters more than full dynamism.

### Recommendation

Start with **Option A (Python Script CHOP)** for initial development and interactive use. If node count exceeds ~500 and frame rate suffers, move many-body computation to **Option B (GLSL Compute)** while keeping link/tether forces in Python. Option C is a pragmatic escape hatch if porting the algorithm proves too time-consuming. Option D is the best starting point for installations with fixed datasets.

---

## 3. Python Script CHOP Implementation

### 3.1 Where Python Simulation Code Runs in TD

TouchDesigner offers several places to execute Python per frame. Each has trade-offs:

**Script CHOP** -- runs `onCook(scriptOp)` when the CHOP cooks. Outputs CHOP channels directly, which is ideal for feeding Geo COMP instancing. The cook fires every frame when downstream operators depend on it.

**Execute DAT** -- runs callbacks like `onFrameStart(frame)` once per frame, independent of cook dependency chains. Good for strict per-frame stepping. Must manually write results to a Table DAT or Script CHOP's storage.

**Recommended pattern**: Use an Execute DAT for the simulation tick (guaranteed once per frame, no risk of double-cooking), and a Script CHOP that reads the stored positions and outputs channels for instancing (no heavy math in the cook). This decouples simulation from render dependency order.

```
[Execute DAT: sim_ticker]     -- calls sim.tick() onFrameStart
        |
        v (writes to storage)
[Script CHOP: pos_output]     -- reads stored positions, outputs tx/ty channels
        |
        v
[Geo COMP: keyword_instances] -- instancing from CHOP
```

### 3.2 Python Libraries Available in TD

TouchDesigner ships with embedded CPython. Library availability:

| Library | Typically Available | Notes |
|---|---|---|
| `numpy` | Yes (recent TD versions) | Critical for vectorized force computation. 10-50x speedup over pure Python loops. |
| `scipy` | Usually not included | Would be useful for spatial trees, but can install manually. |
| `networkx` | Usually not included | Useful for graph algorithms but not needed for physics. |
| `igraph` | Rarely available | Compiled C dependencies make manual install difficult. |
| `math`, `random` | Always | Standard library, sufficient for pure Python simulation. |

**Verify in TD's Textport**:
```python
import numpy; print(numpy.__version__)
import scipy  # will raise ImportError if not available
```

If numpy is available, use the vectorized many-body implementation (section 3.4). If not, the pure Python Barnes-Hut (section 3.3) is the next best option.

### 3.3 Velocity Verlet Integrator (Pure Python)

The D3-force tick loop is the foundation. Here is a complete Python port:

```python
# force_simulation.py
# Designed to run inside a Script CHOP's cook() or a Script DAT called per frame.

import math
import random

class Node:
    __slots__ = ['id', 'x', 'y', 'vx', 'vy', 'fx', 'fy', 'index']

    def __init__(self, node_id, index, x=None, y=None):
        self.id = node_id
        self.index = index
        self.x = x if x is not None else random.uniform(-500, 500)
        self.y = y if y is not None else random.uniform(-500, 500)
        self.vx = 0.0
        self.vy = 0.0
        self.fx = 0.0  # Accumulated force for current tick
        self.fy = 0.0


class ForceSimulation:
    def __init__(self, nodes, edges, similarities):
        """
        nodes: list of (id, index) tuples
        edges: list of (source_index, target_index) tuples
        similarities: list of float, parallel to edges
        """
        self.nodes = [Node(nid, idx) for nid, idx in nodes]
        self.edges = edges
        self.similarities = similarities

        # Build node lookup by id
        self.node_by_id = {n.id: n for n in self.nodes}

        # Simulation parameters (matching ForceSimulation.tsx)
        self.alpha = 0.3
        self.alpha_min = 0.001
        self.alpha_decay = 0.01
        self.alpha_target = 0.0
        self.velocity_decay = 0.5

        # Force parameters
        self.charge_strength = -200.0
        self.center_x = 0.0
        self.center_y = 0.0
        self.center_strength = 1.0

    def tick(self):
        """Advance simulation by one step. Call once per frame."""
        # 1. Cool the simulation
        self.alpha += (self.alpha_target - self.alpha) * self.alpha_decay

        if self.alpha < self.alpha_min:
            return  # Simulation has converged

        # 2. Reset forces
        for node in self.nodes:
            node.fx = 0.0
            node.fy = 0.0

        # 3. Apply each force
        self._apply_link_force()
        self._apply_many_body_force()
        self._apply_center_force()

        # 4. Integrate (Velocity Verlet)
        decay = 1.0 - self.velocity_decay
        for node in self.nodes:
            node.vx = (node.vx + node.fx) * decay
            node.vy = (node.vy + node.fy) * decay
            node.x += node.vx
            node.y += node.vy

    def _apply_link_force(self):
        """Spring force along edges. Strength and rest length depend on similarity."""
        for i, (si, ti) in enumerate(self.edges):
            source = self.nodes[si]
            target = self.nodes[ti]
            sim = self.similarities[i]

            dx = target.x - source.x + (random.random() - 0.5) * 1e-6
            dy = target.y - source.y + (random.random() - 0.5) * 1e-6
            dist = math.sqrt(dx * dx + dy * dy)

            if dist == 0:
                continue

            # Target distance: high similarity = short, low similarity = long
            target_dist = 40.0 + (1.0 - sim) * 150.0

            # Spring strength: high similarity = strong spring
            strength = 0.2 + sim * 0.8

            # D3's link force formula:
            # force = (dist - targetDist) / dist * alpha * strength
            force = (dist - target_dist) / dist * self.alpha * strength

            fx = dx * force
            fy = dy * force

            # D3 applies bias based on node degree; simplified here as 0.5/0.5
            source.fx += fx * 0.5
            source.fy += fy * 0.5
            target.fx -= fx * 0.5
            target.fy -= fy * 0.5

    def _apply_many_body_force(self):
        """
        Repulsive force between all node pairs.
        Naive O(n^2) version. See Barnes-Hut section for optimization.
        """
        n = len(self.nodes)
        for i in range(n):
            ni = self.nodes[i]
            for j in range(i + 1, n):
                nj = self.nodes[j]

                dx = nj.x - ni.x + (random.random() - 0.5) * 1e-6
                dy = nj.y - ni.y + (random.random() - 0.5) * 1e-6
                dist_sq = dx * dx + dy * dy

                if dist_sq < 1e-10:
                    continue

                # D3 many-body: force = strength * alpha / dist
                # (Not dist_sq -- D3 uses dist, not dist_sq, for force magnitude)
                dist = math.sqrt(dist_sq)
                force = self.charge_strength * self.alpha / dist

                fx = (dx / dist) * force
                fy = (dy / dist) * force

                ni.fx += fx
                ni.fy += fy
                nj.fx -= fx
                nj.fy -= fy

    def _apply_center_force(self):
        """Gentle pull toward center of mass to prevent drift."""
        # D3's forceCenter moves all nodes so their centroid matches the target
        cx, cy = 0.0, 0.0
        n = len(self.nodes)
        if n == 0:
            return

        for node in self.nodes:
            cx += node.x
            cy += node.y
        cx /= n
        cy /= n

        # Shift all nodes to re-center
        shift_x = (self.center_x - cx) * self.center_strength
        shift_y = (self.center_y - cy) * self.center_strength
        for node in self.nodes:
            node.x += shift_x
            node.y += shift_y

    def reheat(self, alpha=0.3):
        """Restart simulation with new energy. Call on data changes or interactions."""
        self.alpha = alpha

    def set_zoom_energy(self, camera_z):
        """
        Zoom-dependent energy injection matching simulation-zoom-config.ts.
        Call whenever camera Z changes.
        """
        SIM_Z_MIN = 1800.0
        SIM_Z_MAX = 20000.0

        # Normalized zoom curve with 0.65 exponent
        t = max(0.0, min(1.0, (camera_z - SIM_Z_MIN) / (SIM_Z_MAX - SIM_Z_MIN)))
        curve = t ** 0.65

        # Alpha: 0.01 (halted) to 0.30 (full energy)
        target_alpha = 0.01 + curve * (0.30 - 0.01)
        if abs(target_alpha - self.alpha) > 0.01:
            self.alpha = target_alpha

        # Velocity decay: 0.9 (high damping) to 0.5 (low damping)
        self.velocity_decay = 0.9 - curve * (0.9 - 0.5)
```

### 3.4 Barnes-Hut Approximation (O(n log n) Many-Body)

For graphs exceeding ~300 nodes, the naive O(n^2) many-body force becomes the bottleneck. D3-force uses a Barnes-Hut quadtree with `theta = 0.9`. Here is the Python port:

```python
class QuadTreeNode:
    """Quadtree node for Barnes-Hut approximation."""
    __slots__ = ['cx', 'cy', 'mass', 'x0', 'y0', 'x1', 'y1',
                 'children', 'body']

    def __init__(self, x0, y0, x1, y1):
        self.x0, self.y0 = x0, y0  # Bounding box min
        self.x1, self.y1 = x1, y1  # Bounding box max
        self.cx, self.cy = 0.0, 0.0  # Center of mass
        self.mass = 0.0
        self.children = [None, None, None, None]  # NW, NE, SW, SE
        self.body = None  # Leaf node body (if exactly one)

def build_quadtree(nodes):
    """Build a quadtree from a list of nodes."""
    if not nodes:
        return None

    # Compute bounding box with padding
    min_x = min(n.x for n in nodes) - 1
    max_x = max(n.x for n in nodes) + 1
    min_y = min(n.y for n in nodes) - 1
    max_y = max(n.y for n in nodes) + 1

    # Make it square (required for consistent theta comparison)
    size = max(max_x - min_x, max_y - min_y)
    mid_x = (min_x + max_x) / 2
    mid_y = (min_y + max_y) / 2

    root = QuadTreeNode(mid_x - size/2, mid_y - size/2,
                        mid_x + size/2, mid_y + size/2)

    for node in nodes:
        _insert(root, node)

    _compute_mass(root)
    return root

def _quadrant(qt, x, y):
    """Return quadrant index (0-3) for position within this node."""
    mx = (qt.x0 + qt.x1) / 2
    my = (qt.y0 + qt.y1) / 2
    if x < mx:
        return 2 if y < my else 0  # SW or NW
    else:
        return 3 if y < my else 1  # SE or NE

def _child_bounds(qt, quadrant):
    """Return bounding box for the given quadrant."""
    mx = (qt.x0 + qt.x1) / 2
    my = (qt.y0 + qt.y1) / 2
    if quadrant == 0:    return (qt.x0, my, mx, qt.y1)   # NW
    elif quadrant == 1:  return (mx, my, qt.x1, qt.y1)   # NE
    elif quadrant == 2:  return (qt.x0, qt.y0, mx, my)   # SW
    else:                return (mx, qt.y0, qt.x1, my)    # SE

def _insert(qt, node):
    """Insert a node into the quadtree."""
    if qt.mass == 0 and qt.body is None:
        # Empty leaf -- place node here
        qt.body = node
        qt.mass = 1
        qt.cx = node.x
        qt.cy = node.y
        return

    # If this is a leaf with a body, push it down
    if qt.body is not None:
        existing = qt.body
        qt.body = None
        _insert_into_child(qt, existing)

    # Insert new node into appropriate child
    _insert_into_child(qt, node)

def _insert_into_child(qt, node):
    """Insert node into the appropriate child quadrant."""
    q = _quadrant(qt, node.x, node.y)
    if qt.children[q] is None:
        bounds = _child_bounds(qt, q)
        qt.children[q] = QuadTreeNode(*bounds)
    _insert(qt.children[q], node)

def _compute_mass(qt):
    """Recursively compute center of mass for each quadtree node."""
    if qt is None:
        return

    if qt.body is not None:
        # Leaf with single body -- mass already set
        return

    qt.cx, qt.cy, qt.mass = 0.0, 0.0, 0.0
    for child in qt.children:
        if child is not None:
            _compute_mass(child)
            qt.cx += child.cx * child.mass
            qt.cy += child.cy * child.mass
            qt.mass += child.mass

    if qt.mass > 0:
        qt.cx /= qt.mass
        qt.cy /= qt.mass


def barnes_hut_force(nodes, quadtree, strength, alpha, theta=0.9):
    """
    Apply Barnes-Hut approximated many-body force.

    theta: opening angle threshold (D3 default = 0.9).
    Higher theta = more approximation, faster.
    Lower theta = more accurate, slower.
    """
    for node in nodes:
        _apply_bh(node, quadtree, strength, alpha, theta)

def _apply_bh(node, qt, strength, alpha, theta):
    """Recursively apply Barnes-Hut force from quadtree to a single node."""
    if qt is None or qt.mass == 0:
        return

    dx = qt.cx - node.x
    dy = qt.cy - node.y

    # If this is a leaf containing the node itself, skip
    if qt.body is node:
        return

    width = qt.x1 - qt.x0
    dist_sq = dx * dx + dy * dy

    # Barnes-Hut criterion: if width/dist < theta, treat as single body
    if width * width / dist_sq < theta * theta:
        if dist_sq < 1e-10:
            return
        dist = math.sqrt(dist_sq)
        force = strength * qt.mass * alpha / dist
        node.fx += (dx / dist) * force
        node.fy += (dy / dist) * force
        return

    # Otherwise, recurse into children
    if qt.body is not None:
        # Leaf with a different body
        if dist_sq < 1e-10:
            return
        dist = math.sqrt(dist_sq)
        force = strength * alpha / dist
        node.fx += (dx / dist) * force
        node.fy += (dy / dist) * force
        return

    for child in qt.children:
        if child is not None:
            _apply_bh(node, child, strength, alpha, theta)
```

To use Barnes-Hut in the simulation, replace `_apply_many_body_force`:

```python
def _apply_many_body_force(self):
    """Barnes-Hut approximated many-body force. O(n log n)."""
    tree = build_quadtree(self.nodes)
    if tree:
        barnes_hut_force(self.nodes, tree, self.charge_strength, self.alpha)
```

### 3.5 NumPy Vectorized Many-Body (Alternative to Barnes-Hut)

If NumPy is available in TD's Python environment, a vectorized O(n^2) approach can outperform the pure-Python Barnes-Hut for moderate N because NumPy operations run in optimized C:

```python
import numpy as np

def many_body_numpy(positions, strength, alpha):
    """
    Vectorized many-body force using NumPy. ~10-50x faster than pure Python loops.
    positions: (n, 2) array of x, y coordinates
    Returns: (n, 2) array of force vectors
    """
    n = len(positions)

    # Pairwise differences: (n, n, 2)
    diff = positions[np.newaxis, :, :] - positions[:, np.newaxis, :]

    # Pairwise distances: (n, n)
    dist = np.sqrt(np.sum(diff ** 2, axis=2))
    np.fill_diagonal(dist, 1.0)  # Avoid division by zero

    # Force magnitudes: (n, n)
    force_mag = strength * alpha / dist
    np.fill_diagonal(force_mag, 0.0)

    # Force vectors: (n, n, 2)
    unit = diff / dist[:, :, np.newaxis]
    forces = unit * force_mag[:, :, np.newaxis]

    # Sum forces per node: (n, 2)
    return np.sum(forces, axis=1)
```

**Memory note**: The (n, n, 2) intermediate array uses `n^2 * 2 * 8 bytes`. For n=2000 that is ~64 MB -- feasible but watch for memory pressure. For n=5000 it reaches ~400 MB, which is too much. Use Barnes-Hut or GLSL at that scale.

### 3.6 Collision Force

The R3F implementation does not use collision on keywords (only on content nodes), but this is useful for content simulation or future keyword collision:

```python
def apply_collision_force(nodes, radius_fn, strength=0.8, iterations=2):
    """
    Collision avoidance. Separate overlapping nodes.

    radius_fn: callable(node) -> float, returns collision radius for a node
    strength: how aggressively to resolve overlaps (0-1)
    iterations: number of resolution passes (higher = more accurate)
    """
    for _ in range(iterations):
        n = len(nodes)
        for i in range(n):
            ni = nodes[i]
            ri = radius_fn(ni)
            for j in range(i + 1, n):
                nj = nodes[j]
                rj = radius_fn(nj)

                dx = nj.x - ni.x
                dy = nj.y - ni.y
                dist = math.sqrt(dx * dx + dy * dy)
                min_dist = ri + rj

                if dist < min_dist and dist > 0:
                    # Overlap detected -- push apart
                    overlap = (min_dist - dist) / dist * strength * 0.5
                    ox = dx * overlap
                    oy = dy * overlap
                    ni.x -= ox
                    ni.y -= oy
                    nj.x += ox
                    nj.y += oy
```

### 3.7 TD Node Network for Script CHOP Approach

```
[Table DAT: node_data]  -->  [Script CHOP: force_sim]  -->  [Geo COMP: keyword_instances]
[Table DAT: edge_data]  --/         |
                                    |
[CHOP: camera_z]  ------------------+  (zoom energy input)
```

**Script CHOP setup**:
- Time Slice: Off (we control cooking ourselves)
- Cook Type: Frame
- Output: multi-sample CHOP with `tx`, `ty` channels where each sample is one node

```python
# Script CHOP callbacks

sim = None

def onCook(scriptOp):
    global sim

    node_table = op('node_data')
    edge_table = op('edge_data')

    if sim is None or _data_changed(node_table, edge_table):
        sim = _build_simulation(node_table, edge_table)

    # Read camera Z from input CHOP (if connected)
    if scriptOp.inputs:
        camera_z = scriptOp.inputs[0]['camera_z'].eval()
        sim.set_zoom_energy(camera_z)

    sim.tick()

    # Write output: multi-sample CHOP (one sample per node)
    n = len(sim.nodes)
    scriptOp.numSamples = n
    scriptOp.clear()

    tx = scriptOp.appendChan('tx')
    ty = scriptOp.appendChan('ty')

    for i, node in enumerate(sim.nodes):
        tx[i] = node.x
        ty[i] = node.y
```

---

## 4. GLSL Compute Shader Approach

For large graphs (1000+ nodes), a GPU-based simulation is dramatically faster. TouchDesigner's GLSL TOP can be used as a compute shader by treating textures as data buffers. Each pixel in the output texture represents one node.

### 4.1 TD GLSL TOP Fundamentals

The GLSL TOP runs a **fragment shader** over an output texture. Key details:

**Input samplers**: `uniform sampler2D sTD2DInputs[TD_NUM_2D_INPUTS];`
- Access via `texture(sTD2DInputs[0], uv)` or `texelFetch(sTD2DInputs[0], ivec2(x, y), 0)`

**UV coordinates**: `in vec2 vUV;` (0..1 range)

**Output**: `out vec4 fragColor;` wrapped with `TDOutputSwizzle()`:
```glsl
fragColor = TDOutputSwizzle(vec4(pos, vel));
```

**Texture size**: `textureSize(sTD2DInputs[0], 0)` returns `ivec2`

**Critical pixel format setting**: On the GLSL TOP's Common page, set output format to **RGBA 32-bit Float** (or RGBA 16-bit Float for speed). Default 8-bit integer formats will quantize positions to 0-255.

**Filtering**: Set input TOPs to **Nearest** filtering. Bilinear interpolation will corrupt simulation state by blending adjacent nodes.

### 4.2 Data Layout in Textures

Encode simulation state in RGBA32F textures, packing 2D position + 2D velocity into one texel per node:

| Texture | Contents | Dimensions |
|---|---|---|
| `pos_vel` | R=x, G=y, B=vx, A=vy | W x H where W*H >= N |
| `adj_index` | R=startOffset, G=degree | W x H (one texel per node) |
| `adj_list` | R=neighborIdx, G=restLength, B=springK | totalEdgeRefs x 1 |
| `force_accum` | R=fx, G=fy, B=unused, A=unused | W x H |

**Dimension choice**: For N nodes, pick a texture size where width * height >= N. Pack nodes in row-major order. Example: 1000 nodes -> 32 x 32 = 1024 texels (24 padding texels, ignore in shader). For 2000 nodes -> 45 x 45 = 2025.

To convert between pixel index and UV:
```glsl
// Index to UV
int idx = ...; // 0-based node index
ivec2 size = textureSize(sTD2DInputs[0], 0);
ivec2 coord = ivec2(idx % size.x, idx / size.x);

// UV to index (from current fragment)
int idx = int(gl_FragCoord.y) * size.x + int(gl_FragCoord.x);
```

### 4.3 Edge Encoding: CSR-Style Adjacency

Variable-degree nodes (some have 2 edges, some have 50) require a compressed sparse representation. The CSR (Compressed Sparse Row) pattern uses two textures:

**`adj_index` texture** (N texels): For node i:
- R = start offset into the adjacency list
- G = degree (number of neighbors)

**`adj_list` texture** (sum-of-degrees texels): For each neighbor reference:
- R = neighbor node index (as float storing integer)
- G = rest length for this edge
- B = spring strength for this edge

**Example**: Node 0 has 3 neighbors, node 1 has 1 neighbor:
```
adj_index[0] = vec4(0.0, 3.0, ...)   // starts at offset 0, degree 3
adj_index[1] = vec4(3.0, 1.0, ...)   // starts at offset 3, degree 1

adj_list[0] = vec4(5.0, 80.0, 0.6, ...) // neighbor 5, rest_len=80, k=0.6
adj_list[1] = vec4(12.0, 45.0, 0.9, ...)
adj_list[2] = vec4(7.0, 120.0, 0.3, ...)
adj_list[3] = vec4(0.0, 60.0, 0.7, ...) // node 1's neighbor: node 0
```

**Building these textures in TD**: Generate them in Python (Script TOP or via `top.numpyArray()` write) whenever the graph topology changes. Since topology changes are infrequent (only on data reload), this cost is negligible.

**Hard cap on degree loop**: Use a uniform `u_maxDegreeIter` to clamp the inner loop, preventing worst-case nodes from stalling the GPU:
```glsl
int deg = min(int(texelFetch(sAdjIndex, coord, 0).g), u_maxDegreeIter);
```

**Alternative: Fixed-width adjacency texture** -- If max degree is bounded (say < 30), use a simpler (MAX_DEGREE x N) texture where each row stores neighbor indices, padded with -1. Wastes memory if degree distribution is skewed but has predictable cost per node.

### 4.4 Feedback TOP Setup (Ping-Pong)

The simulation needs to read the previous frame's state while writing the next frame's state. TD's Feedback TOP handles this:

```
[Constant TOP: init_positions]  -->  [Switch TOP: init_or_feedback]
                                            |
[Feedback TOP] -----> input --------> [GLSL TOP: force_compute]
      ^                                     |
      |                               [GLSL TOP: integrate]
      |                                     |
      +-------------------------------------+
                                            |
                                      [Null TOP: state_out] --> [TOP to CHOP]
```

**Feedback TOP settings**:
- **Target TOP**: point to `integrate` (or `null_state_out`)
- **Resolution**: must match simulation texture exactly
- **Pixel Format**: RGBA 32-bit Float (match the GLSL TOP output)

**Initialization**: On first frame (or reset), the Feedback TOP contains garbage. Use a Switch TOP controlled by a reset flag to feed initialization data instead of feedback for one frame:

```python
# Reset logic in Execute DAT
if should_reset:
    op('switch_init').par.index = 0  # Feed init texture
    run('op("switch_init").par.index = 1', delayFrames=1)  # Switch to feedback next frame
```

### 4.5 Multi-Pass Pipeline

The simulation requires multiple GLSL TOP passes per frame:

```
Pass 1: Many-body repulsion  --> force_accum_1  (N x N interactions)
Pass 2: Link springs         --> force_accum_2  (edge lookups per node)
Pass 3: Center force         --> force_accum_3  (requires centroid -- see below)
Pass 4: Sum + Integrate      --> pos_vel_next   (combine forces, update state)
```

Alternatively, combine passes 1-3 into a single shader if the total complexity fits (simpler network, one less readback):

```
[Feedback TOP] -------> [GLSL TOP: all_forces_and_integrate] --> [Null TOP: state]
[adj_index TOP] -----/                                               |
[adj_list TOP] -----/                                                v
                                                              [TOP to CHOP]
```

### 4.6 GLSL Shader: Many-Body Force (Naive O(n^2))

```glsl
// nbody_force.glsl -- GLSL TOP pixel shader
// Input 0: pos_vel texture (from Feedback TOP)
// Output: force accumulation texture

uniform float uChargeStrength;  // -200.0
uniform float uAlpha;           // Current simulation alpha
uniform int uNodeCount;         // Number of active nodes

void main() {
    ivec2 size = textureSize(sTD2DInputs[0], 0);
    int idx = int(gl_FragCoord.y) * size.x + int(gl_FragCoord.x);

    if (idx >= uNodeCount) {
        fragColor = TDOutputSwizzle(vec4(0.0));
        return;
    }

    vec4 self = texelFetch(sTD2DInputs[0], ivec2(idx % size.x, idx / size.x), 0);
    vec2 selfPos = self.xy;

    vec2 totalForce = vec2(0.0);

    for (int j = 0; j < uNodeCount; j++) {
        if (j == idx) continue;

        ivec2 jCoord = ivec2(j % size.x, j / size.x);
        vec4 other = texelFetch(sTD2DInputs[0], jCoord, 0);
        vec2 delta = other.xy - selfPos;

        float distSq = dot(delta, delta);
        if (distSq < 1e-10) continue;

        float dist = sqrt(distSq);

        // D3 many-body: force = strength * alpha / dist
        float forceMag = uChargeStrength * uAlpha / dist;

        totalForce += (delta / dist) * forceMag;
    }

    fragColor = TDOutputSwizzle(vec4(totalForce, 0.0, 0.0));
}
```

### 4.7 GLSL Shader: Link Force with CSR Adjacency

```glsl
// link_force.glsl -- GLSL TOP pixel shader
// Input 0: pos_vel texture
// Input 1: adj_index texture (startOffset, degree per node)
// Input 2: adj_list texture (neighborIdx, restLen, springK per edge ref)

uniform float uAlpha;
uniform int uNodeCount;
uniform int uMaxDegreeIter;  // Hard cap on neighbor loop

void main() {
    ivec2 posSize = textureSize(sTD2DInputs[0], 0);
    int idx = int(gl_FragCoord.y) * posSize.x + int(gl_FragCoord.x);

    if (idx >= uNodeCount) {
        fragColor = TDOutputSwizzle(vec4(0.0));
        return;
    }

    ivec2 myCoord = ivec2(idx % posSize.x, idx / posSize.x);
    vec4 self = texelFetch(sTD2DInputs[0], myCoord, 0);
    vec2 selfPos = self.xy;

    // Read adjacency info for this node
    vec4 adjInfo = texelFetch(sTD2DInputs[1], myCoord, 0);
    int startOffset = int(adjInfo.r);
    int degree = min(int(adjInfo.g), uMaxDegreeIter);

    ivec2 adjListSize = textureSize(sTD2DInputs[2], 0);
    vec2 totalForce = vec2(0.0);

    for (int k = 0; k < degree; k++) {
        int edgeIdx = startOffset + k;
        ivec2 edgeCoord = ivec2(edgeIdx % adjListSize.x, edgeIdx / adjListSize.x);
        vec4 edgeData = texelFetch(sTD2DInputs[2], edgeCoord, 0);

        int neighborIdx = int(edgeData.r);
        float restLen = edgeData.g;
        float springK = edgeData.b;

        ivec2 nCoord = ivec2(neighborIdx % posSize.x, neighborIdx / posSize.x);
        vec4 neighbor = texelFetch(sTD2DInputs[0], nCoord, 0);
        vec2 delta = neighbor.xy - selfPos;

        float dist = length(delta);
        if (dist < 1e-6) continue;

        // Hooke's law: F = k * (dist - restLen) / dist * alpha
        // The 0.5 factor accounts for force being applied to both endpoints
        float force = (dist - restLen) / dist * uAlpha * springK * 0.5;

        totalForce += delta * force;
    }

    fragColor = TDOutputSwizzle(vec4(totalForce, 0.0, 0.0));
}
```

### 4.8 GLSL Shader: Integration

```glsl
// integrate.glsl -- GLSL TOP pixel shader
// Input 0: pos_vel (current state, from Feedback TOP)
// Input 1: nbody_forces
// Input 2: link_forces

uniform float uVelocityDecay;  // 0.5 default
uniform int uNodeCount;

void main() {
    ivec2 size = textureSize(sTD2DInputs[0], 0);
    int idx = int(gl_FragCoord.y) * size.x + int(gl_FragCoord.x);

    if (idx >= uNodeCount) {
        fragColor = TDOutputSwizzle(vec4(0.0));
        return;
    }

    ivec2 coord = ivec2(idx % size.x, idx / size.x);
    vec4 state = texelFetch(sTD2DInputs[0], coord, 0);
    vec2 nbodyF = texelFetch(sTD2DInputs[1], coord, 0).xy;
    vec2 linkF = texelFetch(sTD2DInputs[2], coord, 0).xy;

    vec2 pos = state.xy;
    vec2 vel = state.zw;

    // Sum forces
    vec2 totalForce = nbodyF + linkF;

    // Apply forces to velocity, then decay
    float decay = 1.0 - uVelocityDecay;
    vel = (vel + totalForce) * decay;

    // Integrate position
    pos += vel;

    fragColor = TDOutputSwizzle(vec4(pos, vel));
}
```

### 4.9 Center Force on GPU

D3's center force shifts all nodes so their centroid matches the target. This requires a **reduction** (compute average position), which is awkward in a fragment shader. Options:

**Option A: CPU-side centroid** -- Read back positions (via TOP to CHOP or `numpyArray()`), compute centroid in Python, pass as uniform. Simple but adds readback cost.

**Option B: Mipmap reduction** -- Use a chain of Blur TOPs or Resolution TOPs to downsample the position texture to 1x1, giving you the average position. Feed this as a uniform to the integration shader. No CPU readback needed.

```
[pos_vel TOP] --> [Resolution TOP: 1x1, Average] --> Read single pixel as uniform
```

**Option C: Skip it** -- If link forces and many-body forces are balanced, the graph naturally stays centered. Center force is mainly a safety net. Start without it and add if the graph drifts.

### 4.10 Approximate N-Body: Grid-Based Binning

True Barnes-Hut on GPU requires building a spatial hierarchy (quadtree), which is difficult in TD's fragment-shader-only GLSL TOP. A practical alternative is **uniform grid binning**:

**Pass A: Build grid aggregate texture**
- Choose grid resolution G x G (e.g., 32 x 32 for a reasonable world space)
- Each cell stores: mass (node count) and center of mass
- Built by looping over all nodes per grid cell (O(G^2 * N), parallelized over G^2 cells)

**Pass B: For each node, interact with grid cells**
- Each node loops over all G^2 cells (or a neighborhood) and computes repulsion from cell centers of mass
- Complexity: O(N * G^2), parallelized over N

With G=32 and N=2000: Pass A = 1024 * 2000 = ~2M ops (over 1024 GPU threads), Pass B = 2000 * 1024 = ~2M ops (over 2000 threads). Compare to naive: 2000^2 = 4M ops (over 2000 threads). The grid approach gives similar or better performance with reasonable grid sizes, and scales better.

**Simpler variant: cutoff radius** -- Only compute repulsion from nodes within a fixed distance. Nodes beyond the cutoff are ignored. Loses global spreading pressure but is O(N * k) where k is average neighborhood size. Combine with a weak center force or gentle radial repulsion to maintain global structure.

### 4.11 Reading GPU Results Back to CPU

If labels or other CPU-side systems need node positions, you must read the GPU texture back. Options:

**TOP to CHOP**: TD operator that samples pixel values into CHOP channels.
- Set input to the `pos_vel` Null TOP
- Method: depends on TD version, but typically "Pixels" mode samples all pixels
- R channel becomes x positions, G channel becomes y positions
- For N=1000 nodes in a 32x32 texture: reads 1024 samples per channel
- **Latency**: 1-2 frames (GPU-to-CPU readback inherently has pipeline latency)
- **Cost**: moderate; reading a 32x32 RGBA32F texture is ~4 KB of data, but the stall while waiting for GPU is the real cost

**`top.numpyArray()` in Python**: Pull the full texture into a NumPy array from a Script DAT/CHOP. More flexible but can stall the GPU pipeline. Use sparingly (e.g., every 5 frames) and cache results.

**Avoid readback entirely**: Keep labels on GPU too. Instance textured quads with SDF text, or pre-render labels to a texture atlas and instance with UV offsets. This eliminates the CPU bottleneck but is more complex to set up.

**Recommended approach for labels**: Read back at reduced rate (every 3-5 frames) via TOP to CHOP, interpolate positions on CPU between readbacks for smooth motion:

```python
# In Execute DAT
readback_interval = 3
frame_counter = 0

def onFrameStart(frame):
    global frame_counter
    frame_counter += 1

    if frame_counter % readback_interval == 0:
        # TOP to CHOP updates automatically; read current values
        chop = op('topToChop1')
        store_previous_positions()
        update_current_positions(chop)

    # Interpolate for smooth label motion
    t = (frame_counter % readback_interval) / readback_interval
    interpolated = lerp(prev_positions, curr_positions, t)
    update_labels(interpolated)
```

### 4.12 Alpha and Velocity Decay Management

Alpha (simulation energy) and velocity decay are global scalars, not per-node. Manage them on the CPU and pass as uniforms to the GLSL passes:

```python
# Execute DAT: alpha management
alpha = 0.3
alpha_target = 0.0
alpha_decay = 0.01
alpha_min = 0.001
velocity_decay = 0.5

def onFrameStart(frame):
    global alpha, velocity_decay

    # Cool alpha
    alpha += (alpha_target - alpha) * alpha_decay
    alpha = max(alpha, alpha_min)

    # Respond to zoom changes
    camera_z = op('camera1').par.tz.eval()
    set_zoom_energy(camera_z)

    # Push uniforms to all GLSL TOPs
    op('nbody_force').par.value1 = alpha       # Maps to uAlpha
    op('link_force').par.value1 = alpha
    op('integrate').par.value1 = velocity_decay  # Maps to uVelocityDecay
```

---

## 5. External Process via OSC/WebSocket

Running D3-force in a separate Node.js process and streaming positions to TD is the fastest way to get an exact behavioral match. The simulation code stays in JavaScript where D3-force is battle-tested.

### 5.1 Architecture

```
+------------------+     WebSocket/OSC      +------------------+
| Node.js process  | --------------------> | TouchDesigner     |
|                  |                        |                  |
| d3-force sim     |    JSON or binary      | WebSocket DAT    |
| tick @ 60Hz      |    position stream     |      |           |
|                  |                        | Script CHOP      |
| Accepts commands | <-------------------- |      |           |
| (reheat, zoom,   |    control messages    | Geo COMP         |
|  filter, drag)   |                        |  (instancing)    |
+------------------+                        +------------------+
```

### 5.2 Node.js Sidecar Implementation

```javascript
// td-force-server.js
// Run with: node td-force-server.js

const { WebSocketServer } = require('ws');
const d3 = require('d3-force');

const wss = new WebSocketServer({ port: 9876 });

let simulation = null;
let nodes = [];
let links = [];

function initSimulation(nodeData, edgeData) {
  nodes = nodeData.map((n, i) => ({
    id: n.id,
    index: i,
    x: Math.random() * 1000 - 500,
    y: Math.random() * 1000 - 500,
  }));

  links = edgeData.map(e => ({
    source: e.source,
    target: e.target,
    similarity: e.similarity,
  }));

  simulation = d3.forceSimulation(nodes)
    .force('link', d3.forceLink(links)
      .id(d => d.id)
      .distance(d => 40 + (1 - (d.similarity ?? 0.5)) * 150)
      .strength(d => 0.2 + (d.similarity ?? 0.5) * 0.8)
    )
    .force('charge', d3.forceManyBody().strength(-200))
    .force('center', d3.forceCenter(0, 0))
    .alphaDecay(0.01)
    .velocityDecay(0.5)
    .alpha(0.3);
}

wss.on('connection', (ws) => {
  console.log('TD connected');

  ws.on('message', (data) => {
    const msg = JSON.parse(data);

    if (msg.type === 'init') {
      initSimulation(msg.nodes, msg.edges);
    } else if (msg.type === 'reheat') {
      simulation?.alpha(msg.alpha ?? 0.3);
    } else if (msg.type === 'zoom') {
      // Apply zoom energy
      const z = msg.cameraZ;
      const t = Math.max(0, Math.min(1, (z - 1800) / (20000 - 1800)));
      const curve = Math.pow(t, 0.65);
      simulation?.alpha(0.01 + curve * 0.29);
      simulation?.velocityDecay(0.9 - curve * 0.4);
    }
  });

  // Stream positions at ~60Hz
  const interval = setInterval(() => {
    if (!simulation || !nodes.length) return;

    simulation.tick();

    // Binary format: [N as uint32] + [x0, y0, x1, y1, ...] as float32
    const buffer = new ArrayBuffer(4 + nodes.length * 8);
    const view = new DataView(buffer);
    view.setUint32(0, nodes.length, true); // little-endian

    for (let i = 0; i < nodes.length; i++) {
      view.setFloat32(4 + i * 8, nodes[i].x, true);
      view.setFloat32(4 + i * 8 + 4, nodes[i].y, true);
    }

    ws.send(buffer);
  }, 1000 / 60);

  ws.on('close', () => {
    clearInterval(interval);
    console.log('TD disconnected');
  });
});

console.log('Force server listening on ws://localhost:9876');
```

### 5.3 Message Format: Binary vs JSON

| Format | Payload for 1000 nodes | Parse cost in TD Python | Suitability |
|---|---|---|---|
| JSON `[{x, y}, ...]` | ~25 KB | High (json.loads + dict access) | Prototyping only |
| JSON flat array `[x0,y0,x1,y1,...]` | ~15 KB | Moderate | Acceptable for < 500 nodes |
| Binary float32 | ~8 KB | Low (struct.unpack or numpy.frombuffer) | Production |

**Binary is strongly recommended** for 500+ nodes. At 60 updates/sec with 1000 nodes, binary is ~480 KB/s vs ~1.5 MB/s for JSON, and parse time is 10-50x lower.

### 5.4 TD Receiver: WebSocket DAT + Script CHOP

**WebSocket DAT** receives binary messages. Set it up:
- Protocol: WebSocket
- Address: `ws://localhost:9876`
- Mode: Active (client)

In the WebSocket DAT callbacks:

```python
import struct

# Pre-allocated arrays for position data
positions_x = []
positions_y = []

def onReceiveBinary(dat, contents):
    global positions_x, positions_y

    if len(contents) < 4:
        return

    n = struct.unpack_from('<I', contents, 0)[0]
    expected_size = 4 + n * 8

    if len(contents) < expected_size:
        return

    # Unpack all positions in one call
    floats = struct.unpack_from(f'<{n * 2}f', contents, 4)
    positions_x = list(floats[0::2])
    positions_y = list(floats[1::2])

    # Store for Script CHOP to read
    op('force_sim').store('px', positions_x)
    op('force_sim').store('py', positions_y)
```

Then a Script CHOP reads the stored positions:

```python
def onCook(scriptOp):
    px = scriptOp.fetch('px', [])
    py = scriptOp.fetch('py', [])

    n = len(px)
    if n == 0:
        return

    scriptOp.numSamples = n
    scriptOp.clear()

    tx = scriptOp.appendChan('tx')
    ty = scriptOp.appendChan('ty')

    for i in range(n):
        tx[i] = px[i]
        ty[i] = py[i]
```

### 5.5 Latency and Sync Considerations

| Factor | Typical Value | Notes |
|---|---|---|
| WebSocket transport (localhost) | < 1 ms | UDP-like latency over TCP loopback |
| TD callback processing | 0.5-2 ms | Python parsing + storage write |
| Cook propagation to render | 0-1 frame | Depends on cook order |
| **Total end-to-end** | **1-3 frames (~17-50 ms at 60fps)** | Perceptible for direct manipulation, fine for ambient animation |

**Mitigation strategies**:
- Buffer the latest message and apply on `onFrameStart`, not on every callback (WebSocket DAT may fire multiple times per frame)
- Interpolate between received frames for smoother motion
- For drag interactions, send drag position to Node.js and have it pin the node; the latency round-trip (~2 frames) is noticeable but tolerable

### 5.6 Sending Commands from TD to Node.js

The WebSocket is bidirectional. TD can send control messages:

```python
# In a Script DAT or Panel Execute callback
import json

def send_reheat(alpha=0.3):
    ws = op('websocketDAT')
    ws.sendText(json.dumps({'type': 'reheat', 'alpha': alpha}))

def send_zoom(camera_z):
    ws = op('websocketDAT')
    ws.sendText(json.dumps({'type': 'zoom', 'cameraZ': camera_z}))
```

### 5.7 OSC Alternative

If you prefer OSC (simpler setup, fire-and-forget UDP):
- Use `osc-min` or `node-osc` in Node.js to send bundles
- Each bundle: `/positions` message with flat float array
- TD: OSC In CHOP receives directly as channels (no parsing needed)
- **Trade-off**: UDP can drop packets; positions may "skip" under network congestion (rare on localhost)

```javascript
// Node.js OSC sender (using node-osc)
const { Client } = require('node-osc');
const oscClient = new Client('127.0.0.1', 7000);

// In the tick loop:
const args = [nodes.length];
for (const node of nodes) {
  args.push(node.x, node.y);
}
oscClient.send('/positions', ...args);
```

TD side: OSC In CHOP listening on port 7000 receives the `/positions` message and creates channels from the float arguments.

---

## 6. Hybrid Approach

The hybrid approach combines the best of pre-computation and lightweight runtime forces. It's the most pragmatic starting point for installations with datasets that change infrequently.

### 6.1 Architecture

```
OFFLINE (one-time or on data change):
  [Node.js script] --> run D3-force to convergence --> export positions.json

TD RUNTIME:
  [Table DAT: positions.json] --> [Script CHOP: lightweight_sim] --> [Geo COMP]
                                        |
  [CHOP: camera_z] --------------------+
  [Panel Execute: drag events] --------+
```

### 6.2 Pre-computing the Initial Layout

Run D3-force to convergence outside of TD:

```javascript
// precompute-layout.js
const d3 = require('d3-force');
const fs = require('fs');

const { nodes, edges } = JSON.parse(fs.readFileSync('graph-data.json'));

const simNodes = nodes.map(n => ({ id: n.id, ...n }));
const simLinks = edges.map(e => ({
  source: e.source,
  target: e.target,
  similarity: e.similarity,
}));

const simulation = d3.forceSimulation(simNodes)
  .force('link', d3.forceLink(simLinks)
    .id(d => d.id)
    .distance(d => 40 + (1 - d.similarity) * 150)
    .strength(d => 0.2 + d.similarity * 0.8)
  )
  .force('charge', d3.forceManyBody().strength(-200))
  .force('center', d3.forceCenter(0, 0))
  .alphaDecay(0.01)
  .velocityDecay(0.5)
  .alpha(0.3)
  .stop();

// Run to convergence
for (let i = 0; i < 300; i++) {
  simulation.tick();
}

// Export
const output = simNodes.map(n => ({
  id: n.id,
  x: n.x,
  y: n.y,
}));

fs.writeFileSync('positions.json', JSON.stringify(output, null, 2));
console.log(`Exported ${output.length} node positions`);
```

### 6.3 Lightweight Runtime Simulation in TD

Once positions are loaded, a simple Python simulation handles interactive perturbation without needing the full force model:

```python
class LightweightSimulation:
    """
    Lightweight force simulation for interactive perturbation of pre-computed layouts.
    Only activates when explicitly perturbed (drag, zoom energy injection).
    Much cheaper than full force simulation -- no many-body computation.
    """

    def __init__(self, positions):
        """
        positions: list of (id, x, y) tuples from pre-computed layout
        """
        self.nodes = []
        self.rest_positions = {}  # Original pre-computed positions

        for node_id, x, y in positions:
            node = Node(node_id, len(self.nodes), x, y)
            self.nodes.append(node)
            self.rest_positions[node_id] = (x, y)

        self.alpha = 0.0  # Starts at rest (converged)
        self.alpha_min = 0.001
        self.alpha_decay = 0.05  # Fast cooling -- settles quickly
        self.velocity_decay = 0.7  # High damping

        # Return-to-rest spring strength
        self.rest_spring = 0.02

        # Optional: local neighbor repulsion (not full N-body)
        self.local_repulsion_radius = 100.0
        self.local_repulsion_strength = -50.0

    def tick(self):
        """Only does work when alpha > alpha_min."""
        if self.alpha < self.alpha_min:
            return False  # At rest

        self.alpha += (0.0 - self.alpha) * self.alpha_decay

        for node in self.nodes:
            node.fx = 0.0
            node.fy = 0.0

        self._apply_return_to_rest()
        self._apply_local_repulsion()

        decay = 1.0 - self.velocity_decay
        for node in self.nodes:
            if node.fixed_x is not None:
                node.x = node.fixed_x
                node.vx = 0.0
            else:
                node.vx = (node.vx + node.fx) * decay
                node.x += node.vx

            if node.fixed_y is not None:
                node.y = node.fixed_y
                node.vy = 0.0
            else:
                node.vy = (node.vy + node.fy) * decay
                node.y += node.vy

        return True

    def _apply_return_to_rest(self):
        """Spring force pulling each node back to its pre-computed position."""
        for node in self.nodes:
            rx, ry = self.rest_positions[node.id]
            dx = rx - node.x
            dy = ry - node.y
            force = self.rest_spring * self.alpha
            node.fx += dx * force
            node.fy += dy * force

    def _apply_local_repulsion(self):
        """
        Repulsion only between nearby nodes (within local_repulsion_radius).
        O(n * k) where k is average number of neighbors in radius.
        Uses spatial hashing for efficiency.
        """
        cell_size = self.local_repulsion_radius
        grid = {}

        for node in self.nodes:
            cx = int(node.x / cell_size)
            cy = int(node.y / cell_size)
            key = (cx, cy)
            if key not in grid:
                grid[key] = []
            grid[key].append(node)

        for node in self.nodes:
            cx = int(node.x / cell_size)
            cy = int(node.y / cell_size)

            for dx_cell in range(-1, 2):
                for dy_cell in range(-1, 2):
                    cell = grid.get((cx + dx_cell, cy + dy_cell))
                    if cell is None:
                        continue
                    for other in cell:
                        if other is node:
                            continue
                        dx = node.x - other.x
                        dy = node.y - other.y
                        dist_sq = dx * dx + dy * dy
                        r_sq = self.local_repulsion_radius ** 2
                        if dist_sq > r_sq or dist_sq < 1e-10:
                            continue
                        dist = math.sqrt(dist_sq)
                        force = self.local_repulsion_strength * self.alpha / dist
                        node.fx += (dx / dist) * force
                        node.fy += (dy / dist) * force

    def perturb(self, node_id, dx, dy):
        """Displace a node and reheat the simulation."""
        node = next((n for n in self.nodes if n.id == node_id), None)
        if node:
            node.x += dx
            node.y += dy
            self.alpha = max(self.alpha, 0.15)

    def reheat(self, alpha=0.15):
        """Inject energy for general re-settling."""
        self.alpha = alpha

    def set_zoom_energy(self, camera_z):
        """Match the R3F zoom-dependent energy curve, but capped lower."""
        SIM_Z_MIN = 1800.0
        SIM_Z_MAX = 20000.0
        t = max(0.0, min(1.0, (camera_z - SIM_Z_MIN) / (SIM_Z_MAX - SIM_Z_MIN)))
        curve = t ** 0.65
        # Lower max alpha than full sim since we don't want major rearrangement
        target_alpha = 0.005 + curve * 0.1
        if target_alpha > self.alpha:
            self.alpha = target_alpha
        self.velocity_decay = 0.85 - curve * 0.15
```

### 6.4 When to Upgrade from Hybrid to Full Simulation

The hybrid approach breaks down when:
- Graph topology changes frequently (new nodes/edges at runtime)
- You need the graph to fully re-layout after filtering (removing nodes changes the ideal layout)
- Drag-and-drop needs to cascade through the entire graph (full many-body required)

In those cases, switch to Option A (Python Script CHOP) or Option C (Node.js sidecar).

---

## 7. Content Node Simulation

Content nodes (chunks) orbit their parent keywords. This is structurally independent from the keyword simulation but reads keyword positions as input.

### 7.1 Source Behavior

From `useContentSimulation.ts`:
- Each content node has a `parentId` linking it to a keyword
- **Collision**: `d3.forceCollide()` with `radius = BASE_DOT_RADIUS * DOT_SCALE_FACTOR * sizeMultiplier * 1.2`, `strength = 0.8`, `iterations = 2`
- **Tether**: Custom spring toward parent + hard max distance constraint
- Ticked manually once per frame via `useFrame(() => simulation.tick())`
- Alpha decay: 0.02 (slower cooling), velocity decay: 0.3 (high damping)

### 7.2 This Should Be a Separate Simulation

Yes. The content simulation should be separate from the keyword simulation for several reasons:

1. **Different lifecycle**: Content nodes appear/disappear based on zoom level; keyword nodes are always present
2. **One-way dependency**: Content positions depend on keyword positions, not the other way around
3. **Simpler forces**: No many-body repulsion across all content nodes (only collision among siblings), no link force
4. **Different performance profile**: Content node count varies (0 when zoomed out, up to ~200 when zoomed in), so the simulation should be dormant when there are no visible content nodes

### 7.3 Python Port for TD

```python
class ContentNode:
    __slots__ = ['id', 'x', 'y', 'vx', 'vy', 'parent_id']

    def __init__(self, node_id, parent_id, x=0, y=0):
        self.id = node_id
        self.parent_id = parent_id
        self.x = x
        self.y = y
        self.vx = 0.0
        self.vy = 0.0


class ContentSimulation:
    def __init__(self, content_nodes, keyword_positions,
                 keyword_radius=10.0, content_radius=15.0,
                 spring_strength=0.1, collision_strength=0.8,
                 base_distance_mult=2.5, content_spread_factor=1.5):
        """
        content_nodes: list of ContentNode
        keyword_positions: dict of keyword_id -> (x, y), updated externally
        """
        self.nodes = content_nodes
        self.keyword_positions = keyword_positions
        self.keyword_radius = keyword_radius
        self.content_radius = content_radius
        self.spring_strength = spring_strength
        self.collision_strength = collision_strength
        self.base_distance_mult = base_distance_mult
        self.content_spread_factor = content_spread_factor

        self.alpha = 0.3
        self.alpha_decay = 0.02
        self.velocity_decay = 0.3

        # Precompute content counts per parent
        self._update_content_counts()

    def _update_content_counts(self):
        self.content_counts = {}
        for node in self.nodes:
            self.content_counts[node.parent_id] = \
                self.content_counts.get(node.parent_id, 0) + 1

    def tick(self):
        """One simulation step. Call per frame."""
        self.alpha += (0.0 - self.alpha) * self.alpha_decay
        if self.alpha < 0.001:
            return

        # Tether force: spring toward parent + hard distance constraint
        self._apply_tether_force()

        # Collision: push overlapping content nodes apart
        self._apply_collision()

        # Integrate
        decay = 1.0 - self.velocity_decay
        for node in self.nodes:
            node.vx *= decay
            node.vy *= decay
            node.x += node.vx
            node.y += node.vy

    def _apply_tether_force(self):
        for node in self.nodes:
            parent_pos = self.keyword_positions.get(node.parent_id)
            if parent_pos is None:
                continue
            px, py = parent_pos

            dx = px - node.x
            dy = py - node.y
            dist = math.sqrt(dx * dx + dy * dy)

            # Spring force toward parent
            if dist > 0:
                force = self.spring_strength * self.alpha
                node.vx += dx * force
                node.vy += dy * force

            # Hard max distance constraint
            count = self.content_counts.get(node.parent_id, 1)
            base = self.keyword_radius * self.base_distance_mult
            spread = math.sqrt(count) * self.content_radius * self.content_spread_factor
            max_dist = base + spread

            if dist > max_dist and dist > 0:
                scale = max_dist / dist
                node.x = px + (node.x - px) * scale
                node.y = py + (node.y - py) * scale

    def _apply_collision(self):
        """Simple O(n^2) collision. Fine for content nodes (typically <200 visible)."""
        n = len(self.nodes)
        r = self.content_radius
        min_dist = r * 2

        for _ in range(2):  # 2 iterations like the R3F version
            for i in range(n):
                ni = self.nodes[i]
                for j in range(i + 1, n):
                    nj = self.nodes[j]

                    dx = nj.x - ni.x
                    dy = nj.y - ni.y
                    d = math.sqrt(dx * dx + dy * dy)

                    if d < min_dist and d > 0:
                        overlap = (min_dist - d) / d * self.collision_strength * 0.5
                        ox = dx * overlap
                        oy = dy * overlap
                        ni.x -= ox
                        ni.y -= oy
                        nj.x += ox
                        nj.y += oy

    def update_keyword_positions(self, new_positions):
        """
        Call after keyword simulation ticks.
        new_positions: dict of keyword_id -> (x, y)
        """
        self.keyword_positions = new_positions
```

### 7.4 TD Integration: Two Simulations Chained

Run both simulations in the same Execute DAT, outputting to separate CHOPs:

```
[Execute DAT: sim_ticker]
    |                    \
    v                     v
[Script CHOP: kw_pos]   [Script CHOP: content_pos]
    |                        |
    v                        v
[Geo COMP: keywords]    [Geo COMP: content_nodes]
```

```python
# Execute DAT: sim_ticker

keyword_sim = None
content_sim = None

def onFrameStart(frame):
    global keyword_sim, content_sim

    if keyword_sim is None:
        return

    # 1. Tick keyword simulation
    keyword_sim.tick()

    # 2. Update content simulation with new keyword positions
    kw_positions = {n.id: (n.x, n.y) for n in keyword_sim.nodes}

    if content_sim is not None:
        content_sim.update_keyword_positions(kw_positions)
        content_sim.tick()

    # 3. Write positions to storage for Script CHOPs to read
    op('kw_pos').store('nodes', keyword_sim.nodes)
    if content_sim:
        op('content_pos').store('nodes', content_sim.nodes)
```

### 7.5 Z Separation

Content nodes render behind keywords at `z = CONTENT_Z_DEPTH` (derived from `BASE_CAMERA_Z * 0.5` in the R3F version, so around -150 to -500 world units). In TD, set the instance Z channel for content nodes to a constant negative value (e.g., -500), or adjust to taste for your camera setup. Since the FOV is 10 degrees (very narrow), small Z offsets won't create visible parallax, so this mainly controls render order.

---

## 8. Performance Analysis

### 8.1 Python Script CHOP Benchmarks (Estimated)

These are rough estimates based on typical CPython performance in TouchDesigner. No JIT, no NumPy unless explicitly used.

| Node Count | Naive O(n^2) | Barnes-Hut O(n log n) | NumPy O(n^2) | Target Budget |
|---|---|---|---|---|
| 100 | ~0.5ms | ~0.3ms | ~0.1ms | 16ms (60fps) |
| 200 | ~2ms | ~0.8ms | ~0.3ms | 16ms |
| 500 | ~12ms | ~3ms | ~1.5ms | 16ms |
| 1000 | ~50ms | ~8ms | ~4ms | 16ms |
| 2000 | ~200ms | ~18ms | ~16ms | 16ms |
| 5000 | ~1.2s | ~55ms | ~100ms* | 16ms |

*NumPy O(n^2) at n=5000 creates a ~400 MB intermediate array, likely causing memory pressure.

**Takeaway**: Naive Python handles ~400 nodes at 60fps. Barnes-Hut extends this to ~1200 nodes. NumPy vectorization handles ~1500 nodes. Beyond that, use GLSL compute or reduce tick rate.

### 8.2 GLSL Compute Performance (Estimated)

On a modern discrete GPU (RTX 3070 class):

| Node Count | O(n^2) GPU (brute force) | With link forces | Notes |
|---|---|---|---|
| 500 | < 1ms | ~1ms | Well within budget |
| 1000 | ~2ms | ~3ms | Comfortable |
| 2000 | ~6ms | ~10ms | Feasible at 60fps |
| 5000 | ~30ms | ~40ms | 30fps; needs grid approx for 60fps |
| 10000 | ~120ms | -- | Needs grid-based approximation |

**Link force cost** depends heavily on max degree. With CSR encoding and a degree cap of 30, the per-node cost is bounded but the total scales with E (edge count).

### 8.3 Optimization Strategies

**Reduced tick rate**: Run the simulation at 30fps while rendering at 60fps. Interpolate positions between ticks:

```python
tick_interval = 2  # Tick every 2 frames
frame_counter = 0
prev_positions = None
curr_positions = None

def onFrameStart(frame):
    global frame_counter, prev_positions, curr_positions
    frame_counter += 1

    if frame_counter % tick_interval == 0:
        prev_positions = curr_positions
        sim.tick()
        curr_positions = [(n.x, n.y) for n in sim.nodes]

    # Interpolate
    t = (frame_counter % tick_interval) / tick_interval
    if prev_positions and curr_positions:
        interpolated = [
            (p[0] + (c[0] - p[0]) * t, p[1] + (c[1] - p[1]) * t)
            for p, c in zip(prev_positions, curr_positions)
        ]
        write_to_chop(interpolated)
```

**Spatial hashing for collision**: For content nodes with many siblings, a grid-based spatial hash reduces O(n^2) collision checks to O(n * k):

```python
def spatial_hash_collision(nodes, radius, cell_size=None):
    if cell_size is None:
        cell_size = radius * 2

    grid = {}
    for node in nodes:
        cx = int(node.x / cell_size)
        cy = int(node.y / cell_size)
        key = (cx, cy)
        if key not in grid:
            grid[key] = []
        grid[key].append(node)

    for (cx, cy), cell_nodes in grid.items():
        neighbors = []
        for dx in range(-1, 2):
            for dy in range(-1, 2):
                neighbors.extend(grid.get((cx + dx, cy + dy), []))

        for node in cell_nodes:
            for other in neighbors:
                if other is node:
                    continue
                # Check collision between node and other...
```

### 8.4 Recommended Strategy by Scale

| Node Count | Keyword Sim | Content Sim | Notes |
|---|---|---|---|
| < 300 | Python naive | Python naive | Simplest, plenty of headroom |
| 300-800 | Python Barnes-Hut | Python naive | BH avoids O(n^2) wall |
| 800-1500 | Python NumPy (if available) or Python BH at 30Hz | Python with spatial hash | Reduce tick rate if needed |
| 1500-3000 | GLSL naive O(n^2) | Python (content nodes < 200) | GPU dominates at this scale |
| 3000+ | GLSL with grid approximation | GLSL (if content scales too) | Full GPU pipeline |

---

## 9. Integration with Instancing

### 9.1 CHOP Channel Convention for Instancing

For Geo COMP instancing, use multi-sample CHOPs where each sample represents one instance:

```
Channel: tx  -> samples [pos_x_0, pos_x_1, ..., pos_x_n]
Channel: ty  -> samples [pos_y_0, pos_y_1, ..., pos_y_n]
Channel: tz  -> samples [0, 0, ..., 0]
```

Configure Geo COMP Instance page:
- **Instance CHOP**: point to the Script CHOP
- **Translate X/Y/Z**: map to `tx`, `ty`, `tz` channels

Additional channels for per-instance properties:
```
Channel: sx  -> scale per instance
Channel: cr  -> color red per instance
Channel: cg  -> color green
Channel: cb  -> color blue
Channel: ca  -> color alpha
```

### 9.2 Complete TD Network

```
DATA LAYER
+-- [Web DAT: fetch_nodes]  -->  [Table DAT: keyword_nodes]
|                                     columns: id, label, community_id
+-- [Web DAT: fetch_edges]  -->  [Table DAT: similarity_edges]
|                                     columns: source, target, similarity
+-- [Web DAT: fetch_chunks] -->  [Table DAT: content_chunks]
                                      columns: id, keyword_id, content

SIMULATION LAYER
+-- [Execute DAT: sim_ticker]         <-- runs per frame
|   +-- Reads: keyword_nodes, similarity_edges, content_chunks
|   +-- Reads: camera_z (from Camera COMP or CHOP)
|   +-- Writes to: kw_pos Script CHOP storage
|   +-- Writes to: content_pos Script CHOP storage
|
+-- [Script CHOP: kw_pos]            <-- keyword positions as CHOP channels
|   +-- Output: tx, ty (N samples)
|
+-- [Script CHOP: content_pos]       <-- content positions as CHOP channels
    +-- Output: tx, ty, tz (M samples)

RENDERING LAYER
+-- [Geo COMP: keyword_geo]
|   +-- SOP: Circle SOP (r=10)
|   +-- MAT: Constant MAT (vertex colors)
|   +-- Instance: kw_pos (tx -> Translate X, ty -> Translate Y)
|
+-- [Geo COMP: content_geo]
|   +-- SOP: Rectangle SOP (with fillet)
|   +-- MAT: Constant MAT (vertex colors)
|   +-- Instance: content_pos (tx -> X, ty -> Y, tz -> Z)
|
+-- [Geo COMP: edge_geo]
    +-- SOP: Script SOP generating arc lines from keyword positions
```

### 9.3 Reheat Triggers

| Event | Source in TD | Reheat Alpha |
|---|---|---|
| Data change (new nodes/edges) | Web DAT callback | 0.3 (full restart) |
| User drags a node | Panel Execute or Render Pick | 0.1 (gentle) |
| Filter change | Script callback | 0.3 |
| Window resize | Window COMP callback | 0.05 (minimal) |
| Zoom change | Camera COMP callback | Via `set_zoom_energy()` |

### 9.4 Node Dragging

To support interactive node dragging:

```python
def on_node_drag(node_id, new_x, new_y):
    """Called from Render Pick or Panel interaction."""
    node = sim.node_by_id.get(node_id)
    if node:
        # Fix node at drag position
        node.fixed_x = new_x
        node.fixed_y = new_y
        node.x = new_x
        node.y = new_y
        node.vx = 0
        node.vy = 0
        # Reheat so other nodes adjust
        sim.reheat(0.1)

def on_node_release(node_id):
    """Release the node back to simulation control."""
    node = sim.node_by_id.get(node_id)
    if node:
        node.fixed_x = None
        node.fixed_y = None
```

---

## Appendix: Complete Simulation Module for TouchDesigner

The following is a self-contained Python module suitable for importing into a TouchDesigner Text DAT:

```python
"""
force_simulation_td.py
Complete force-directed graph simulation for TouchDesigner.
Drop into a Text DAT named 'force_simulation_td' and import from Script DATs.

Usage:
    sim_module = op('force_simulation_td').module
    sim = sim_module.KeywordSimulation(nodes, edges, similarities)
    sim.tick()  # Call per frame
"""

import math
import random

try:
    import numpy as np
    HAS_NUMPY = True
except ImportError:
    HAS_NUMPY = False


class SimNode:
    __slots__ = ['id', 'index', 'x', 'y', 'vx', 'vy', 'fx', 'fy',
                 'fixed_x', 'fixed_y']

    def __init__(self, node_id, index, x=None, y=None):
        self.id = node_id
        self.index = index
        self.x = x if x is not None else random.uniform(-500, 500)
        self.y = y if y is not None else random.uniform(-500, 500)
        self.vx = 0.0
        self.vy = 0.0
        self.fx = 0.0
        self.fy = 0.0
        self.fixed_x = None  # Set to float to pin X
        self.fixed_y = None  # Set to float to pin Y


class KeywordSimulation:
    """
    Port of ForceSimulation.tsx for TouchDesigner.
    Supports link, many-body (naive or Barnes-Hut), and center forces.
    """

    def __init__(self, nodes, edges, similarities,
                 charge_strength=-200.0,
                 alpha=0.3, alpha_decay=0.01,
                 velocity_decay=0.5,
                 use_barnes_hut=True,
                 barnes_hut_theta=0.9):
        """
        nodes: list of (id_string, index_int) tuples
        edges: list of (source_index, target_index) tuples
        similarities: list of float, parallel to edges
        """
        self.nodes = [SimNode(nid, idx) for nid, idx in nodes]
        self.edges = edges
        self.similarities = similarities
        self.node_by_id = {n.id: n for n in self.nodes}

        self.alpha = alpha
        self.alpha_min = 0.001
        self.alpha_decay = alpha_decay
        self.alpha_target = 0.0
        self.velocity_decay = velocity_decay
        self.charge_strength = charge_strength
        self.use_barnes_hut = use_barnes_hut and len(self.nodes) > 100
        self.theta = barnes_hut_theta

    def tick(self):
        self.alpha += (self.alpha_target - self.alpha) * self.alpha_decay
        if self.alpha < self.alpha_min:
            return False  # Converged

        for n in self.nodes:
            n.fx = 0.0
            n.fy = 0.0

        self._link_force()

        if self.use_barnes_hut:
            self._many_body_bh()
        else:
            self._many_body_naive()

        self._center_force()

        decay = 1.0 - self.velocity_decay
        for n in self.nodes:
            if n.fixed_x is not None:
                n.x = n.fixed_x
                n.vx = 0.0
            else:
                n.vx = (n.vx + n.fx) * decay
                n.x += n.vx

            if n.fixed_y is not None:
                n.y = n.fixed_y
                n.vy = 0.0
            else:
                n.vy = (n.vy + n.fy) * decay
                n.y += n.vy

        return True  # Still active

    def _link_force(self):
        for i, (si, ti) in enumerate(self.edges):
            s = self.nodes[si]
            t = self.nodes[ti]
            sim = self.similarities[i]

            dx = t.x - s.x + (random.random() - 0.5) * 1e-6
            dy = t.y - s.y + (random.random() - 0.5) * 1e-6
            dist = math.sqrt(dx * dx + dy * dy)
            if dist == 0:
                continue

            target_dist = 40.0 + (1.0 - sim) * 150.0
            strength = 0.2 + sim * 0.8
            force = (dist - target_dist) / dist * self.alpha * strength

            fx = dx * force * 0.5
            fy = dy * force * 0.5
            s.fx += fx
            s.fy += fy
            t.fx -= fx
            t.fy -= fy

    def _many_body_naive(self):
        nodes = self.nodes
        n = len(nodes)
        strength = self.charge_strength
        alpha = self.alpha

        for i in range(n):
            ni = nodes[i]
            for j in range(i + 1, n):
                nj = nodes[j]
                dx = nj.x - ni.x + (random.random() - 0.5) * 1e-6
                dy = nj.y - ni.y + (random.random() - 0.5) * 1e-6
                dist_sq = dx * dx + dy * dy
                if dist_sq < 1e-10:
                    continue
                dist = math.sqrt(dist_sq)
                force = strength * alpha / dist
                fx = (dx / dist) * force
                fy = (dy / dist) * force
                ni.fx += fx
                ni.fy += fy
                nj.fx -= fx
                nj.fy -= fy

    def _many_body_bh(self):
        tree = _build_quadtree(self.nodes)
        if tree is None:
            return
        for node in self.nodes:
            _bh_apply(node, tree, self.charge_strength, self.alpha, self.theta)

    def _center_force(self):
        n = len(self.nodes)
        if n == 0:
            return
        cx = sum(nd.x for nd in self.nodes) / n
        cy = sum(nd.y for nd in self.nodes) / n
        for nd in self.nodes:
            nd.x -= cx
            nd.y -= cy

    def reheat(self, alpha=0.3):
        self.alpha = alpha

    def set_zoom_energy(self, camera_z):
        SIM_Z_MIN = 1800.0
        SIM_Z_MAX = 20000.0
        t = max(0.0, min(1.0, (camera_z - SIM_Z_MIN) / (SIM_Z_MAX - SIM_Z_MIN)))
        curve = t ** 0.65
        target_alpha = 0.01 + curve * 0.29
        if abs(target_alpha - self.alpha) > 0.01:
            self.alpha = target_alpha
        self.velocity_decay = 0.9 - curve * 0.4

    def get_positions(self):
        """Return positions as list of (id, x, y) tuples."""
        return [(n.id, n.x, n.y) for n in self.nodes]


# --- Barnes-Hut Quadtree ---

class _QTNode:
    __slots__ = ['x0', 'y0', 'x1', 'y1', 'cx', 'cy', 'mass',
                 'children', 'body']
    def __init__(self, x0, y0, x1, y1):
        self.x0, self.y0, self.x1, self.y1 = x0, y0, x1, y1
        self.cx = self.cy = self.mass = 0.0
        self.children = [None, None, None, None]
        self.body = None

def _build_quadtree(nodes):
    if not nodes:
        return None
    xs = [n.x for n in nodes]
    ys = [n.y for n in nodes]
    pad = 1.0
    lo_x, hi_x = min(xs) - pad, max(xs) + pad
    lo_y, hi_y = min(ys) - pad, max(ys) + pad
    size = max(hi_x - lo_x, hi_y - lo_y)
    mx, my = (lo_x + hi_x) / 2, (lo_y + hi_y) / 2
    root = _QTNode(mx - size/2, my - size/2, mx + size/2, my + size/2)
    for n in nodes:
        _qt_insert(root, n)
    _qt_mass(root)
    return root

def _qt_quadrant(qt, x, y):
    mx = (qt.x0 + qt.x1) / 2
    my = (qt.y0 + qt.y1) / 2
    return (0 if x < mx else 1) + (0 if y >= my else 2)

def _qt_child_bounds(qt, q):
    mx = (qt.x0 + qt.x1) / 2
    my = (qt.y0 + qt.y1) / 2
    if q == 0: return (qt.x0, my, mx, qt.y1)
    if q == 1: return (mx, my, qt.x1, qt.y1)
    if q == 2: return (qt.x0, qt.y0, mx, my)
    return (mx, qt.y0, qt.x1, my)

def _qt_insert(qt, node):
    if qt.mass == 0 and qt.body is None:
        qt.body = node
        qt.mass = 1
        qt.cx, qt.cy = node.x, node.y
        return
    if qt.body is not None:
        existing = qt.body
        qt.body = None
        q = _qt_quadrant(qt, existing.x, existing.y)
        if qt.children[q] is None:
            qt.children[q] = _QTNode(*_qt_child_bounds(qt, q))
        _qt_insert(qt.children[q], existing)
    q = _qt_quadrant(qt, node.x, node.y)
    if qt.children[q] is None:
        qt.children[q] = _QTNode(*_qt_child_bounds(qt, q))
    _qt_insert(qt.children[q], node)

def _qt_mass(qt):
    if qt is None:
        return
    if qt.body is not None:
        return
    qt.cx = qt.cy = qt.mass = 0.0
    for c in qt.children:
        if c is not None:
            _qt_mass(c)
            qt.cx += c.cx * c.mass
            qt.cy += c.cy * c.mass
            qt.mass += c.mass
    if qt.mass > 0:
        qt.cx /= qt.mass
        qt.cy /= qt.mass

def _bh_apply(node, qt, strength, alpha, theta):
    if qt is None or qt.mass == 0:
        return
    if qt.body is node:
        return
    dx = qt.cx - node.x
    dy = qt.cy - node.y
    dist_sq = dx * dx + dy * dy
    width = qt.x1 - qt.x0
    if width * width / max(dist_sq, 1e-10) < theta * theta:
        if dist_sq < 1e-10:
            return
        dist = math.sqrt(dist_sq)
        force = strength * qt.mass * alpha / dist
        node.fx += (dx / dist) * force
        node.fy += (dy / dist) * force
        return
    if qt.body is not None:
        if dist_sq < 1e-10:
            return
        dist = math.sqrt(dist_sq)
        force = strength * alpha / dist
        node.fx += (dx / dist) * force
        node.fy += (dy / dist) * force
        return
    for c in qt.children:
        _bh_apply(node, c, strength, alpha, theta)
```

Save this as a Text DAT in your TD project. Reference it from Script CHOPs or Execute DATs via `op('force_simulation_td').module`.
