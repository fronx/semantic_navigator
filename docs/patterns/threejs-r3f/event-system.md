# R3F Event System with Custom DOM Handlers

**Problem**: Custom DOM event handlers (like pan/zoom) can interfere with R3F's raycasting system.

**Known issue**: If you have custom `mousedown`/`mousemove`/`wheel` handlers attached directly to the canvas via `addEventListener`, R3F's onClick/onPointerOver may not fire on meshes.

**Attempted solution** (doesn't work with custom DOM handlers):
```typescript
// ❌ This breaks custom wheel/pan handlers
<Canvas
  eventSource={document.getElementById('container')}
  eventPrefix="client"
>
```

**Why it fails**:
- Custom handlers are attached to canvas element
- `eventSource` moves R3F event listening to container element
- Wheel/pan handlers on canvas never receive events (preventDefault never called)
- Browser default behavior (scrolling) takes over

**Current working approach**:
- Add material to instancedMesh (enables raycasting)
- Keep default R3F event configuration
- Custom DOM handlers coexist with R3F events on the same canvas

**Example**:
```typescript
// Custom DOM handlers
useEffect(() => {
  canvas.addEventListener('wheel', handleWheel, { passive: false });
  canvas.addEventListener('mousedown', handleMouseDown);
  // ... cleanup
}, []);

// R3F events on mesh
<instancedMesh
  onClick={(e) => console.log('clicked', e.instanceId)}
  onPointerOver={() => document.body.style.cursor = 'pointer'}
>
```

**Open questions**:
- What's the best practice for combining R3F events with custom DOM handlers?
- Is there a way to use `eventSource` while preserving custom handlers?
- Should custom handlers use `stopPropagation()` or `stopImmediatePropagation()`?

This remains an active area of investigation.
