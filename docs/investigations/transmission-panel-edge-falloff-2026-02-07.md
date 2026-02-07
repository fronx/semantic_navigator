# Investigation: Transmission Panel Edge Falloff

**Date**: 2026-02-07
**Status**: Abandoned — `onBeforeCompile` shader patching is unreliable

## Goal

Make the `MeshTransmissionMaterial` blur effect vary spatially: neutral (no blur) in the center of the viewport and increasingly distorted toward the edges, creating a vignette-style frosted glass effect.

## Approach 1: thicknessMap DataTexture

**Idea**: The drei `MeshTransmissionMaterial` shader already contains code to modulate thickness per-pixel via a `thicknessMap` texture:

```glsl
#ifdef USE_THICKNESSMAP
  material.thickness *= texture2D( thicknessMap, vUv ).g;
#endif
```

Create a `DataTexture` with a radial gradient (0 at center, 1 at edges) and pass it as the `thicknessMap` prop.

**Implementation**: Created a 128x128 `DataTexture` using `createRadialGradientTexture(falloff)` with smoothstep falloff and a 0.71 inner radius dead zone (~50% clear area). Passed to `<MeshTransmissionMaterial thicknessMap={texture} />`.

**Result**: No visible effect.

**Why it failed**: The `USE_THICKNESSMAP` shader define is never set. Three.js sets this define during shader compilation by checking `material.thicknessMap`. However, drei's `MeshTransmissionMaterialImpl` overrides the `thicknessMap` property setter via `Object.defineProperty` (to route to `this.uniforms.thicknessMap.value`), which bypasses Three.js's internal property handling that triggers the define. The `#ifdef USE_THICKNESSMAP` block in the shader is dead code — it's never compiled in.

Tried always passing the texture (even a white one at falloff=0) so the define would be present from first compilation. Still didn't work because Three.js's program parameter detection (`HAS_THICKNESSMAP = !!material.thicknessMap` in `WebGLPrograms.getParameters`) happens during compilation, and the custom getter/setter disconnects from Three.js's internal tracking.

## Approach 2: Shader patching via onBeforeCompile wrapper

**Idea**: Wrap drei's `onBeforeCompile` with our own code that replaces the constant `material.thickness = thickness;` line with UV-based modulation using a custom `edgeFalloff` uniform.

**Implementation**: In a `useEffect`, captured the material ref, wrapped the existing `onBeforeCompile`, injected a `uniform float edgeFalloff` declaration, and replaced:

```glsl
material.thickness = thickness;
```

with:

```glsl
{
  vec2 centeredUv = vUv - 0.5;
  float edgeDist = length(centeredUv) * 2.0;
  float innerR = 0.71;
  float remapped = clamp((edgeDist - innerR) / (1.0 - innerR), 0.0, 1.0);
  float edgeFac = remapped * remapped * (3.0 - 2.0 * remapped);
  material.thickness = thickness * mix(1.0, edgeFac, edgeFalloff);
}
```

Set `mat.defines.USE_UV = ''` to force UV varyings, `customProgramCacheKey` for unique program cache, and `needsUpdate = true` to trigger recompilation.

**Result**: No visible effect.

**Why it (likely) failed**: Two issues identified:

### Issue A: `thickness_smear` not modulated

The shader has TWO thickness contributions to the blur. In the sampling loop, each sample uses:

```glsl
material.thickness + thickness_smear * (i + randomCoords) / float(samples)
```

Where `thickness_smear` is computed from the raw uniform:

```glsl
float thickness_smear = thickness * max(pow(roughnessFactor, 0.33), anisotropicBlur);
```

We only modified `material.thickness` but `thickness_smear` still uses the full `thickness` uniform. With `anisotropicBlur = 5.0` (default), `thickness_smear` is large. So even with `material.thickness = 0` at the center, the samples range from `0` to `thickness * 5.0 * fraction`, which is still heavy blur.

**Fix needed**: Also replace the `thickness_smear` computation to use the modulated value:

```glsl
float thickness_smear = material.thickness * max(pow(roughnessFactor, 0.33), anisotropicBlur);
```

### Issue B: `String.replace` silently fails — patch never applied

Further testing confirmed the shader patch has **no effect at all**. Setting `material.thickness = 0;` (hardcoded zero, ignoring all uniforms) still showed full blur — proving the replacement string `'material.thickness = thickness;'` never matched in the compiled shader.

`String.replace()` returns the original string unchanged when the search string isn't found, with no error or warning. The string exists in drei's source code (line 252 of `MeshTransmissionMaterial.js`), but by the time `onBeforeCompile` runs, the actual shader string may differ due to:
- Template literal whitespace/indentation differences
- Three.js preprocessing or chunk injection altering the surrounding code
- The `onBeforeCompile` wrapper not being called (timing issue with `needsUpdate`)

No diagnostic logging was added to confirm which of these is the actual cause.

## Conclusion

The `onBeforeCompile` monkey-patching approach for drei's `MeshTransmissionMaterial` is fundamentally fragile:
- Silent failures from `String.replace` make debugging nearly impossible
- The approach depends on exact string matching against an internal shader that can change across drei versions
- Timing of `useEffect` vs Three.js shader compilation adds another failure mode
- Even if patching worked, TWO separate replacements are needed (thickness + thickness_smear), doubling the fragility

## Alternative Approaches (Not Yet Tried)

1. **Custom ShaderMaterial** — write a transmission-like material from scratch using `gl_FragCoord` for screen-space vignette, bypassing drei entirely
2. **Post-processing** — apply blur as a post-processing pass with a vignette mask (e.g., custom EffectComposer pass)
3. **Two-layer approach** — render the scene twice with different blur levels and blend based on screen position
4. **Fork MeshTransmissionMaterial** — copy drei's implementation and modify the shader source directly instead of patching

## Files Modified

- `src/components/topics-r3f/TransmissionPanel.tsx` — core change
- `src/hooks/useTopicsSettings.ts` — `panelEdgeFalloff` setting
- `src/components/ControlSidebar.tsx` — "Edge falloff" slider
- `src/components/TopicsView.tsx` — prop threading
- `src/components/topics-r3f/R3FTopicsCanvas.tsx` — prop threading
- `src/components/topics-r3f/R3FTopicsScene.tsx` — prop threading
- `src/app/topics/page.tsx` — prop threading

## Key Insight

drei's `MeshTransmissionMaterial` has two independent thickness contributions to the blur effect:
1. `material.thickness` — base refraction offset
2. `thickness_smear` — computed from the raw `thickness` uniform × `anisotropicBlur`, spread across samples

Any per-pixel thickness modulation must affect BOTH to produce a visible difference. Modifying only `material.thickness` while leaving `thickness_smear` at full strength results in imperceptible change because the smear dominates the visual blur.
