# Design: Decouple Focus and Selection in ChunksView

Date: 2026-02-19

## Problem

In ChunksView focus mode, clicking any node does two things simultaneously: opens the Reader (selection) and re-centers the lens (focus). This makes it hard to explore a neighborhood — every read displaces the lens, pulling you away from your current context.

Additionally, when two focus seeds are active, both are rendered identically, even though only the newest one is the active navigation anchor.

## Design

### Interaction Model

Three distinct intents with distinct gestures:

| Gesture | Effect |
|---|---|
| Single click (graph) | Select: opens Reader, highlights node. Lens stays. |
| Single click (Reader chunk bar) | Select: Reader scrolls to chunk, graph highlights node. Lens stays. |
| Double-click (graph) | Focus: re-centers lens, also selects the node. |
| Ghost click (edge-pulled node) | Fly camera to real position + select. No focus change. Double-click after landing to focus if desired. |

Ghost clicks lose their implicit focus behavior — they are navigation assistance (reaching off-screen nodes), not intent to re-anchor the lens.

### State Model

Two decoupled states that are currently conflated in `focusSeeds` + `selectedChunkIds`:

**`selectedChunkId`** (string | null)
- What you are currently reading
- Updated by: single click in graph, single click in Reader
- Drives: Reader content, "reading" highlight on corresponding graph node
- Does not affect lens

**`focusSeeds`** (existing structure, unchanged)
- Where the lens is centered
- Updated by: double-click in graph only
- Max 2 seeds (existing dual-focus behavior preserved)
- Reader interactions no longer trigger focus changes

The Reader ↔ graph connection flows through `selectedChunkId`. Clicking a chunk bar in the Reader highlights the node in the graph without moving the lens.

### Visual Design

Four node visual states:

| State | Shape | Size | Style |
|---|---|---|---|
| Normal | Text-length influenced | Variable | Current behavior |
| Selected (reading) | Fixed circle | Fixed (medium) | Slow breathing pulse — oscillates brightness and scale (~2–3s period) |
| Secondary focus (older seed) | Fixed circle | Medium-large fixed | Static, slightly dimmer |
| Primary focus (newest seed) | Fixed circle | Largest fixed | Static, brightest — head of the trail |

Key decisions:
- Both focus nodes lose the text-length shape distortion. They are navigation markers, not content indicators.
- The size hierarchy (primary > secondary > normal) creates a visible breadcrumb trail as you navigate.
- The breathing animation on the selected node signals "alive / currently reading" — distinct from the static focus anchors.
- A node can be both selected and focused simultaneously (double-clicking selects + focuses). In that case, apply focus visuals (no pulse) — focus state takes visual precedence.

## Out of Scope

- Multi-select in Reader (existing tab history behavior unchanged)
- Cluster focus mode (unchanged)
- Focus exit via zoom-out (unchanged)
