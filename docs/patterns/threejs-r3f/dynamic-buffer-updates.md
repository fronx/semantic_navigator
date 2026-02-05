# Dynamic InstancedBufferAttribute Updates

**Problem**: Updating `instanceColor` or `instanceMatrix` every frame without proper flags causes outdated rendering.

**Solution**:
```typescript
useFrame(() => {
  const mesh = meshRef.current;
  if (!mesh) return;

  // Update instance transforms
  for (let i = 0; i < count; i++) {
    // ... compute position, rotation, scale ...
    mesh.setMatrixAt(i, matrix);

    // ... compute color ...
    mesh.setColorAt(i, color);
  }

  // CRITICAL: Mark buffers as needing GPU upload
  mesh.instanceMatrix.needsUpdate = true;
  if (mesh.instanceColor) {
    mesh.instanceColor.needsUpdate = true;
  }
});
```

**Performance tip**:
```typescript
// Set usage hint for frequently updated buffers
mesh.instanceColor.setUsage(THREE.DynamicDrawUsage);
mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
```

**Common mistakes**:
- Forgetting `needsUpdate = true` (GPU never sees changes)
- Setting `needsUpdate` before the loop instead of after (wrong frame timing)
- Not checking if `instanceColor` exists before accessing it

**Why `needsUpdate` is required**:
- `setMatrixAt()` and `setColorAt()` only update CPU-side typed arrays
- Three.js doesn't automatically detect changes to these arrays
- `needsUpdate = true` tells Three.js to upload data to GPU on next render
- Without it, GPU continues using stale data

**Buffer usage patterns**:
- `StaticDrawUsage`: Data set once, never changes (default)
- `DynamicDrawUsage`: Data changes frequently (every frame or often)
- `StreamDrawUsage`: Data changes every single frame and is used once

For animated instanced meshes, use `DynamicDrawUsage` to hint to the GPU that frequent updates are expected.
