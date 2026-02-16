import { Canvas, useThree } from "@react-three/fiber";
import { useMemo } from "react";
import { getBackgroundColor } from "@/lib/theme";
import { CAMERA_FOV_DEGREES } from "@/lib/rendering-utils/zoom-to-cursor";
import { applyFisheyeCompression } from "@/lib/fisheye-viewport";

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

function distortGrid(
  lines: GridLine[],
  focusX: number,
  focusY: number,
  compressionStartRadius: number,
  maxRadius: number
): GridLine[] {
  return lines.map((line) => ({
    points: line.points.map(([x, y, z]) => {
      const compressed = applyFisheyeCompression(
        x,
        y,
        focusX,
        focusY,
        compressionStartRadius,
        maxRadius
      );
      return [compressed.x, compressed.y, z] as [number, number, number];
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

function calculateGridBounds(cameraZ: number, fov: number, aspect: number) {
  const vFOV = (fov * Math.PI) / 180;
  const height = 2 * Math.tan(vFOV / 2) * cameraZ;
  const width = height * aspect;
  const margin = 1.5;
  return {
    size: Math.max(width, height) * margin,
    interval: Math.max(50, Math.floor((width * margin) / 30)),
  };
}

function Scene() {
  const { size } = useThree();

  const aspect = size.width / size.height;
  const { size: gridSize, interval } = useMemo(
    () => calculateGridBounds(6000, CAMERA_FOV_DEGREES, aspect),
    [aspect]
  );

  const grid = useMemo(
    () => makeGrid(interval, -gridSize, gridSize),
    [interval, gridSize]
  );

  const distortedGrid = useMemo(() => {
    const compressionStartRadius = gridSize * 0.6;
    const maxRadius = gridSize * 0.9;
    return distortGrid(grid, 0, 0, compressionStartRadius, maxRadius);
  }, [grid, gridSize]);

  return <GridLines lines={distortedGrid} />;
}

export function TestFisheyeView() {
  const backgroundColor = getBackgroundColor();

  return (
    <main
      className="relative overflow-hidden"
      style={{ width: "100vw", height: "100vh" }}
    >
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
        <Scene />
      </Canvas>
    </main>
  );
}
