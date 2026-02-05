# Three.js & React Three Fiber Patterns

Hard-won insights and best practices for working with Three.js and R3F in this codebase.

## Core Patterns

### [InstancedMesh Colors](instanced-mesh-colors.md)
**Don't use `vertexColors: true` with instanced meshes.** Instanced colors come from `instanceColor`, not per-vertex colors. Using `vertexColors` without vertex data causes black rendering.

**Quick fix**: Use `color: 0xffffff` as base + `instanceColor` buffer, no `vertexColors` flag.

### [Material Initialization Order](material-initialization-order.md)
**Create `instanceColor` before material.** When the shader compiles, it bakes in which attributes exist. Adding `instanceColor` after compilation requires `material.needsUpdate = true` and correct timing.

**Quick fix**: Use ref callback, create `instanceColor` first, then create and attach material.

### [Depth Testing and Transmission](depth-testing-transmission.md)
**Enable depth writes for transmission effects.** `MeshTransmissionMaterial` (frosted glass) samples the depth buffer. Objects with `depthTest: false` won't interact with transmission effects.

**Quick fix**: Set `depthTest: true` and `depthWrite: true` for opaque objects.

### [Dynamic Buffer Updates](dynamic-buffer-updates.md)
**Always set `needsUpdate = true` after updating buffers.** `setMatrixAt()` and `setColorAt()` only update CPU-side arrays. GPU needs explicit notification via `needsUpdate` flag.

**Quick fix**: After updating instances, set `mesh.instanceMatrix.needsUpdate = true` and `mesh.instanceColor.needsUpdate = true`.

### [Event System](event-system.md)
**Custom DOM handlers can coexist with R3F events.** When using custom `addEventListener` on canvas (for pan/zoom), R3F's onClick/onPointerOver still work if meshes have materials.

**Open question**: Best practice for `eventSource` with custom handlers remains under investigation.

---

## Contributing

As we encounter more Three.js/R3F challenges, document them here:

1. Create a new `.md` file in this directory
2. Follow the pattern: Problem → Root Cause → Solution → Examples
3. Add entry to this index with brief description
4. Link to related investigations when applicable

**Pattern template**:
```markdown
# Pattern Name

**Problem**: One-line description of the issue

**Root Cause**: Why this happens

**Solution**: Code example showing correct approach

**Key points**: Bullet list of important takeaways
```
