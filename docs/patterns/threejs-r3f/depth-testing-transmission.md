# Depth Testing and Transmission Materials

**Problem**: Instanced meshes don't interact correctly with `MeshTransmissionMaterial` (frosted glass blur effect).

**Root Cause**:
- Transmission materials sample the depth buffer to determine what to blur
- If instanced meshes have `depthTest: false`, they don't write to depth buffer
- Result: transmission material can't "see" them to apply blur effect

**Solution**:
```typescript
const material = new THREE.MeshBasicMaterial({
  color: 0xffffff,
  transparent: false,    // Opaque objects should write depth
  depthTest: true,       // Enable depth testing
  depthWrite: true,      // Write to depth buffer
});
```

**When to disable depth testing**:
- Transparent overlays that should always render on top
- UI elements in 3D space
- Debug visualizations

**When to enable depth testing**:
- Any object that should interact with other 3D objects
- Objects that need proper occlusion
- Objects that transmission materials should blur/distort

**Visual verification**:
- With `depthTest: false`: Objects appear unaffected by transmission panel (no blur)
- With `depthTest: true`: Objects correctly blur when behind transmission panel
