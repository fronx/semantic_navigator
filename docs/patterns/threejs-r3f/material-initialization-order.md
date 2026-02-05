# Material Initialization Order

**Problem**: Material shader compiles before `instanceColor` exists, resulting in black instances even with correct configuration.

**Root Cause**:
- When a material's shader compiles, it "bakes in" which attributes exist at that moment
- If `instanceColor` is added AFTER the material compiles, the shader doesn't include instance color support
- Calling `material.needsUpdate = true` triggers recompilation, but timing matters

**Solution**:
```typescript
// Use ref callback for synchronous initialization
const handleMeshRef = (mesh: THREE.InstancedMesh | null) => {
  if (mesh && !mesh.instanceColor) {
    // 1. Create instanceColor FIRST
    mesh.instanceColor = new THREE.InstancedBufferAttribute(colors, 3);
    mesh.instanceColor.needsUpdate = true;

    // 2. Dispose any default material R3F created
    if (mesh.material) {
      (mesh.material as THREE.Material).dispose();
    }

    // 3. Create and attach material AFTER instanceColor exists
    const material = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      depthTest: true,
      depthWrite: true,
    });
    mesh.material = material;

    // 4. Force shader recompilation with instanceColor support
    material.needsUpdate = true;
  }
};

// Use the callback, not a direct ref
<instancedMesh ref={handleMeshRef} args={[geometry, undefined, count]}>
```

**Key points**:
- Create `instanceColor` before creating the material
- Pass `undefined` for material in args (or omit it) so R3F doesn't create a default
- Use ref callback (not `useEffect`) for synchronous initialization before first render
- Always call `material.needsUpdate = true` after attaching instanceColor

**Related**: [InstancedMesh Colors](instanced-mesh-colors.md)
