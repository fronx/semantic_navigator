# R3F → TouchDesigner Conversion Analysis

## Context

The TopicsView R3F renderer is a force-directed keyword graph visualization with:
- ~13 R3F/React components rendering instanced geometry, edges, labels, and effects
- ~10 shared libraries/hooks for force simulation, zoom math, hover interaction, filtering, and clustering
- DOM-based label overlay system with HTML/CSS positioned via 3D→2D projection
- D3-force simulation driving keyword layout + content node spreading
- Supabase backend providing keyword nodes, similarity edges, embeddings, and cluster data

This document surveys what exists and what a TouchDesigner port would require.

---

## Current R3F Architecture Summary

### Scene Graph (render order)
```
Canvas (FOV 10°, camera at z=10500)
├── ambientLight + Environment("city")
└── R3FTopicsScene
    ├── CameraController      — custom zoom-to-cursor + scroll-pan
    ├── LabelsUpdater          — per-frame label manager driver (no geometry)
    ├── ForceSimulation        — D3-force for keywords (no geometry)
    ├── ContentNodes           — InstancedMesh, rounded-rect, z=-150
    ├── TransmissionPanel      — MeshTransmissionMaterial frosted glass
    ├── KeywordEdges           — merged Line geometry, curved arcs
    └── KeywordNodes           — InstancedMesh, circles, z=0

DOM overlay (sibling to Canvas)
└── LabelsOverlay
    ├── Cluster labels         — positioned via worldToScreen()
    ├── Keyword labels         — positioned via worldToScreen(), degree-filtered
    └── Content portals        — positioned via worldToScreen3D(), markdown rendered
```

### Rendering Primitives Used
| Element | Three.js Primitive | Instances | Material |
|---|---|---|---|
| Keywords | InstancedMesh + CircleGeometry(r=10) | N keywords | MeshBasicMaterial, vertexColors |
| Content nodes | InstancedMesh + ShapeGeometry(rounded rect) | N chunks | MeshBasicMaterial, vertexColors |
| Keyword edges | Line + BufferGeometry (merged) | 1 draw call | LineBasicMaterial, vertexColors |
| Transmission panel | Mesh + PlaneGeometry | 1 | MeshTransmissionMaterial (drei) |
| Labels | DOM elements | N labels | CSS positioned |

### Data Pipeline
```
Supabase → API routes → useTopicsFilter() → convertToThreeNodes()
  → ForceSimulation (D3-force) → keyword positions
  → createContentNodes() → useContentSimulation() → content positions
  → useClusterLabels() (Leiden + LLM) → cluster metadata
  → calculateScales(cameraZ) → per-frame visibility/opacity
  → label-overlays.ts manager → DOM label positioning
```

### Key Numeric Parameters
- Camera: FOV 10°, initial Z=10500, min Z~100, max Z=dynamic
- Keywords: circle radius 10 world units, scale 0.3-1.0
- Content: z=-150 depth, exponential fade-in
- Edges: 16 arc segments per edge, sagitta-based curves
- Transmission panel: samples=16, thickness configurable, transmission=0.97

---

## TouchDesigner Mapping

### 1. Geometry → SOPs + Instancing

**Keyword nodes (circles)**
- Circle SOP → Geometry COMP with instancing
- Instance positions from Table DAT or CHOP (x, y, z per keyword)
- Instance colors from CHOP (r, g, b per keyword)
- Instance scale from CHOP (uniform scale per keyword)
- TD equivalent: Geometry Instancing via "Instance" page on Geo COMP

**Content nodes (rounded rects)**
- Rectangle SOP with fillet → same instancing pattern
- z=-150 baked into instance transform
- Color inherited from parent keyword

**Edges (curved lines)**
- Script SOP generating arc vertices per edge (Python equivalent of `computeArcPoints`)
- Or: Line SOP per edge with deform (less efficient)
- Best approach: single Merge SOP with all edge lines, or GLSL-based line rendering
- NaN break trick not available in TD — use separate line primitives or multi-segment approach

### 2. Materials → MATs

| R3F Material | TD Equivalent |
|---|---|
| MeshBasicMaterial + vertexColors | Constant MAT or GLSL MAT with `Cd` attribute |
| LineBasicMaterial + vertexColors | Line MAT or Constant MAT on lines |
| MeshTransmissionMaterial (frosted glass) | **Custom GLSL MAT** or post-process blur (Blur TOP on feedback) — no built-in equivalent |

The **frosted glass panel** is the hardest material to replicate. Options:
1. Render background layer to texture → Blur TOP → project onto plane (multi-pass)
2. Custom GLSL with screen-space refraction sampling
3. Use TD's PBR MAT with transmission (if available in recent TD versions)

### 3. Camera → Camera COMP

- Narrow FOV (10°) → Camera COMP with FOV parameter
- Zoom-to-cursor math → Python script on Mouse In CHOP
- Pan → Python script translating camera target
- The `calculateZoomToCursor()` and `calculatePan()` functions are pure math — direct Python port

### 4. Force Simulation → Python or GLSL Compute

This is the most complex subsystem to port.

**D3-force keyword simulation:**
- Forces: link (spring), many-body (repulsion), center (attraction)
- ~200 lines of JS force config
- Options:
  a. **Python Script CHOP**: Port D3-force algorithm to Python, run per-frame
  b. **GLSL Compute shader**: GPU-based N-body simulation (faster for large graphs)
  c. **External process**: Run D3-force in Node.js, pipe positions to TD via OSC/WebSocket
  d. **Pre-compute**: Run simulation once, export positions as CSV, load into TD

**Content simulation (chunks around keywords):**
- Spring + repulsion forces, simpler than keyword sim
- Same options as above

**Recommendation**: For real-time interaction, option (a) Python is simplest. For performance with 1000+ nodes, option (b) GLSL compute. For quick prototype, option (d) pre-compute.

### 5. Label System → Text TOPs or Panel COMPs

This is the **hardest subsystem to port**. The current system:
- Creates/destroys DOM elements dynamically
- CSS styling with theme-aware colors, text shadows, font scaling
- Degree-based visibility filtering (only show high-degree keyword labels)
- Smooth opacity crossfade between keyword and content labels
- Hover preview with markdown rendering
- Cluster labels with semantic text from LLM

**TD approaches:**

a. **Text TOP per label** → Composite into render
   - Pro: Full text control
   - Con: Hundreds of Text TOPs = slow, no dynamic creation

b. **GLSL text rendering** (SDF fonts)
   - Pro: GPU-fast, unlimited labels
   - Con: Complex to implement, no markdown

c. **Panel COMP overlay**
   - Pro: HTML-like UI system, supports dynamic elements
   - Con: Not great for hundreds of labels, compositing overhead

d. **Texture atlas approach**
   - Pre-render all label texts to texture atlas
   - Instance textured quads at label positions
   - Pro: Very fast rendering
   - Con: No dynamic text, updates require re-baking

**Recommendation**: Hybrid — texture atlas for keyword/cluster labels (pre-baked when data changes), Panel COMP for hover preview and interactive elements.

### 6. Interaction → CHOPs + Python

| R3F Pattern | TD Equivalent |
|---|---|
| onPointerMove → cursor tracking | Mouse In CHOP → Math CHOP for world coords |
| instanceId click detection | Render Pick CHOP/DAT on geometry |
| Hover highlight (embedding similarity) | Python Script DAT computing similarities |
| RAF throttling | Execute DAT frame callback |
| React refs for shared state | Python class attributes or storage operators |

### 7. Data Backend → Python + Web DAT

- Supabase queries → Python `requests` or `supabase-py` library in Script DAT
- Embedding storage → Table DATs
- LLM calls for cluster labels → Python HTTP to Claude API
- Caching → File DAT or local SQLite

### 8. Zoom/Scale System → CHOPs

The zoom phase system (`calculateScales`, `normalizeZoom`, `ZoomPhaseConfig`) is pure math:
- Camera Z → normalized t value → scale/opacity values
- Direct port to Math CHOP chain or Python expression
- Drive instance scale and color alpha from these CHOPs

### 9. Color System → Python + CHOPs

- PCA-based semantic coloring → Python computing HSL from embeddings
- Cluster-based coloring → Lookup table DAT
- Search opacity → Multiply CHOP on color channels
- `chroma.js` color operations → Python `colorsys` or `colour` library

---

## Effort Estimate by Subsystem

| Subsystem | R3F Complexity | TD Difficulty | Notes |
|---|---|---|---|
| Keyword nodes (instanced circles) | Low | **Low** | Standard TD instancing |
| Content nodes (instanced rects) | Low | **Low** | Same pattern |
| Edge rendering (curved arcs) | Medium | **Medium** | Script SOP for arc math |
| Camera controls (zoom/pan) | Medium | **Medium** | Python on Mouse In CHOP |
| Force simulation (keywords) | High | **High** | Port D3-force to Python/GLSL |
| Content simulation (chunks) | Medium | **Medium** | Simpler force model |
| Label overlay system | Very High | **Very High** | No DOM equivalent in TD |
| Frosted glass panel | Low (drei) | **High** | No built-in transmission material |
| Hover/interaction | Medium | **Medium** | Render Pick + Python |
| Color system (PCA/cluster) | Medium | **Low-Medium** | Pure math, straightforward port |
| Zoom phase scaling | Low | **Low** | Pure math expressions |
| Filtering (click-to-drill) | High | **Medium** | Python state machine |
| Semantic zoom | High | **High** | Embedding math + hysteresis |
| Cluster labeling (Leiden + LLM) | High | **High** | Port Leiden algo + API calls |
| Data pipeline (Supabase) | Medium | **Medium** | Python HTTP/SQL |

### Rough Complexity Tiers

**Tier 1 — Straightforward ports (days)**
- Instanced geometry (keywords, content nodes)
- Camera with zoom/pan
- Zoom-dependent scaling and opacity
- Color computation
- Basic data loading from Supabase

**Tier 2 — Moderate effort (weeks)**
- Edge rendering with arc math
- Hover and click interaction
- Force simulation (Python port)
- Content node layout
- Filtering state machine
- Data backend integration

**Tier 3 — Significant challenges (weeks each)**
- Label overlay system (no DOM in TD)
- Frosted glass transmission effect
- Semantic zoom with embedding similarity
- Leiden clustering + LLM label generation
- Markdown content rendering in hover previews

---

## What You Gain in TouchDesigner

- **Real-time performance**: GPU-native instancing, compute shaders for simulation
- **Multi-output**: Easy projection mapping, LED wall output, multi-screen
- **Audio reactivity**: Direct CHOP integration with audio analysis
- **Timeline**: Keyframe animation, cue-based sequencing
- **GLSL access**: Custom shaders without the React/Three.js abstraction layer
- **OSC/MIDI**: Hardware controller integration for live performance
- **Video integration**: Texture from live video, NDI, Syphon

## What You Lose

- **React component model**: TD's UI paradigm is fundamentally different (no declarative rendering)
- **DOM text rendering**: HTML/CSS label system has no equivalent quality in TD
- **npm ecosystem**: No D3-force, chroma.js, Leiden clustering — must port or find alternatives
- **Hot reload dev experience**: TD has live coding but not the same iteration speed for logic
- **Type safety**: Python in TD is untyped
- **Web deployment**: TD outputs are desktop/installation only (unless using TD Web)

---

## Implementation Resources

**For detailed implementation planning, see:**
- **[IMPLEMENTATION_ROADMAP.md](IMPLEMENTATION_ROADMAP.md)** - Phase-by-phase porting guide with test-driven development approach
- **[reports/](reports/)** - Detailed agent analyses for each subsystem:
  - `01-force-simulation.md` - D3-force implementation (Python vs GLSL)
  - `02-label-system.md` - SDF text rendering and label overlay architecture
  - `03-edge-rendering.md` - Curved edge geometry with arc mathematics
  - `04-frosted-glass-effect.md` - Multi-pass rendering for transmission panel
  - `05-semantic-zoom-interaction.md` - Embedding similarity and hover system
  - `06-clustering-llm-labels.md` - Leiden clustering and LLM integration

---

## Recommended Porting Strategy

### Phase 1: Static Visualization (prove the concept)
1. Load keyword nodes + edges from CSV/JSON export
2. Pre-compute positions (run D3-force in Node.js, export)
3. Instanced circles for keywords, Line SOP for edges
4. Camera with FOV 10 degrees and basic zoom/pan
5. Static color from cluster assignments

### Phase 2: Interactive Core
1. Port force simulation to Python (or use pre-computed with perturbation)
2. Add Render Pick for click detection
3. Implement zoom-dependent scaling via CHOP expressions
4. Add basic text labels (Text TOP atlas approach)

### Phase 3: Visual Polish
1. Implement frosted glass effect (multi-pass blur)
2. Add content nodes with depth separation
3. Curved edge rendering
4. Label opacity crossfade

### Phase 4: Full Feature Parity
1. Port Leiden clustering to Python
2. Add LLM label generation (Python HTTP)
3. Implement semantic zoom
4. Click-to-filter state machine
5. Hover previews with content text

---

## Key Files Reference

### R3F Components (`src/components/topics-r3f/`)
- `R3FTopicsCanvas.tsx` — Canvas wrapper, DOM overlay bridge
- `R3FTopicsScene.tsx` — Scene coordinator
- `ForceSimulation.tsx` — D3-force driver
- `KeywordNodes.tsx` — Instanced circle rendering
- `ContentNodes.tsx` — Instanced rounded-rect rendering
- `KeywordEdges.tsx` / `ContentEdges.tsx` — Edge config wrappers
- `EdgeRenderer.tsx` — Merged arc line rendering
- `CameraController.tsx` — Zoom-to-cursor + pan
- `TransmissionPanel.tsx` — Frosted glass effect
- `LabelsOverlay.tsx` — DOM label positioning
- `LabelsUpdater.tsx` — Per-frame label driver

### Shared Libraries (`src/lib/`)
- `label-overlays.ts` — Label manager (1200+ lines, most complex)
- `topics-hover-controller.ts` — Hover/click interaction
- `topics-graph-nodes.ts` — Node/edge data conversion
- `content-layout.ts` — Content node force positioning
- `content-scale.ts` — Zoom-dependent scale interpolation
- `content-zoom-config.ts` — Zoom range constants
- `zoom-phase-config.ts` — Phase threshold configuration

### Hooks (`src/hooks/`)
- `useR3FTopicsRenderer.ts` — Renderer integration hook
- `useContentSimulation.ts` — D3-force for content spreading
- `useInstancedMeshMaterial.ts` — Material setup
- `useTopicsFilter.ts` — Multi-filter coordination
- `useSemanticZoom.ts` — Embedding-based visibility
- `useClusterLabels.ts` — Leiden + LLM labeling
