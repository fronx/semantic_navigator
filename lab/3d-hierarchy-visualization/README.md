# 3D Hierarchy Visualization: Literature Review

A survey of prior art for visualizing hierarchical information using depth, blur, and force-directed layouts. Compiled January 2026.

## Core Concept

The idea: represent semantic hierarchy (clusters → articles → chunks) as spatial depth, where abstract summaries live at the "surface" and detailed content exists in deeper layers. Navigation into the space reveals progressively more detail, with depth-of-field blur indicating what's currently in focus.

---

## Foundational Research

### Cone Trees (1991)

**Robertson, Mackinlay, Card - Xerox PARC**

The foundational work on using z-depth for hierarchy visualization. Hierarchies are presented in 3D with the root at the apex of a cone and children arranged around the circular base below.

![Cone tree in virtual room with shadow](images/cone%20trees%202.png)
*The "virtual room" metaphor: hierarchy hangs from ceiling, shadow provides grounding*

![Cone tree before and after selection](images/cone%20trees.png)
*Rotation animation on node selection brings children into view*

Key insights:
- 3D layout uses depth to fit more information on screen than 2D trees
- Animation helps users track changes and understand structure (reduces cognitive load)
- The "room" metaphor (hierarchy hanging from ceiling) provides spatial grounding

Limitations noted:
- Occlusion problems when trees are dense
- Navigation can be disorienting

**References:**
- [Cone Trees: Animated 3D Visualizations of Hierarchical Information](https://www.researchgate.net/publication/221515543_Cone_Trees_Animated_3D_Visualizations_of_Hierarchical_Information) (ResearchGate PDF)
- [ACM Digital Library](https://dl.acm.org/doi/10.1145/108844.108883)
- [InfoVis Wiki: Cone Trees](https://infovis-wiki.net/wiki/Cone_Trees)

---

### Semantic Depth of Field (2001)

**Kosara, Miksch, Hauser - TU Wien**

Uses photographic depth-of-field blur as a focus+context technique for information visualization. Objects are blurred based on *relevance*, not just spatial distance.

Key insights:
- Blur is a **preattentive feature** - perceived within 200ms without serial search
- Sharp objects immediately attract gaze (well-established in photography/cinematography)
- Can be applied independent of spatial position (semantic rather than geometric)
- Effective for guiding attention in complex visualizations

The technique "utilizes a well-known method from photography and cinematography (depth-of-field effect) for information visualization, which blurs different parts of the depicted scene in dependence of their relevance."

**References:**
- [Semantic Depth of Field - Kosara's page](https://kosara.net/publications/Kosara-InfoVis-2001)
- [PhD Thesis: Using Blur for Focus+Context Visualization](https://kosara.net/papers/RobertKosaraPhD.pdf) (PDF)
- [TU Wien Research Publication](https://www.cg.tuwien.ac.at/research/publications/2001/Kosara-thesis/)

---

### Level of Detail (LOD)

**General concept from computer graphics/gaming**

The principle of showing simplified representations at distance and detailed versions up close. Originally a performance optimization, but applicable as a semantic concept.

Key principles:
- LOD0 = highest detail (close), LOD1/2/3 = progressively simplified (far)
- Reduces ~50% polygons per level as rule of thumb
- Can be discrete (swap models) or continuous (smooth transitions)
- View-dependent LOD varies detail based on screen space occupied

Relevance to semantic visualization:
- Chunk text → article summary → cluster label as "levels of detail"
- Distance from camera determines which semantic level is readable

**References:**
- [Wikipedia: Level of Detail](https://en.wikipedia.org/wiki/Level_of_detail_(computer_graphics))
- [Unity Manual: Introduction to LOD](https://docs.unity3d.com/Manual/LevelOfDetail.html)

---

## 3D Force-Directed Graph Libraries

### 3d-force-graph (vasturiano)

The primary JavaScript library for 3D force-directed graphs. Built on Three.js/WebGL with d3-force-3d or ngraph physics engines.

**Key features for hierarchical visualization:**

| Feature | Description |
|---------|-------------|
| `dagMode` | Constrains one axis to hierarchy levels (`td`, `bu`, `lr`, `rl`, `zout`, `zin`, `radialout`, `radialin`) |
| `dagLevelDistance` | Spacing between hierarchy levels |
| `dagNodeFilter` | Exclude nodes from DAG constraints (leave free-floating) |
| `numDimensions` | Can be 1, 2, or 3 |
| `d3Force` | Add/reconfigure custom forces |
| Camera controls | trackball, orbit, fly modes with animated transitions |

The `dagMode` feature is particularly relevant - it fixes one axis to hierarchy depth while allowing force-directed layout on the other two axes.

**References:**
- [GitHub: 3d-force-graph](https://github.com/vasturiano/3d-force-graph)
- [Live Examples](https://vasturiano.github.io/3d-force-graph/)
- [npm: 3d-force-graph](https://www.npmjs.com/package/3d-force-graph)

### Related Libraries

- [d3-force-3d](https://github.com/vasturiano/d3-force-3d) - The underlying physics engine, extends d3-force to 3D
- [three-forcegraph](https://github.com/vasturiano/three-forcegraph) - Lower-level Three.js integration
- [react-force-graph](https://github.com/vasturiano/react-force-graph) - React bindings for 2D, 3D, VR, and AR variants

---

## Three.js Depth-of-Field

Three.js provides post-processing effects for depth-of-field blur.

**DepthOfFieldNode** (modern TSL approach):
```javascript
import { dof } from 'three/addons/tsl/display/DepthOfFieldNode.js';
```

Parameters:
- `focus` - distance along camera's look direction (world units)
- `blurRange` - distance from focal plane before fully out-of-focus
- `bokehScale` - artistic adjustment for bokeh size

**References:**
- [Three.js DOF Example](https://threejs.org/examples/webgl_postprocessing_dof2.html)
- [DepthOfFieldNode Docs](https://threejs.org/docs/pages/DepthOfFieldNode.html)
- [React Three Fiber: DepthOfField](https://docs.pmnd.rs/react-postprocessing/effects/depth-of-field)

---

## Academic Research on 3D Graph Visualization

### Clustering-based Force-Directed Algorithms for 3D (2020)

**Lu, J., Si, Y.W. - Journal of Supercomputing**

Proposes four novel clustering-based force-directed (CFD) algorithms for 3D graph visualization. Addresses the challenge of scaling force-directed layouts to large graphs.

Key contribution: Using clustering to divide large graphs into smaller subgraphs that can be processed more efficiently, then combining results.

**Reference:**
- [Springer: Clustering-based force-directed algorithms](https://link.springer.com/article/10.1007/s11227-020-03226-w)

---

## 2.5D Alternative Approaches

Rather than true 3D, depth perception can be simulated in 2D using:

1. **Scale as depth proxy** - Further objects rendered smaller
2. **Opacity gradient** - Further objects more transparent
3. **CSS blur filter** - `filter: blur(Npx)` increases with conceptual depth
4. **Parallax on pan** - Deeper layers move slower during navigation
5. **Z-index layering** - Simple painter's algorithm for draw order

**Advantages over true 3D:**
- Simpler camera model (pan/zoom only, not 6DOF)
- No WebGL dependency (CSS/Canvas sufficient)
- Less risk of user disorientation
- Existing 2D force layouts (d3-force) remain usable

**Disadvantage:**
- No true "fly into" spatial navigation
- Limited perspective/foreshortening effects

---

## Synthesis: Unexplored Territory

The specific combination we discussed appears novel:

> Fixed z-axis stratigraphy with force-directed x,y per layer, parent-influenced child positioning, and semantic depth-of-field

Each component exists in literature, but the unified system combining:
- Hierarchy depth → z-position
- Force-directed layout within each z-layer
- Parent x,y position influencing child x,y (cross-layer attraction)
- DOF blur based on camera focal distance
- Semantic LOD (labels → summaries → full content)

...does not appear to have been formally studied as a combined technique.

---

## Further Reading

- [Force-directed graph drawing - Wikipedia](https://en.wikipedia.org/wiki/Force-directed_graph_drawing)
- [Hierarchical Drawing Algorithms (Brown CS)](https://cs.brown.edu/people/rtamassi/gdhandbook/chapters/hierarchical.pdf) (PDF)
- [Using blur to affect perceived distance and size - ACM](https://dl.acm.org/doi/10.1145/1731047.1731057)
