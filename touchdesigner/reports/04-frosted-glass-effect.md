# TouchDesigner Frosted Glass Transmission Panel Implementation Analysis

## Current R3F Implementation Details

The React Three Fiber implementation uses:
- **MeshTransmissionMaterial** from drei with transmission=0.97
- **16 samples** for blur quality
- **1024 resolution** buffer when thickness > 0
- **thickness parameter** (0-20) controls blur strength
- **anisotropicBlur=5.0** for directional blur
- **Dynamic positioning** at `camera.z * distanceRatio` between layers
- **Viewport-sized plane** that follows camera

## TouchDesigner Implementation Approaches

### 1. Multi-Pass Render Approach (RECOMMENDED)

Most direct translation with best quality-performance balance.

**Pipeline:**
```
Background Layer (chunks) → Render TOP 1 → Depth TOP
                                           ↓
                                      Blur TOP (Gaussian, 16px)
                                           ↓
Frosted Panel Geometry ←────────── Composite TOP
                                           ↓
Foreground Layer (keywords) → Render TOP 2 → Final Composite
```

**Implementation Steps:**

1. **Render Background to Texture**
   - Use Render TOP to capture chunk layer (z=-150)
   - Enable depth buffer output
   - Resolution: 1024x1024 matches R3F

2. **Apply Blur**
   - Blur TOP with Gaussian filter, Filter Size=16
   - Use Pre-Shrink for performance (2-3x improvement)

3. **Project onto Panel Geometry**
   - Plane at z=-75 between layers
   - Apply blurred texture via Constant MAT or PBR MAT
   - UV coordinates for screen-space projection

4. **Composite with Foreground**
   - Second Render TOP for keyword layer
   - Composite TOP to blend panel + keywords
   - Alpha blending (transmission=0.97 → ~3% opacity)

**Performance Optimization:**
- Pre-Shrink to 50% resolution before blur: 2-3x speedup
- Cache background when camera/chunks static
- Reduce blur texture to 512x512 for real-time

### 2. Custom GLSL MAT Approach

For more control and potentially better performance.

**Shader Logic:**
```glsl
uniform sampler2D backgroundTex;
uniform float thickness;

void main() {
    vec2 screenUV = gl_FragCoord.xy / resolution.xy;
    vec3 normal = normalize(vNormal);
    vec2 offset = normal.xy * (thickness * 0.005);

    // Multiple offset samples for blur (approximates 16 samples)
    vec4 color = vec4(0.0);
    float kernel[5] = float[](0.06, 0.24, 0.40, 0.24, 0.06);

    for (int x = -2; x <= 2; x++) {
        for (int y = -2; y <= 2; y++) {
            vec2 sampleUV = screenUV + offset + vec2(x, y) * 0.002;
            float weight = kernel[x+2] * kernel[y+2];
            color += texture(backgroundTex, sampleUV) * weight;
        }
    }

    fragColor = vec4(color.rgb, 0.97);
}
```

**Advantages:**
- Single-pass rendering
- More flexible control over distortion
- Can add chromatic aberration

**Challenges:**
- Requires GLSL shader knowledge
- Harder to debug
- Screen-space texture coordinate handling

### 3. PBR MAT with Transmission (LIMITED SUPPORT)

TouchDesigner's PBR MAT has some transmission parameters but not true screen-space refraction like MeshTransmissionMaterial.

**Limitations:**
- Does NOT support screen-space background blur
- Refraction is ray-traced, not screen-space
- No built-in blur/sampling control
- Performance varies

**When to Use:**
- Basic glass appearance without frosted blur
- Physically-accurate refraction at cost of performance

### 4. Depth-Based Selective Blur Approach

Use depth information for selective blur based on layer position.

**Advantages:**
- Doesn't require separate render passes
- Automatic depth sorting

**Challenges:**
- More complex setup
- Precise depth mask creation required
- May have edge artifacts

## Performance Considerations

### Blur Quality vs Frame Rate

| Approach | Resolution | Blur Samples | Typical FPS | Quality |
|----------|-----------|--------------|-------------|---------|
| Multi-pass (full res) | 1920x1080 | 16px Gaussian | 30-45 | Excellent |
| Multi-pass (pre-shrink) | 960x540 → blur → upscale | 16px | 55-70 | Very Good |
| GLSL shader (optimized) | 1920x1080 | 5x5 kernel | 50-80 | Good |
| Depth-based | 1920x1080 | Luma-controlled | 35-50 | Very Good |

**Optimization Strategies:**
1. Resolution scaling (50% before blur)
2. Conditional rendering (cache when static)
3. Adaptive quality (reduce during camera movement)
4. GPU optimization (keep pipeline on GPU)

## Recommended Implementation Path

### Phase 1 - Basic Setup
- Separate layers into Render TOPs
- Apply Blur TOP to chunk layer
- Composite blurred background with keywords

### Phase 2 - Panel Integration
- Create plane geometry at z=-75
- Apply blurred texture via Constant MAT
- Add transparency (alpha=0.97)

### Phase 3 - Dynamic Control
- Add thickness slider controlling blur strength
- Implement distanceRatio for panel positioning
- Make blur intensity respond to thickness

### Phase 4 - Optimization
- Add Pre-Shrink to Blur TOP
- Implement caching for static scenes
- Test and tune resolution/quality trade-offs

### Phase 5 - Enhancement (Optional)
- Migrate to GLSL MAT for custom effects
- Add chromatic aberration
- Implement anisotropic blur direction

## Alternative Aesthetic Approximations

If full blur is too performance-intensive:

1. **Frosted Texture Overlay** - Noise texture with transparency
2. **Dithered Transparency** - Checkerboard pattern
3. **Depth Fade** - Alpha gradient based on depth
4. **Post-Process Bloom** - Bloom TOP creates soft glow

## Summary

**Best approach:** Multi-pass render with Blur TOP offers closest match to R3F with good performance. Start simple, optimize iteratively, only move to custom GLSL if needed.

**Key differences from R3F:**
- R3F's MeshTransmissionMaterial handles blur internally
- TouchDesigner requires explicit multi-pass pipeline
- More manual control but also more optimization opportunities
- Can achieve same visual quality with proper setup
