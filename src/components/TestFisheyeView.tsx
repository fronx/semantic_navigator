import { Canvas, useThree } from "@react-three/fiber";
import { useMemo, useEffect, useState } from "react";
import { getBackgroundColor } from "@/lib/theme";
import { CAMERA_FOV_DEGREES } from "@/lib/rendering-utils/zoom-to-cursor";

interface ZoomParams {
  baseZ: number;
  baseStrength: number;
  gridScale: number;
  maxRadiusScale: number;
}

interface GridLine {
  points: [number, number, number][];
}

function makeGrid(
  interval: number,
  from: number,
  to: number
): GridLine[] {
  const lines: GridLine[] = [];
  const subdivisions = 50;

  // Vertical lines
  for (let x = from; x <= to; x += interval) {
    const points: [number, number, number][] = [];
    for (let i = 0; i <= subdivisions; i++) {
      const t = i / subdivisions;
      const y = from + (to - from) * t;
      points.push([x, y, 0]);
    }
    lines.push({ points });
  }

  // Horizontal lines
  for (let y = from; y <= to; y += interval) {
    const points: [number, number, number][] = [];
    for (let i = 0; i <= subdivisions; i++) {
      const t = i / subdivisions;
      const x = from + (to - from) * t;
      points.push([x, y, 0]);
    }
    lines.push({ points });
  }

  return lines;
}

function snapTo125(value: number): number {
  if (!Number.isFinite(value) || value <= 0) return 1;
  const exp = Math.floor(Math.log10(value));
  const base = value / Math.pow(10, exp);

  let snappedBase: number;
  if (base < 1.5) snappedBase = 1;
  else if (base < 3.5) snappedBase = 2;
  else if (base < 7.5) snappedBase = 5;
  else snappedBase = 10;

  return snappedBase * Math.pow(10, exp);
}

function applyFisheyeDistortion(
  x: number,
  y: number,
  focusX: number,
  focusY: number,
  maxRadius: number,
  strength: number
): [number, number] {
  const dx = x - focusX;
  const dy = y - focusY;
  const distance = Math.sqrt(dx * dx + dy * dy);

  if (distance < 1e-9) {
    return [x, y];
  }

  // Hyperbolic/Poincaré disk mapping: compress infinite plane into circular boundary
  // Maps [0, infinity) → [0, maxRadius] asymptotically
  // Uses tanh-like compression: distortedR = maxRadius * tanh(r / scale)
  const scale = maxRadius / strength;
  const distortedDistance = maxRadius * Math.tanh(distance / scale);

  const ratio = distortedDistance / distance;
  return [focusX + dx * ratio, focusY + dy * ratio];
}

function distortGrid(
  lines: GridLine[],
  focusX: number,
  focusY: number,
  radius: number,
  strength: number
): GridLine[] {
  return lines.map((line) => ({
    points: line.points.map(([x, y, z]) => {
      const [distortedX, distortedY] = applyFisheyeDistortion(
        x,
        y,
        focusX,
        focusY,
        radius,
        strength
      );
      return [distortedX, distortedY, z] as [number, number, number];
    }),
  }));
}

function GridLines({ lines }: { lines: GridLine[] }) {
  return (
    <>
      {lines.map((line, i) => {
        const points = new Float32Array(line.points.flat());
        return (
          <line key={i}>
            <bufferGeometry>
              <bufferAttribute
                attach="attributes-position"
                count={line.points.length}
                array={points}
                itemSize={3}
                args={[points, 3]}
              />
            </bufferGeometry>
            <lineBasicMaterial color="#888888" opacity={0.5} transparent />
          </line>
        );
      })}
    </>
  );
}

function Scene({
  strength,
  params
}: {
  strength: number;
  params: ZoomParams;
}) {
  const { size, camera } = useThree();
  const aspect = size.width / size.height;

  // Atomically derive everything from strength
  const cameraZ = params.baseZ * (strength / params.baseStrength);

  // Update camera position
  useEffect(() => {
    camera.position.z = cameraZ;
  }, [camera, cameraZ]);

  // Calculate grid bounds based on derived camera position
  const vFOV = (CAMERA_FOV_DEGREES * Math.PI) / 180;
  const visibleHeight = 2 * Math.tan(vFOV / 2) * cameraZ;
  const visibleWidth = visibleHeight * aspect;

  // Use min dimension so lens is circular in screen-space (NDC)
  const visibleMin = Math.min(visibleWidth, visibleHeight);

  // Lens radius: interpret maxRadiusScale as an NDC radius fraction.
  // NDC radius 1.0 corresponds to (visibleMin / 2) world units at z=0.
  const maxRadius = params.maxRadiusScale * (visibleMin / 2);

  // Grid bounds (still in world units)
  const gridSize = Math.max(visibleWidth, visibleHeight) * params.gridScale;

  // Choose grid spacing in screen pixels, convert to world units, then snap.
  const minViewportPx = Math.min(size.width, size.height);
  const targetGridSpacingPx = 60; // tweakable; try 50–90
  const ndcPerPixel = 2 / Math.max(1, minViewportPx);
  const worldPerNdc = visibleMin / 2;

  const intervalRaw = targetGridSpacingPx * ndcPerPixel * worldPerNdc;
  const interval = Math.max(1, snapTo125(intervalRaw));

  const grid = useMemo(() => makeGrid(interval, -gridSize, gridSize), [
    interval,
    gridSize,
  ]);

  const distortedGrid = useMemo(() => {
    return distortGrid(grid, 0, 0, maxRadius, strength);
  }, [grid, maxRadius, strength]);

  return <GridLines lines={distortedGrid} />;
}

export function TestFisheyeView() {
  const backgroundColor = getBackgroundColor();
  const [strength, setStrength] = useState(2.0);
  const [params, setParams] = useState<ZoomParams>({
    baseZ: 6000,
    baseStrength: 2.0,
    gridScale: 2.0,
    maxRadiusScale: 0.7,
  });

  useEffect(() => {
    const handleWheel = (e: WheelEvent) => {
      e.preventDefault();
      const delta = -e.deltaY;
      const zoomSpeed = 0.01;
      setStrength((prev) => Math.max(0.5, Math.min(10, prev + delta * zoomSpeed)));
    };

    window.addEventListener("wheel", handleWheel, { passive: false });
    return () => window.removeEventListener("wheel", handleWheel);
  }, []);

  return (
    <main
      className="relative overflow-hidden"
      style={{ width: "100vw", height: "100vh" }}
    >
      {/* Controls */}
      <div
        className="absolute top-4 left-4 z-10 bg-black/80 text-white p-4 rounded-lg space-y-3 text-sm"
        style={{ width: "280px" }}
      >
        <div>
          <label className="block mb-1">
            Strength: {strength.toFixed(2)}
          </label>
          <input
            type="range"
            min="0.5"
            max="10"
            step="0.1"
            value={strength}
            onChange={(e) => setStrength(parseFloat(e.target.value))}
            className="w-full"
          />
        </div>
        <div>
          <label className="block mb-1">
            Base Camera Z: {params.baseZ}
          </label>
          <input
            type="range"
            min="1000"
            max="20000"
            step="100"
            value={params.baseZ}
            onChange={(e) =>
              setParams({ ...params, baseZ: parseFloat(e.target.value) })
            }
            className="w-full"
          />
        </div>
        <div>
          <label className="block mb-1">
            Grid Scale: {params.gridScale.toFixed(1)}
          </label>
          <input
            type="range"
            min="1"
            max="5"
            step="0.1"
            value={params.gridScale}
            onChange={(e) =>
              setParams({ ...params, gridScale: parseFloat(e.target.value) })
            }
            className="w-full"
          />
        </div>
        <div>
          <label className="block mb-1">
            Lens Radius (NDC): {params.maxRadiusScale.toFixed(2)}
          </label>
          <input
            type="range"
            min="0.3"
            max="1.5"
            step="0.05"
            value={params.maxRadiusScale}
            onChange={(e) =>
              setParams({
                ...params,
                maxRadiusScale: parseFloat(e.target.value),
              })
            }
            className="w-full"
          />
        </div>
      </div>

      <Canvas
        camera={{
          position: [0, 0, 6000],
          fov: CAMERA_FOV_DEGREES,
          near: 1,
          far: 100000,
        }}
        gl={{ antialias: true, alpha: false }}
        style={{ width: "100%", height: "100%" }}
      >
        <color attach="background" args={[backgroundColor]} />
        <Scene strength={strength} params={params} />
      </Canvas>
    </main>
  );
}
