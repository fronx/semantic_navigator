# TouchDesigner Implementation Roadmap

**Goal:** Port the Semantic Navigator R3F visualization to TouchDesigner through incremental, testable sessions.

This roadmap breaks down the conversion into phases that build upon each other. Each phase has clear success criteria and testing protocols to ensure stability before moving forward.

---

## Prerequisites

### Development Environment Setup

**Before starting any implementation:**

1. **TouchDesigner Installation**
   - TouchDesigner 2023.11760+ (Python 3.11.x support)
   - License: Free or Commercial (depending on resolution needs)

2. **Python Libraries**
   ```bash
   mkdir ~/TouchDesigner_packages
   pip3.11 install --target ~/TouchDesigner_packages python-igraph numpy requests
   ```

   Configure in TD: Edit → Preferences → DATs → "Python 64-bit Module Path"

3. **Data Access**
   - Supabase credentials for graph data export
   - Claude API key for LLM label generation (optional for MVP)
   - Sample dataset: Export 100-200 keyword graph from current system

4. **Testing Framework**
   - Document expected behavior for each component
   - Create comparison screenshots/videos from R3F implementation
   - Frame rate monitoring setup (Performance Monitor CHOP)

### Test-Driven Development in TouchDesigner

While TouchDesigner doesn't have traditional unit testing frameworks, we'll use:

**Validation Techniques:**
1. **Visual Regression Testing** - Compare screenshots at key states
2. **Performance Benchmarks** - Frame rate targets per phase
3. **Data Validation** - Assert expected values in Table DATs/CHOPs
4. **Component Contracts** - Document input/output specifications
5. **Incremental Builds** - Each session adds ONE testable component

**Testing Pattern for Each Phase:**
```python
# Example validation script (Python Script DAT)
def validate_component():
    """
    Validate that this component meets specifications.
    Returns: (success: bool, message: str)
    """
    try:
        # Test 1: Check data exists
        assert op('data_table').numRows > 1, "No data loaded"

        # Test 2: Check performance
        fps = op('performance_monitor')['fps'][0]
        assert fps >= 30, f"Performance below target: {fps} fps"

        # Test 3: Check correctness
        expected_node_count = 100
        actual_node_count = len(op('node_positions'))
        assert actual_node_count == expected_node_count, \
            f"Node count mismatch: {actual_node_count} != {expected_node_count}"

        return (True, "✓ All validations passed")
    except AssertionError as e:
        return (False, f"✗ Validation failed: {e}")

# Run validation
success, message = validate_component()
print(message)
```

---

## Phase 1: Foundation & Static Visualization (Session 1-2)

**Objective:** Display static keyword graph with basic camera control.

**Reference:**
- `reports/01-force-simulation.md` (data pipeline section)
- `reports/03-edge-rendering.md` (basic geometry)

### Session 1A: Data Pipeline & Basic Geometry

**Tasks:**
1. Export sample graph data (100 keywords, edges) from Supabase to JSON
2. Create Table DAT pipeline: JSON → Parse → Node positions table
3. Build instanced circle geometry for keywords (static positions)
4. Set up camera with FOV 10°, position at z=10500

**Testing:**
```python
# Validation: Phase 1A
def test_phase_1a():
    # 1. Data loaded correctly
    nodes = op('node_positions_table')
    assert nodes.numRows == 100, "Expected 100 nodes"
    assert nodes.numCols >= 3, "Expected x, y, id columns"

    # 2. Geometry exists
    geo = op('keyword_instances')
    assert geo.numPoints == 100, "Expected 100 instance points"

    # 3. Camera positioned correctly
    cam = op('cam1')
    assert abs(cam.par.tz - 10500) < 1, "Camera Z position incorrect"
    assert abs(cam.par.fovy - 10) < 0.1, "Camera FOV incorrect"

    # 4. Render succeeds
    render = op('render_main')
    assert render.width == 1920, "Unexpected render resolution"

    return "✓ Phase 1A validation passed"
```

**Success Criteria:**
- [ ] 100 circles visible in viewport
- [ ] Camera navigation works (tumble, zoom, pan)
- [ ] All nodes rendered at correct world positions
- [ ] Frame rate: 60fps stable

### Session 1B: Edge Rendering

**Tasks:**
1. Create edge list Table DAT from graph data
2. Implement `compute_arc_points()` in Python Script SOP
3. Generate curved lines between nodes (Script SOP with open polygons)
4. Apply Line MAT with vertex colors

**Reference:** `reports/03-edge-rendering.md` - complete code skeleton provided

**Testing:**
```python
# Validation: Phase 1B
def test_phase_1b():
    # 1. Edge data loaded
    edges = op('edge_list_table')
    assert edges.numRows > 50, "Expected edge data"

    # 2. Edges rendered
    edge_geo = op('edges_sop')
    assert edge_geo.numPrims > 0, "No edge primitives created"

    # 3. Arc computation working
    first_edge = edge_geo.prim(0)
    assert first_edge.numVertices == 17, "Expected 17 vertices per arc"

    # 4. Visual check: edges curved (not straight)
    # Manual inspection required

    return "✓ Phase 1B validation passed"
```

**Success Criteria:**
- [ ] Curved edges connect all keyword nodes
- [ ] 16 segments per edge, smooth arcs
- [ ] Edge colors blend source and target node colors
- [ ] Frame rate: 60fps with 100 nodes + 200 edges

**Deliverables:**
- Working TD project with static graph visualization
- Screenshot comparison with R3F implementation
- Performance benchmark baseline

---

## Phase 2: Interactive Camera & Basic Hover (Session 3-4)

**Objective:** Zoom-to-cursor camera control and instance picking.

**Reference:**
- `reports/05-semantic-zoom-interaction.md` (camera and picking sections)

### Session 2A: Zoom-to-Cursor Implementation

**Tasks:**
1. Create Mouse In CHOP for cursor tracking
2. Implement `calculate_zoom_to_cursor()` in Execute DAT (mouse wheel callback)
3. Add zoom limits (min Z=100, max Z=dynamic)
4. Implement pan on middle-mouse drag

**Testing:**
```python
# Validation: Phase 2A
def test_phase_2a():
    # 1. Mouse input working
    mouse = op('mouse_in')
    assert 'wheel' in [c.name for c in mouse.chans()], "Wheel channel missing"

    # 2. Camera moves correctly
    # Manual: Zoom with wheel - graph point under cursor should stay fixed
    # Manual: Pan with MMB drag - viewport moves smoothly

    # 3. Zoom limits enforced
    cam = op('cam1')
    assert cam.par.tz >= 100, "Camera too close (below min Z)"
    assert cam.par.tz <= 25000, "Camera too far (above max Z)"

    return "✓ Phase 2A validation passed"
```

**Success Criteria:**
- [ ] Zoom always centers on cursor position (not viewport center)
- [ ] Smooth exponential zoom feel (matches R3F)
- [ ] Pan with middle-mouse or ctrl+drag
- [ ] No jitter or camera jumps

### Session 2B: Instance Picking & Hover Highlight

**Tasks:**
1. Add Render Pick CHOP connected to main render
2. Implement hover detection (Execute DAT on mouse move)
3. Create highlight system: hovered node → scale 1.5x, full opacity
4. Dim non-hovered nodes to 0.3 opacity

**Testing:**
```python
# Validation: Phase 2B
def test_phase_2b():
    # 1. Render Pick configured
    pick = op('render_pick')
    assert pick.par.u.eval() >= 0, "Pick U parameter not set"

    # 2. Pick detection working
    # Manual: Hover over node - should see instanceid > 0

    # 3. Visual feedback
    # Manual: Hovered node should be larger and brighter
    # Manual: Other nodes should be dimmed

    return "✓ Phase 2B validation passed"
```

**Success Criteria:**
- [ ] Hovering any node highlights it instantly
- [ ] Highlight renders at 60fps (no lag)
- [ ] Smooth opacity transitions
- [ ] Click detection works (console log click events)

**Deliverables:**
- Interactive camera matching R3F behavior
- Working hover feedback system
- Performance: 60fps with interactions

---

## Phase 3: Force Simulation & Dynamic Layout (Session 5-7)

**Objective:** Live D3-force simulation for keyword positioning.

**Reference:** `reports/01-force-simulation.md` - Python Script CHOP approach

### Session 3A: Python Script CHOP Simulation (Prototype)

**Tasks:**
1. Implement D3-force algorithm in Python Script CHOP
2. Set up feedback loop: positions → forces → velocities → positions
3. Configure forces: link (springs), many-body (repulsion), center
4. Add simulation controls: alpha, velocityDecay, manual tick

**Testing:**
```python
# Validation: Phase 3A
def test_phase_3a():
    # 1. Simulation running
    sim = op('force_simulation_chop')
    assert sim.numSamples == 100, "Simulation node count incorrect"

    # 2. Positions updating
    # Manual: Watch nodes spread apart over ~5 seconds

    # 3. Convergence
    # After 10 seconds, nodes should be stable (velocities near zero)

    # 4. Performance
    fps = op('performance_monitor')['fps'][0]
    assert fps >= 30, f"Simulation too slow: {fps} fps"

    return "✓ Phase 3A validation passed"
```

**Success Criteria:**
- [ ] Nodes organize into clustered layout
- [ ] Similar keywords stay close together
- [ ] No overlapping nodes (repulsion works)
- [ ] Frame rate: 30-60fps during simulation

### Session 3B: Zoom-Dependent Energy

**Tasks:**
1. Add camera Z → normalized zoom level calculation
2. Implement energy curve: far = active, near = frozen
3. Connect zoom level to simulation alpha and velocityDecay
4. Test: zoom out → nodes reorganize, zoom in → nodes freeze

**Testing:**
```python
# Validation: Phase 3B
def test_phase_3b():
    # 1. Energy responds to zoom
    cam_z = op('cam1').par.tz
    alpha = op('sim_params')['alpha'][0]

    if cam_z > 15000:  # Zoomed out
        assert alpha > 0.2, "Alpha too low when zoomed out"
    elif cam_z < 3000:  # Zoomed in
        assert alpha < 0.05, "Alpha too high when zoomed in"

    # 2. Visual validation
    # Manual: Zoom out - nodes should gently reposition
    # Manual: Zoom in - nodes should freeze in place

    return "✓ Phase 3B validation passed"
```

**Success Criteria:**
- [ ] Zoomed out: simulation active, nodes adjust
- [ ] Zoomed in: simulation frozen, stable layout
- [ ] Smooth energy transition (no sudden jumps)
- [ ] Performance: 60fps across zoom range

### Session 3C: Performance Optimization (If Needed)

**Only if Session 3A/3B < 30fps with 200+ nodes:**

**Tasks:**
1. Profile Python Script CHOP (identify bottleneck)
2. Vectorize force calculations with NumPy
3. Implement spatial hashing (reduce N² to ~N)
4. Consider GLSL compute shader migration

**Testing:**
```python
# Performance benchmarks
def test_phase_3c():
    fps = op('performance_monitor')['fps'][0]
    node_count = op('node_positions_table').numRows

    if node_count <= 200:
        assert fps >= 45, f"Performance target not met: {fps} fps"
    elif node_count <= 500:
        assert fps >= 30, f"Performance target not met: {fps} fps"

    return f"✓ Performance acceptable: {fps} fps @ {node_count} nodes"
```

**Deliverables:**
- Dynamic force-directed layout
- Zoom-responsive simulation energy
- Performance: 30-60fps with target node count

---

## Phase 4: Label System Foundation (Session 8-10)

**Objective:** Basic text labels for keywords using SDF rendering.

**Reference:** `reports/02-label-system.md` - SDF approach

### Session 4A: SDF Font Atlas Generation

**Tasks:**
1. Generate MSDF atlas from font using msdfgen tool
2. Import atlas texture into TouchDesigner
3. Create GLSL Material with SDF sampling shader
4. Test with single instanced quad (verify crisp rendering at any scale)

**Testing:**
```python
# Validation: Phase 4A
def test_phase_4a():
    # 1. Atlas texture loaded
    atlas = op('font_atlas')
    assert atlas.width == 1024, "Atlas resolution incorrect"

    # 2. GLSL material exists
    mat = op('sdf_material')
    assert 'msdfAtlas' in mat.uniforms, "SDF texture uniform missing"

    # 3. Visual validation
    # Manual: Render single character at various scales
    # Should be crisp at all zoom levels

    return "✓ Phase 4A validation passed"
```

**Success Criteria:**
- [ ] Font atlas renders correctly
- [ ] SDF shader produces crisp edges
- [ ] Scales from tiny to huge without blur
- [ ] Frame rate: 60fps

### Session 4B: Keyword Label Positioning

**Tasks:**
1. Create Table DAT with keyword label data (id, text, worldX, worldY)
2. Implement `worldToScreen()` projection in Python
3. Generate character quads (Python SOP) with instance positions
4. Position labels to right of keyword nodes

**Testing:**
```python
# Validation: Phase 4B
def test_phase_4b():
    # 1. Label data exists
    labels = op('label_data_table')
    assert labels.numRows == 100, "Label count mismatch"

    # 2. Projection working
    # Manual: Labels should stick to nodes during camera movement

    # 3. Positioning correct
    # Manual: Labels should be to the right of circles
    # Manual: No overlapping with node geometry

    return "✓ Phase 4B validation passed"
```

**Success Criteria:**
- [ ] All keyword nodes have labels
- [ ] Labels positioned correctly in screen space
- [ ] Labels follow nodes during camera movement
- [ ] Frame rate: 60fps with 100 labels

### Session 4C: Label Glow & Styling

**Tasks:**
1. Enhance SDF shader with glow effect (distance field expansion)
2. Add theme-aware colors (light/dark mode)
3. Implement zoom-based font scaling
4. Add hover state: scale 1.5x when parent node hovered

**Testing:**
```python
# Validation: Phase 4C
def test_phase_4c():
    # 1. Glow visible
    # Manual: Labels should have subtle halo/glow

    # 2. Zoom scaling
    # Manual: Zoom in - text should grow
    # Manual: Zoom out - text should shrink (but remain readable)

    # 3. Hover scaling
    # Manual: Hover node - label should enlarge smoothly

    return "✓ Phase 4C validation passed"
```

**Success Criteria:**
- [ ] Text has subtle glow matching R3F aesthetic
- [ ] Font size adjusts with zoom level
- [ ] Hover states work smoothly
- [ ] Frame rate: 60fps

**Deliverables:**
- Working SDF label system for keywords
- Labels properly positioned and styled
- Performance: 60fps with 100+ labels

---

## Phase 5: Semantic Zoom & Filtering (Session 11-13)

**Objective:** Embedding-based visibility filtering and hover highlighting.

**Reference:** `reports/05-semantic-zoom-interaction.md`

### Session 5A: Embedding Data Pipeline

**Tasks:**
1. Export keyword embeddings (1536-dim vectors) from Supabase
2. Load into Table DAT (node_id + 1536 float columns)
3. Cache as NumPy array in Python Script DAT
4. Implement `cosine_similarity()` function
5. Test: compute similarity between two known keywords

**Testing:**
```python
# Validation: Phase 5A
def test_phase_5a():
    # 1. Embeddings loaded
    emb_table = op('embeddings_table')
    assert emb_table.numCols == 1537, "Expected 1536 dims + id"

    # 2. Cached correctly
    # Check that op('emb_manager').storage['embeddings_cache'] exists

    # 3. Similarity computation
    # Test known similar keywords (e.g., "neural network" + "deep learning")
    # Should return similarity > 0.7

    return "✓ Phase 5A validation passed"
```

**Success Criteria:**
- [ ] All embeddings loaded without errors
- [ ] Similarity computation returns expected values
- [ ] Performance: <5ms for 100 similarity checks

### Session 5B: Hover-Based Semantic Highlighting

**Tasks:**
1. Implement `spatial_semantic_filter()` (see report for algorithm)
2. On hover: find nodes near cursor, compute embedding centroid
3. Highlight all nodes semantically similar to centroid
4. Visual: hovered node + similar nodes bright, others dimmed

**Testing:**
```python
# Validation: Phase 5B
def test_phase_5b():
    # 1. Spatial filter working
    # Manual: Hover a node
    # Expect: ~5-20 nodes highlighted (semantically similar)

    # 2. Semantic accuracy
    # Manual: Hover "neural network"
    # Expect: "deep learning", "backpropagation" also highlighted
    # Expect: Unrelated keywords (e.g., "database") NOT highlighted

    # 3. Performance
    fps = op('performance_monitor')['fps'][0]
    assert fps >= 45, f"Hover highlight too slow: {fps} fps"

    return "✓ Phase 5B validation passed"
```

**Success Criteria:**
- [ ] Hovering highlights semantically related nodes
- [ ] Highlighting feels intuitive (matches expectations)
- [ ] Frame rate: 45-60fps during hover
- [ ] Smooth opacity transitions

### Session 5C: Click-to-Focus Semantic Zoom

**Tasks:**
1. Implement click handler (Execute DAT on mouse click)
2. On click: set focused node, compute visibility set
3. Fade out nodes below similarity threshold
4. Add UI to clear filter (return to full graph)

**Testing:**
```python
# Validation: Phase 5C
def test_phase_5c():
    # 1. Click detection
    # Manual: Click a node - should see focus change

    # 2. Visibility filtering
    # Manual: After click, ~30-50% of nodes should remain visible

    # 3. Filter clearing
    # Manual: Press clear button - all nodes reappear

    return "✓ Phase 5C validation passed"
```

**Success Criteria:**
- [ ] Clicking focuses graph on semantic neighborhood
- [ ] Filtered view shows relevant subgraph
- [ ] Can navigate between focused views
- [ ] Performance: 60fps

**Deliverables:**
- Semantic hover highlighting
- Click-to-focus filtering
- Embedding similarity working at interactive speed

---

## Phase 6: Leiden Clustering & LLM Labels (Session 14-16)

**Objective:** Multi-resolution clustering with generated semantic labels.

**Reference:** `reports/06-clustering-llm-labels.md`

### Session 6A: Pre-computation Script

**Tasks (External to TouchDesigner):**
1. Create Python script using python-igraph
2. Load graph data from Supabase
3. Run Leiden clustering at 8 resolutions (0.1, 0.3, 0.5, 1.0, 1.5, 2.0, 3.0, 4.0)
4. Export cluster assignments to JSON
5. (Optional) Call Claude API for cluster labels

**Testing:**
```python
# Validation: Phase 6A (run externally)
def test_phase_6a():
    import json

    # Load generated clusters
    with open('precomputed_clusters.json') as f:
        clusters = json.load(f)

    # 1. All resolutions present
    resolutions = set(c['resolution'] for c in clusters)
    expected = {0.1, 0.3, 0.5, 1.0, 1.5, 2.0, 3.0, 4.0}
    assert resolutions == expected, f"Missing resolutions: {expected - resolutions}"

    # 2. All nodes assigned
    node_ids = set(c['node_id'] for c in clusters if c['resolution'] == 1.0)
    assert len(node_ids) == 100, "Not all nodes clustered"

    # 3. Reasonable cluster counts
    for res in expected:
        cluster_ids = set(c['cluster_id'] for c in clusters if c['resolution'] == res)
        assert 2 <= len(cluster_ids) <= 50, f"Unusual cluster count at res {res}"

    return "✓ Phase 6A validation passed"
```

**Success Criteria:**
- [ ] JSON file contains all resolutions
- [ ] Every node assigned to cluster at each resolution
- [ ] Cluster counts reasonable (2-50 per resolution)
- [ ] (Optional) LLM labels generated

### Session 6B: Load Clusters into TouchDesigner

**Tasks:**
1. Load JSON via File DAT → Text DAT → Python parse
2. Build Table DAT with schema: resolution | node_id | cluster_id | label
3. Implement `switch_resolution()` in Python Script DAT
4. Cache clusters in Storage dict per resolution
5. Test: switch between resolutions, verify cluster assignments change

**Testing:**
```python
# Validation: Phase 6B
def test_phase_6b():
    # 1. Data loaded
    clusters_table = op('clusters_table')
    assert clusters_table.numRows > 800, "Expected ~800 rows (100 nodes × 8 res)"

    # 2. Resolution switching
    clusters_r1 = switch_resolution(1.0)
    assert len(clusters_r1) == 100, "All nodes should have r=1.0 cluster"

    clusters_r2 = switch_resolution(2.0)
    # Cluster IDs should differ from r=1.0 (higher resolution = more clusters)

    # 3. Performance
    # Switching should be <1ms (cached in Storage)

    return "✓ Phase 6B validation passed"
```

**Success Criteria:**
- [ ] All cluster data accessible in TouchDesigner
- [ ] Resolution switching works instantly
- [ ] Cluster assignments correct at each resolution
- [ ] Frame rate: 60fps

### Session 6C: Cluster-Based Node Coloring

**Tasks:**
1. Assign colors to nodes based on cluster_id
2. Create color palette (8-12 distinct colors)
3. Implement smooth color transitions when switching resolutions
4. Add cluster labels at cluster centroids (using existing SDF system)

**Testing:**
```python
# Validation: Phase 6C
def test_phase_6c():
    # 1. Color assignments
    # Manual: Nodes in same cluster should have same color

    # 2. Color transitions
    # Manual: Switch resolution - colors should smoothly crossfade

    # 3. Cluster labels visible
    # Manual: At moderate zoom, cluster labels appear at centroids

    return "✓ Phase 6C validation passed"
```

**Success Criteria:**
- [ ] Node colors match cluster membership
- [ ] Visually distinct color palette
- [ ] Smooth color transitions between resolutions
- [ ] Cluster labels positioned at centroids

**Deliverables:**
- Multi-resolution Leiden clustering integrated
- Cluster-based coloring system
- (Optional) LLM-generated cluster labels

---

## Phase 7: Visual Polish & Effects (Session 17-19)

**Objective:** Frosted glass panel, depth separation, and aesthetic refinement.

**Reference:** `reports/04-frosted-glass-effect.md`

### Session 7A: Layer Separation (Content Nodes)

**Tasks:**
1. Add second node type: content/chunk nodes (rounded rectangles)
2. Position at z=-150 (behind keyword layer at z=0)
3. Implement lazy loading: only create content nodes when zoomed in
4. Add simple tethering: content nodes orbit parent keywords

**Testing:**
```python
# Validation: Phase 7A
def test_phase_7a():
    cam_z = op('cam1').par.tz

    # 1. Content nodes only visible when zoomed in
    if cam_z < 5000:  # Zoomed in
        content_geo = op('content_nodes_geo')
        assert content_geo.numPoints > 0, "Content nodes should be visible"
    else:  # Zoomed out
        # Content nodes should be culled or faded
        pass

    # 2. Depth separation
    kw_z = op('keyword_nodes_geo').worldTransform[2][3]
    content_z = op('content_nodes_geo').worldTransform[2][3]
    assert abs(kw_z - content_z) > 100, "Layers not separated"

    return "✓ Phase 7A validation passed"
```

**Success Criteria:**
- [ ] Content nodes appear when zoomed in
- [ ] Clear depth separation (keywords in front)
- [ ] Content nodes orbit parent keywords
- [ ] Frame rate: 60fps with both layers

### Session 7B: Frosted Glass Panel

**Tasks:**
1. Create plane geometry at z=-75 (between layers)
2. Implement multi-pass render approach (see report)
3. Render content layer to texture → Blur TOP → Apply to panel
4. Composite: content → panel → keywords
5. Add thickness parameter controlling blur strength

**Testing:**
```python
# Validation: Phase 7B
def test_phase_7b():
    # 1. Render pipeline configured
    assert op('render_content_layer').exists(), "Content layer render missing"
    assert op('blur_panel').exists(), "Blur TOP missing"

    # 2. Visual validation
    # Manual: Content layer should appear "frosted" through panel
    # Manual: Keywords should be sharp (in front of panel)

    # 3. Performance
    fps = op('performance_monitor')['fps'][0]
    assert fps >= 45, f"Multi-pass render too slow: {fps} fps"

    return "✓ Phase 7B validation passed"
```

**Success Criteria:**
- [ ] Frosted glass effect visible between layers
- [ ] Blur quality matches R3F aesthetic
- [ ] Frame rate: 45-60fps
- [ ] Thickness parameter adjusts blur strength

### Session 7C: Final Polish

**Tasks:**
1. Refine color palette and themes
2. Add smooth camera easing (damped spring)
3. Optimize label visibility (degree-based filtering)
4. Add ambient lighting and environment map
5. Final performance optimization pass

**Testing:**
```python
# Validation: Phase 7C
def test_phase_7c():
    # 1. Camera feel
    # Manual: Camera movement should feel smooth and polished

    # 2. Label filtering
    # Manual: At far zoom, only high-degree keyword labels visible
    # Manual: At close zoom, all nearby labels appear

    # 3. Overall aesthetic
    # Side-by-side comparison with R3F implementation

    # 4. Performance stable
    fps = op('performance_monitor')['fps'][0]
    assert fps >= 55, f"Final performance below target: {fps} fps"

    return "✓ Phase 7C validation passed"
```

**Success Criteria:**
- [ ] Visual quality matches or exceeds R3F
- [ ] All interactions feel polished and responsive
- [ ] Performance: 55-60fps sustained
- [ ] Ready for production use

**Deliverables:**
- Complete TouchDesigner visualization
- Feature parity with R3F implementation
- Optimized for real-time performance

---

## Phase 8: TouchDesigner-Specific Enhancements (Session 20+)

**Objective:** Leverage TouchDesigner's unique capabilities beyond web limitations.

### Potential Enhancements

**Audio Reactivity:**
- Audio Analysis CHOP → modulate simulation forces
- Beat detection → pulse node sizes
- Frequency bands → color shifts

**Multi-Output:**
- Projection mapping setup
- Multi-monitor spanning
- LED wall integration

**Hardware Control:**
- MIDI controllers for cluster resolution
- OSC integration for remote control
- Leap Motion / gesture control

**Timeline & Cues:**
- Keyframe camera paths
- Sequence cluster resolution changes
- Trigger filter states on cue

**Custom Shaders:**
- Particle trails behind nodes
- Custom bloom/glow effects
- Stylized rendering (toon shading, etc.)

---

## Testing Strategy Summary

### Per-Session Validation Checklist

Before moving to next session:

1. **Visual Regression Test**
   - [ ] Screenshot comparison with R3F reference
   - [ ] No unexpected rendering artifacts

2. **Performance Benchmark**
   - [ ] Frame rate meets or exceeds target
   - [ ] No frame drops during interactions
   - [ ] Stable over 5-minute stress test

3. **Data Validation**
   - [ ] Table DAT row counts correct
   - [ ] CHOP channel values in expected ranges
   - [ ] No NaN or inf values in computations

4. **Component Contract**
   - [ ] All inputs connected and valid
   - [ ] Outputs match expected format
   - [ ] Error handling for edge cases

5. **Integration Test**
   - [ ] New component works with existing system
   - [ ] No regressions in previous phases
   - [ ] State transitions smooth

### Performance Targets

**Minimum viable performance:**
- 30fps sustained (no drops below 25fps)
- <16ms render time (60fps budget)
- <100ms for user interactions (hover, click)

**Target performance:**
- 60fps sustained
- <8ms render time
- <50ms for interactions

**Optimization priority order:**
1. Frame rate stability > peak frame rate
2. Interaction responsiveness > visual fidelity
3. Core features > polish

---

## Notes & Considerations

### Common Pitfalls

1. **Table DAT Performance:** Avoid iterating Table DATs in Python loops. Cache as NumPy arrays or dictionaries.

2. **Feedback Loop Latency:** Script CHOP feedback introduces 1-frame delay. Account for this in simulation.

3. **Resolution Creep:** Texture/render resolution significantly impacts performance. Start low, increase only if needed.

4. **Over-Engineering:** Each phase should deliver minimum viable functionality. Resist urge to add features not in R3F.

5. **State Management:** TD has no React-like state system. Use Storage dict for shared state, but keep it minimal.

### When to Deviate from Plan

**Simplifications acceptable if:**
- Performance target can't be met otherwise
- Feature complexity outweighs value
- TouchDesigner has better alternative approach

**When in doubt:**
- Implement simplest version first
- Measure actual impact
- Optimize only if needed

### Documentation

**Each session should produce:**
1. Updated .toe file with clear naming
2. Brief markdown notes in `touchdesigner/session-notes/`
3. Screenshot/video of milestone
4. Performance metrics (fps, node count, etc.)

---

## Success Criteria

### Phase Completion

A phase is complete when:
- [ ] All sessions in phase finished
- [ ] All validation tests passing
- [ ] Performance targets met
- [ ] Deliverables documented
- [ ] No known blockers for next phase

### Project Completion

The TouchDesigner port is complete when:
- [ ] All 7 core phases finished
- [ ] Visual parity with R3F achieved
- [ ] Performance: 60fps with 200+ keyword graph
- [ ] All core interactions working (zoom, hover, filter, clustering)
- [ ] Documented and ready for extensions

---

## Resource Reference

**Detailed Implementation Guides:**
- `reports/01-force-simulation.md` - Force simulation approaches
- `reports/02-label-system.md` - SDF and label rendering
- `reports/03-edge-rendering.md` - Curved edge geometry
- `reports/04-frosted-glass-effect.md` - Multi-pass rendering
- `reports/05-semantic-zoom-interaction.md` - Embeddings and picking
- `reports/06-clustering-llm-labels.md` - Leiden and LLM integration

**R3F Source Code Reference:**
- `src/components/topics-r3f/` - R3F component implementations
- `src/lib/` - Shared logic and algorithms
- `src/hooks/` - React hooks with state management patterns

**TouchDesigner Resources:**
- [TouchDesigner Documentation](https://docs.derivative.ca/)
- [The Interactive & Immersive HQ](https://interactiveimmersive.io/blog/)
- [TouchDesigner Forum](https://forum.derivative.ca/)

---

## Getting Help

**When stuck:**
1. Review relevant report in `reports/` directory
2. Check R3F source code for reference implementation
3. Search TouchDesigner forum for similar issues
4. Create isolated test case in new .toe file
5. Document issue and seek help with specific question

**Common issues already solved:**
- Performance optimization → See performance sections in reports
- Data pipeline → See Phase 1 validation patterns
- Shader issues → See GLSL examples in reports
- Python integration → See code skeletons in reports
