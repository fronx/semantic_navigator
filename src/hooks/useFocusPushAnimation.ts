/**
 * Shared hook for animating "margin" nodes from natural positions to the
 * viewport edge on focus activation, and back on deactivation.
 * Works with both string IDs (TopicsView) and number IDs (ChunksView).
 */
import { useRef, type MutableRefObject } from "react";
import { clampToBounds } from "@/lib/edge-pulling";
import { easeInCubic, easeOutCubic } from "@/hooks/usePositionInterpolation";

export interface FocusPushFrame<TId> {
  marginIds: Set<TId>;
  getPosition: (id: TId) => { x: number; y: number };
  pullBounds: { left: number; right: number; bottom: number; top: number };
  camX: number;
  camY: number;
}

export interface FocusPushOverride {
  x: number;
  y: number;
  /** 0 = at natural position, 1 = fully off screen */
  progress: number;
  /** True for margin nodes that remain in margin during a re-focus: already off-screen, skip re-animation */
  stable?: boolean;
}

type Phase = "idle" | "pushing" | "tracking" | "returning";
interface AnimEntry {
  startX: number;
  startY: number;
  targetX: number;
  targetY: number;
  /** When true, this node is leaving margin (returning to natural position). */
  returning: boolean;
}
interface AnimState<TId> {
  entries: Map<TId, AnimEntry>;
  startTime: number;
  duration: number;
}

export function useFocusPushAnimation<TId extends string | number>(
  options?: { pushDuration?: number; returnDuration?: number; overshootFactor?: number },
): {
  positionsRef: MutableRefObject<Map<TId, FocusPushOverride>>;
  phaseRef: MutableRefObject<Phase>;
  tick: (frame: FocusPushFrame<TId> | null) => void;
} {
  const pushDuration = options?.pushDuration ?? 1200;
  const returnDuration = options?.returnDuration ?? 900;
  const overshootFactor = options?.overshootFactor ?? 2.5;

  const positionsRef = useRef<Map<TId, FocusPushOverride>>(new Map());
  const phaseRef = useRef<Phase>("idle");
  const animRef = useRef<AnimState<TId> | null>(null);
  const prevActiveRef = useRef(false);
  const lastFrameRef = useRef<FocusPushFrame<TId> | null>(null);
  const prevMarginIdsRef = useRef<Set<TId> | null>(null);

  /** Build push animation entries. Only animates nodes entering or leaving margin.
   *  Nodes that remain in margin (prevMarginIds provided) stay stable — no re-animation. */
  function startPush(frame: FocusPushFrame<TId>, prevMarginIds?: Set<TId> | null) {
    const entries = new Map<TId, AnimEntry>();
    // Nodes in new margin set: push beyond viewport edge (skip if already stably there)
    for (const id of frame.marginIds) {
      const isStable = prevMarginIds?.has(id) && positionsRef.current.has(id);
      if (isStable) {
        // Mark as stable so inFleeAnim stays false — no pop, no re-animation
        const prev = positionsRef.current.get(id)!;
        positionsRef.current.set(id, { ...prev, stable: true });
        continue;
      }
      const pos = frame.getPosition(id);
      const prev = positionsRef.current.get(id);
      const startX = prev?.x ?? pos.x;
      const startY = prev?.y ?? pos.y;
      // Find ray-AABB intersection (viewport edge), then extend by overshootFactor
      const edge = clampToBounds(
        pos.x, pos.y, frame.camX, frame.camY,
        frame.pullBounds.left, frame.pullBounds.right,
        frame.pullBounds.bottom, frame.pullBounds.top,
      );
      const targetX = frame.camX + (edge.x - frame.camX) * overshootFactor;
      const targetY = frame.camY + (edge.y - frame.camY) * overshootFactor;
      entries.set(id, { startX, startY, targetX, targetY, returning: false });
    }
    // Nodes leaving margin set: return from current position to natural
    for (const [id, override] of positionsRef.current) {
      if (entries.has(id) || frame.marginIds.has(id)) continue;
      const natural = frame.getPosition(id);
      entries.set(id, {
        startX: override.x, startY: override.y,
        targetX: natural.x, targetY: natural.y,
        returning: true,
      });
    }
    animRef.current = { entries, startTime: performance.now(), duration: pushDuration };
    phaseRef.current = "pushing";
  }

  function tick(frame: FocusPushFrame<TId> | null) {
    // 1. Stash last frame
    if (frame) lastFrameRef.current = frame;
    const wasActive = prevActiveRef.current;
    const isActive = frame !== null;

    // 2. Detect transitions and set up animations
    if (isActive && !wasActive) {
      // null → non-null: push
      startPush(frame, null);
    } else if (isActive && wasActive && frame.marginIds !== prevMarginIdsRef.current) {
      // Focus target changed: only animate nodes entering/leaving margin, skip stable ones
      startPush(frame, prevMarginIdsRef.current);
    } else if (!isActive && wasActive) {
      // non-null → null: return
      const lastFrame = lastFrameRef.current!;
      const entries = new Map<TId, AnimEntry>();
      for (const [id, override] of positionsRef.current) {
        const natural = lastFrame.getPosition(id);
        entries.set(id, {
          startX: override.x, startY: override.y,
          targetX: natural.x, targetY: natural.y,
          returning: true,
        });
      }
      animRef.current = { entries, startTime: performance.now(), duration: returnDuration };
      phaseRef.current = "returning";
    }

    // 3. Run animation interpolation (if pushing or returning)
    const anim = animRef.current;
    if (anim) {
      const elapsed = performance.now() - anim.startTime;
      const rawT = Math.min(1, elapsed / anim.duration);
      const phase = phaseRef.current;
      // Push: accelerate into target (nodes shoot off screen). Return: decelerate into rest.
      const t = phase === "pushing" ? easeInCubic(rawT) : easeOutCubic(rawT);

      for (const [id, entry] of anim.entries) {
        positionsRef.current.set(id, {
          x: entry.startX + (entry.targetX - entry.startX) * t,
          y: entry.startY + (entry.targetY - entry.startY) * t,
          progress: entry.returning ? 1 - t : t,
        });
      }

      if (rawT >= 1) {
        if (phase === "returning") {
          positionsRef.current.clear();
        } else {
          // Remove returning entries (nodes that left margin are back at natural)
          for (const [id, entry] of anim.entries) {
            if (entry.returning) positionsRef.current.delete(id);
          }
        }
        animRef.current = null;
        phaseRef.current = phase === "pushing" ? "tracking" : "idle";
      }
    }
    // 4. Run tracking (if focused, not animating, frame non-null)
    else if (frame && phaseRef.current === "tracking") {
      // Clean up stale IDs
      for (const id of Array.from(positionsRef.current.keys())) {
        if (!frame.marginIds.has(id)) positionsRef.current.delete(id);
      }
      // Update positions to track viewport
      for (const id of frame.marginIds) {
        const pos = frame.getPosition(id);
        const target = clampToBounds(
          pos.x, pos.y, frame.camX, frame.camY,
          frame.pullBounds.left, frame.pullBounds.right,
          frame.pullBounds.bottom, frame.pullBounds.top,
        );
        positionsRef.current.set(id, { x: target.x, y: target.y, progress: 1 });
      }
    }

    // 5. Update prev
    prevActiveRef.current = isActive;
    prevMarginIdsRef.current = frame?.marginIds ?? null;
  }

  return { positionsRef, phaseRef, tick };
}
