import { Canvas, useThree, useFrame } from "@react-three/fiber";
import { useMemo, useEffect, useState, useRef } from "react";
import { getBackgroundColor } from "@/lib/theme";
import { CAMERA_FOV_DEGREES } from "@/lib/rendering-utils/zoom-to-cursor";

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

function applyFisheyeDistortion(
  x: number,
  y: number,
  focusX: number,
  focusY: number,
  radius: number,
  strength: number
): [number, number] {
  const dx = x - focusX;
  const dy = y - focusY;
  const distance = Math.sqrt(dx * dx + dy * dy);

  if (distance === 0) {
    return [x, y];
  }

  // Classic fisheye: expand near center, compress at edges
  // Use a smooth curve that magnifies in the middle and compresses at the boundary
  const normalized = distance / radius;

  if (normalized >= 1) {
    return [x, y];
  }

  // Distortion factor: center expands (>1), edges compress (<1)
  // Using: distortedR = r * (1 + strength * (1 - r/radius)^2)
  const factor = 1 + strength * Math.pow(1 - normalized, 2);
  const distortedDistance = distance * factor;

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

function CameraController() {
  const { camera } = useThree();

  useEffect(() => {
    const handleWheel = (e: WheelEvent) => {
      e.preventDefault();
      const delta = e.deltaY;
      const zoomSpeed = 10;
      camera.position.z = Math.max(1000, Math.min(20000, camera.position.z + delta * zoomSpeed));
    };

    window.addEventListener("wheel", handleWheel, { passive: false });
    return () => window.removeEventListener("wheel", handleWheel);
  }, [camera]);

  return null;
}

function Scene() {
  const { size, camera } = useThree();
  const [cameraZ, setCameraZ] = useState(camera.position.z);
  const lastCameraZ = useRef(camera.position.z);

  useFrame(() => {
    if (Math.abs(camera.position.z - lastCameraZ.current) > 10) {
      lastCameraZ.current = camera.position.z;
      setCameraZ(camera.position.z);
    }
  });

  const aspect = size.width / size.height;
  const { size: gridSize, interval } = useMemo(
    () => calculateGridBounds(cameraZ, CAMERA_FOV_DEGREES, aspect),
    [cameraZ, aspect]
  );

  const grid = useMemo(
    () => makeGrid(interval, -gridSize, gridSize),
    [interval, gridSize]
  );

  const distortedGrid = useMemo(() => {
    const radius = gridSize * 0.7;
    const strength = 0.5; // 0 = no effect, 1 = strong magnification
    return distortGrid(grid, 0, 0, radius, strength);
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
        <CameraController />
        <Scene />
      </Canvas>
    </main>
  );
}
