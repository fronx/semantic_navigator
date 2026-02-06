# TouchDesigner D3-Force Simulation Implementation Analysis

## 1. Current D3-Force Configuration

### Keyword Simulation (Main Graph)

**Forces Applied:**
- **forceLink**: Spring force between similar keywords
  - Distance: `40 + (1 - similarity) * 150` (40-190 units, inversely proportional to similarity)
  - Strength: `0.2 + similarity * 0.8` (0.2-1.0, proportional to similarity)
  - Highly similar keywords pull strongly and sit close together

- **forceManyBody**: Repulsion force between all keywords
  - Strength: `-200` (negative = repulsion)
  - Creates natural spacing, prevents overlap

- **forceCenter**: Gentle pull toward origin (0, 0)
  - Keeps graph from drifting away

**Simulation Parameters:**
- `alphaDecay`: 0.01 (how quickly simulation "cools down")
- `velocityDecay`: 0.5-0.9 (zoom-dependent damping)
- `alpha`: 0.01-0.30 (zoom-dependent energy level)
- Initial alpha: 0.3, velocity decay: 0.5
- Safety timeout: 20 seconds

**Zoom-Dependent Energy:**
- Zoomed OUT (Z=20000): Full energy (alpha=0.30, velocityDecay=0.5)
- Zoomed IN (Z=1800): Halted (alpha=0.01, velocityDecay=0.9)
- Smooth power curve (exponent 0.65) between states

### Content Simulation (LOD Chunks)

**Forces Applied:**
- **forceCollide**: Collision detection between all content nodes
  - Radius: `BASE_DOT_RADIUS * DOT_SCALE_FACTOR * contentSizeMultiplier * 1.2`
  - Strength: 0.8
  - Iterations: 2 (better collision resolution)

- **tetherToParent**: Custom force with two components:
  - **Spring**: Pulls content toward parent keyword (strength: 0.1)
  - **Max distance constraint**: Hard limit based on sibling count
    - Base: `keywordRadius * 2.5`
    - Dynamic expansion: `+ sqrt(contentCount) * contentRadius * 1.5`
    - Prevents content from drifting too far

**Simulation Parameters:**
- `alphaDecay`: 0.02 (slower cooling than keyword sim)
- `velocityDecay`: 0.3 (higher damping for stability)
- Manual tick via `useFrame` (not auto-running)

**Key Insight:** Two separate simulations - keywords run continuously, content nodes run per-frame with tethering constraints.

## 2. Python Script CHOP Approach

### Architecture Overview

```
[Data Tables (DATs)] → [Python Script CHOP] → [Position CHOPs] → [Instance TOP]
                              ↑                                          ↓
                              └────────────[Feedback Loop]───────────────┘
```

### Data Flow

1. **Input CHOPs:**
   - `position_x`, `position_y` - current node positions (N samples)
   - `velocity_x`, `velocity_y` - current velocities (N samples)
   - `edges_table` - DAT with source/target/similarity rows
   - `params` - control CHOPs (alpha, velocityDecay, forces)

2. **Python Script CHOP Processing:**
   - Reads positions/velocities as numpy arrays
   - Calculates forces for each node
   - Updates velocities and positions
   - Outputs new position/velocity CHOPs

3. **Feedback Loop:**
   - New positions feed back into next frame's input
   - Delay CHOP ensures stable single-frame delay

### Python Implementation Skeleton

See full implementation in report.

### Pros & Cons

**Pros:**
- Full Python control, easy to debug
- Direct port from D3 JavaScript logic
- Can log state, visualize intermediate steps
- NumPy acceleration for array operations

**Cons:**
- N² repulsion is CPU-bound (slow beyond ~500 nodes)
- Python GIL limits parallelization
- Feedback loop introduces 1-frame latency
- No GPU acceleration

## 3. GLSL Compute Approach

For maximum performance with 10,000+ edges, implement arc rendering entirely on GPU. See full shader code in report.

### Pros & Cons

**Pros:**
- Massively parallel (1 thread per node)
- Can handle 10k-100k+ nodes at 60fps
- GPU memory bandwidth >> CPU
- No Python GIL bottleneck

**Cons:**
- N² complexity still exists (just faster)
- Complex shader code, harder to debug
- Sparse edge storage tricky (need clever encoding)
- Requires compute shader support (GLSL 4.3+)

## 4. Data Flow: Simulation → Instance Transforms

### Python Script CHOP Path

```
Script CHOP (pos_x, pos_y channels)
    ↓
CHOP to DAT (table with x, y columns)
    ↓
DAT to SOP (Add SOP or Point SOP)
    ↓
Geometry COMP (instance reference)
    ↓
Instance geometry on points with transform from point attributes
```

## 5. Performance Considerations

### Python Script CHOP

| Node Count | Performance | Notes |
|------------|-------------|-------|
| < 100 | 60 fps | Smooth, CPU has headroom |
| 100-500 | 30-60 fps | Depends on edges, may drop frames |
| 500-1000 | 15-30 fps | Noticeable lag, needs optimization |
| > 1000 | < 15 fps | Impractical, consider GLSL |

**Bottleneck:** N² many-body force calculation in Python loop.

### GLSL Compute

| Node Count | Performance | Notes |
|------------|-------------|-------|
| < 1000 | 60 fps | Overkill, but works great |
| 1000-10k | 60 fps | GPU handles well, check memory |
| 10k-50k | 30-60 fps | May need Barnes-Hut approximation |
| > 100k | < 15 fps | Need clustered LOD, spatial hashing |

## 6. Recommendations

**For rapid prototyping (< 500 nodes):**
- Use **Python Script CHOP** approach
- Easy to debug, port D3 logic directly
- Acceptable performance for initial testing

**For production (> 500 nodes):**
- Use **GLSL Compute** approach
- Add spatial hashing or Barnes-Hut quadtree
- Leverage GPU instancing for rendering

**Hybrid approach:**
- Run keyword simulation on GPU (GLSL)
- Run content tethering on CPU (Python) - fewer nodes, more complex constraints
- Best of both worlds: GPU for heavy lifting, CPU for custom logic

**Critical optimization:** For graphs > 1000 nodes, you MUST implement spatial acceleration (quadtree, grid hashing, or cutoff radius) or the N² complexity will kill performance regardless of GPU vs CPU.
