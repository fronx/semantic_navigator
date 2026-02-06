# TouchDesigner Implementation Guide: Semantic Zoom & Hover Interaction

## Overview

Analysis of porting the semantic zoom and hover interaction system from R3F to TouchDesigner, including embedding similarity computation, instance picking, and camera controls.

## 1. Embedding Similarity - Storage and Computation

**Challenge:** Store 1536-dimensional embeddings and compute cosine similarity efficiently.

**Recommended Approach:** Table DAT + Python Script DAT (hybrid)

### Storage Strategy
- **Table DAT** for embedding storage
  - Each row = one node (keyword/chunk)
  - Column 0: Node ID (text)
  - Columns 1-1536: Embedding dimensions (float)

### Computation Strategy

**Option A: Python Script DAT with NumPy (Recommended for prototyping)**

```python
import numpy as np

# Cache embeddings as NumPy array on first run
if not hasattr(op, 'embeddings_cache'):
    table = op('embeddings_table')
    op.embeddings_cache = np.array([[float(c.val) for c in row[1:]]
                                     for row in table.rows()[1:]])
    op.node_ids = [row[0].val for row in table.rows()[1:]]

def cosine_similarity(vec_a, vec_b):
    """Dot product of normalized vectors"""
    return np.dot(vec_a, vec_b)

def compute_similarity_to_focal(focal_embedding, threshold=0.5):
    """Returns node IDs that pass similarity threshold"""
    similarities = np.dot(op.embeddings_cache, focal_embedding)
    passing_indices = np.where(similarities >= threshold)[0]
    return [op.node_ids[i] for i in passing_indices]
```

**Performance:** ~1-5ms for 1000 nodes

**Option B: GLSL Compute Shader (Best for 60fps real-time)**

- Pack embeddings into textures (1536 dims → 384 RGBA pixels)
- GLSL TOP in compute mode calculates similarities
- Output: 1D texture with similarity scores
- **Performance:** <1ms for 1000+ nodes

**Option C: CHOP Math (Limited)**
- Not recommended for 1536-dim embeddings

## 2. Semantic Filtering - Focus-Based Visibility

**Core Algorithm:**

```python
def compute_visible_set_multi(nodes, focal_embeddings, threshold):
    """
    Multi-centroid approach: Node visible if similar to ANY focal node.

    Returns: Set of visible node IDs
    """
    visible = set()

    if threshold <= 0:
        return {n['id'] for n in nodes}

    for node in nodes:
        if 'embedding' not in node:
            continue

        max_similarity = max(
            cosine_similarity(node['embedding'], focal_emb)
            for focal_emb in focal_embeddings
        )

        if max_similarity >= threshold:
            visible.add(node['id'])

    return visible
```

**TouchDesigner Implementation:**
1. Select DAT to filter visible instances
2. Python Script DAT computes `visible` set
3. Output to Table DAT: `instance_id`, `visible` (0/1)
4. Drive instance opacity/scale in Geometry COMP

## 3. Render Pick - Instance Picking

**TouchDesigner Native Solution:** Render Pick CHOP

### Setup
```
Geometry COMP (with instancing)
  → Render TOP
    → Render Pick CHOP
```

### Configuration
- **Pick Location:** `U` and `V` parameters (0-1 normalized)
- **Instance ID:** Returned in `instanceid` channel
- **Position:** `worldx`, `worldy`, `worldz` channels
- **Picked Status:** `picked` channel = 1 when hit

### Python Integration
```python
def onValueChange(channel, sampleIndex, val, prev):
    pick_chop = op('renderpick1')

    mouse_u = op('mouse_in')['u']
    mouse_v = op('mouse_in')['v']

    pick_chop.par.u = mouse_u
    pick_chop.par.v = mouse_v

    if pick_chop['picked'][0] > 0:
        instance_id = int(pick_chop['instanceid'][0])
        compute_hover_highlight(instance_id)
```

**Performance:** Native operator, real-time at 60fps

## 4. Hover Highlighting - Similarity-Based Colors

**Algorithm:**

```python
def spatial_semantic_filter(nodes, cursor_pos, radius, embeddings, threshold):
    """
    1. Find nodes within spatial radius of cursor
    2. Compute centroid of their embeddings
    3. Highlight ALL nodes similar to centroid
    """
    # Step 1: Spatial filter
    spatial_nodes = [n for n in nodes if distance(n['pos'], cursor_pos) <= radius]

    if not spatial_nodes:
        return set()

    # Step 2: Compute centroid
    spatial_embeddings = [embeddings[n['id']] for n in spatial_nodes]
    centroid = normalize(np.mean(spatial_embeddings, axis=0))

    # Step 3: Semantic filter (all nodes)
    highlighted = set()
    for node in nodes:
        emb = embeddings.get(node['id'])
        if emb and cosine_similarity(emb, centroid) >= threshold:
            highlighted.add(node['id'])

    return highlighted
```

**TouchDesigner Implementation - CHOP-based color update:**

```python
highlighted_ids = spatial_semantic_filter(...)

color_chop = op('instance_colors')
for i, node in enumerate(nodes):
    if node['id'] in highlighted_ids:
        color_chop[i]['r'] = 1.0  # Highlighted: full brightness
        color_chop[i]['a'] = 1.0
    else:
        color_chop[i]['r'] = 0.3  # Dimmed: baseDim
        color_chop[i]['a'] = 0.3
```

## 5. Zoom-to-Cursor Math

**Algorithm:**

```python
import math

CAMERA_FOV_RADIANS = math.radians(10)

def calculate_zoom_to_cursor(old_z, new_z, camera_x, camera_y, cursor_ndc, aspect):
    """
    Keep point under cursor fixed during zoom.

    Returns: dict with new_camera_x, new_camera_y
    """
    # Visible dimensions before zoom
    old_visible_height = 2 * old_z * math.tan(CAMERA_FOV_RADIANS / 2)
    old_visible_width = old_visible_height * aspect

    # Graph position under cursor (stays fixed)
    graph_x = camera_x + cursor_ndc['x'] * (old_visible_width / 2)
    graph_y = camera_y + cursor_ndc['y'] * (old_visible_height / 2)

    # Visible dimensions after zoom
    new_visible_height = 2 * new_z * math.tan(CAMERA_FOV_RADIANS / 2)
    new_visible_width = new_visible_height * aspect

    # Adjust camera to keep graph point under cursor
    new_camera_x = graph_x - cursor_ndc['x'] * (new_visible_width / 2)
    new_camera_y = graph_y - cursor_ndc['y'] * (new_visible_height / 2)

    return {'camera_x': new_camera_x, 'camera_y': new_camera_y}
```

**TouchDesigner Integration:**

```python
# Execute DAT on Mouse Wheel
def onValueChange(channel, sampleIndex, val, prev):
    if channel.name == 'wheel':
        delta_y = val - prev
        zoom_factor = 1.003 ** delta_y

        old_z = op('cam1').par.tz
        new_z = max(CAMERA_Z_MIN, min(CAMERA_Z_MAX, old_z * zoom_factor))

        cursor_ndc = {
            'x': mouse['u'][0] * 2 - 1,
            'y': mouse['v'][0] * 2 - 1
        }

        result = calculate_zoom_to_cursor(
            old_z, new_z,
            op('cam1').par.tx, op('cam1').par.ty,
            cursor_ndc, aspect
        )

        op('cam1').par.tx = result['camera_x']
        op('cam1').par.ty = result['camera_y']
        op('cam1').par.tz = new_z
```

## 6. Performance Analysis

**Can embedding similarity run at 60fps for 1000+ nodes?**

| Approach | Typical Time (1000 nodes) | 60fps Budget (16.7ms) | Feasible? |
|----------|---------------------------|----------------------|-----------|
| Python + NumPy (cached) | 1-5ms | ✓ | **Yes** |
| GLSL Compute Shader | <1ms (GPU) | ✓ | **Yes** |
| Python loop (no NumPy) | 50-200ms | ✗ | **No** |
| Table DAT iteration | 100-500ms | ✗ | **No** |

**Recommendations:**
- **Prototype:** Python + NumPy with cached embeddings
- **Production:** GLSL compute shader for maximum performance
- **Avoid:** Direct Python loops over Table DAT rows

## 7. Complete Code Outlines

Full implementations provided in report for:
- **EmbeddingManager** class (Python Script DAT)
- **Spatial filter** functions
- **Hover controller** (Execute DAT)
- **Instance color updater** (Script CHOP)
- **Zoom controller** (Execute DAT on wheel)

## Summary

**Best Practices for TouchDesigner:**
1. **Embeddings:** Store in Table DAT, cache as NumPy arrays
2. **Similarity Computation:** NumPy for prototype, GLSL for production
3. **Instance Picking:** Use Render Pick CHOP (native, fast)
4. **Color Updates:** Script CHOP or GLSL shader with per-instance attributes
5. **Zoom-to-Cursor:** Python Script DAT on Mouse Wheel event
6. **Pan:** Mouse In CHOP + Execute DAT

**Performance Targets (1000 nodes):**
- Embedding similarity: <5ms (NumPy) or <1ms (GLSL)
- Instance picking: <1ms (Render Pick CHOP)
- Color updates: <2ms (CHOP updates)
- Total hover update: <10ms (60fps safe)
