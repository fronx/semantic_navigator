# TouchDesigner Label Overlay System Implementation Analysis

## Current System Overview

The React/R3F implementation manages **three types of labels** with complex rendering requirements:

### 1. Keyword Labels (Hundreds of labels)
- **Positioning**: Right of node dot with offset
- **Visibility**: Degree-based filtering (zoom-dependent threshold)
- **Styling**: Base font 42px, zoom scaling, theme-aware glow, hover scaling 1.5x
- **Interactivity**: Click handlers, hover detection
- **Performance**: Change detection to prevent flickering

### 2. Chunk/Content Labels (Potentially thousands)
- **Positioning**: Exact fit inside square bounds with padding
- **Content**: Full markdown rendering via React portals
- **Visibility**: Minimum screen size threshold (50px)
- **Styling**: Dynamic font sizing, markdown support, word wrapping
- **Complexity**: Non-unique IDs require composite keys

### 3. Cluster Labels (10-50 labels)
- **Positioning**: Centered at cluster centroid
- **Content**: LLM-generated semantic text
- **Styling**: 18px bold, multi-line, opacity based on visibility ratio
- **Interactivity**: Click-to-filter

### 4. Hover Previews
- **Positioning**: Above hovered chunk node
- **Content**: Full paragraph text
- **Styling**: Frosted glass card with shadows

## TouchDesigner Implementation Approaches

### 1. Text TOP per Label ❌ NOT RECOMMENDED
- **Ceiling**: ~50-100 Text TOPs before severe slowdown
- **Verdict**: Unsuitable for hundreds of labels

### 2. GLSL SDF Text Rendering ✅ RECOMMENDED FOR KEYWORD/CLUSTER LABELS

**How It Works:**
1. Pre-generate SDF font atlas using msdfgen
2. Instance geometry for each label character
3. GLSL shader samples SDF texture for crisp edges at any scale

**Advantages:**
- Unlimited scaling with perfect quality
- GPU-accelerated, minimal CPU overhead
- Thousands of characters with low draw call count
- Memory efficient (single atlas texture)

**Challenges:**
- Glow effects require custom distance field manipulation
- Multi-line layout needs manual line breaking
- Dynamic text updates require rebuilding instance attributes

**Performance Estimate:** 1000+ labels at 60fps

### 3. Panel COMP Overlay ⚠️ LIMITED USE CASE
- **Performance ceiling**: ~100-200 Panel COMPs
- **Best Use Case**: Hover previews only (single preview at a time)

### 4. Texture Atlas + Instancing ✅ RECOMMENDED FOR CHUNK LABELS

**How It Works:**
1. Pre-render labels using Text TOPs
2. Pack into atlas via Layout TOP
3. Instance quads with UV coordinates pointing to atlas regions
4. Rebuild atlas when text content changes

**Performance Estimate:** 500-1000 labels at 60fps

### 5. Hybrid Recommendation ✅ OPTIMAL SOLUTION

**Tier 1: Keyword Labels** - Use SDF Text Rendering
- Most frequent updates
- Simple single-line text
- Needs perfect scaling and glow effects

**Tier 2: Cluster Labels** - Use SDF Text Rendering
- Multi-line text
- LLM-generated semantic labels

**Tier 3: Chunk Content Labels** - Use Texture Atlas + Instancing
- Full paragraph text with wrapping
- Infrequent text updates
- High label count

**Tier 4: Hover Previews** - Use Panel COMP or Web Render TOP
- Single preview at a time
- Rich formatting desired

### 6. 3D→2D Projection in TouchDesigner

**Shader Approach (Vertex Shader):**
```glsl
vec4 worldPos = TDDeform(P);
vec4 projPos = TDWorldToProj(worldPos);
```

**Python Script Approach:**
```python
def worldToScreen(worldPos, camera, renderResolution):
    viewMatrix = camera.worldTransform.inverse()
    projMatrix = camera.projectionMatrix
    viewPos = viewMatrix * worldPos
    projPos = projMatrix * viewPos
    ndcPos = projPos.xyz / projPos.w
    screenX = (ndcPos.x + 1) * 0.5 * renderResolution[0]
    screenY = (1 - ndcPos.y) * 0.5 * renderResolution[1]
    return (screenX, screenY)
```

### 7. Markdown Rendering Options

**Option A: Web Render TOP** ⚠️ Heavy but Full-Featured
- Full markdown support via Chromium
- Performance cost: Separate browser process
- Use case: Hover previews only

**Option B: Custom Formatting** ✅ Recommended for Chunk Labels
- Parse markdown manually, apply basic formatting
- Bold, italic, code, headings support
- Medium complexity

**Option C: Plain Text Only** ✅ MVP Approach
- Skip markdown initially
- Focus on core system working first

## Performance Benchmarks & Estimates

| Approach | Max Labels | Frame Rate | GPU Load | CPU Load | Memory |
|----------|-----------|-----------|----------|----------|--------|
| Text TOP per label | 50-100 | <30fps | Low | **High** | Low |
| SDF + Instancing | 1000+ | 60fps | Medium | Low | Medium |
| Texture Atlas | 500-1000 | 60fps | Medium | Low | High |
| Panel COMP | 100-200 | 30-60fps | Low | **High** | Low |
| Hybrid (recommended) | 2000+ | 60fps | Medium | Low | Medium |

## Implementation Roadmap

### Phase 1: Core Infrastructure (Week 1)
1. SDF Font Generation
2. Projection System

### Phase 2: Keyword Labels (Week 2)
1. Data Pipeline
2. Visibility & Styling
3. Interactivity

### Phase 3: Cluster Labels (Week 2-3)
1. Reuse keyword pipeline with modifications
2. LLM Integration

### Phase 4: Chunk Labels (Week 3-4)
1. Atlas Generation
2. Instancing
3. Dynamic Updates

### Phase 5: Hover Previews (Week 4)
1. Panel COMP or Web Render TOP approach

### Phase 6: Polish & Optimization (Week 5)
1. Performance profiling
2. Visual refinement
3. Markdown support (if time permits)

## Risk Assessment

### High Risk
- SDF shader complexity
- Atlas memory limits
- Projection accuracy

### Medium Risk
- Markdown rendering performance
- Instancing overhead
- Text layout logic

### Low Risk
- Panel COMP performance
- CHOP data flow
- SDF font quality
