# InstancedMesh Color Configuration

**Problem**: Using `vertexColors: true` with `InstancedMesh` causes all instances to render black.

**Root Cause**:
- Instanced colors come from the `instanceColor` buffer attribute, NOT from per-vertex colors
- When `vertexColors: true` is enabled without actual per-vertex color data, Three.js defaults vertex colors to black `vec3(0,0,0)`
- This black color multiplies with the instance color in the shader, resulting in black fragments

**Solution**:
```typescript
// ❌ WRONG - causes black dots
const material = new THREE.MeshBasicMaterial({
  vertexColors: true,  // Don't use this with instanced meshes!
  transparent: true,
});

// ✅ CORRECT - use base color + instanceColor
const material = new THREE.MeshBasicMaterial({
  color: 0xffffff,      // Base white color
  transparent: false,
  depthTest: true,
  depthWrite: true,
});
material.toneMapped = false;

// Set per-instance colors via instanceColor buffer
mesh.instanceColor = new THREE.InstancedBufferAttribute(colors, 3);
mesh.instanceColor.needsUpdate = true;
```

**Why this works**:
- The base white color (`0xffffff`) acts as a neutral multiplier
- The `instanceColor` buffer modulates the base color per instance
- No `vertexColors` flag means no black vertex color multiplication

**When to use each approach**:
- **`vertexColors: true`**: Only for regular (non-instanced) meshes with per-vertex color data in geometry
- **`instanceColor`**: For `InstancedMesh` with per-instance colors
- **Base `color` + `instanceColor`**: The standard pattern for colored instanced meshes

**Related Investigation**: [Keyword Material Double Bind](../../investigations/keyword-material-double-bind.md)
