/**
 * Comprehensive test of force balance parameters to find convergent settings.
 */

import type { MapData } from "@/app/api/map/route";
import { buildKnnFromEdges } from "@/lib/map-layout";
import { umapLayout } from "umapper";

function computeSpread(positions: { x: number; y: number }[]): number {
  const xs = positions.map(p => p.x);
  const ys = positions.map(p => p.y);
  const xRange = Math.max(...xs) - Math.min(...xs);
  const yRange = Math.max(...ys) - Math.min(...ys);
  return Math.max(xRange, yRange);
}

interface TestConfig {
  label: string;
  repulsionStrength?: number;
  attractionStrength?: number;
  minAttractiveScale?: number;
}

async function runTest(
  knn: ReturnType<typeof buildKnnFromEdges>,
  config: TestConfig
): Promise<{ trajectory: number[]; final: number; converged: boolean }> {
  const trajectory: number[] = [];

  await umapLayout(knn, {
    minDist: 20.0,
    spread: 200,
    epochs: 500,
    repulsionStrength: config.repulsionStrength,
    attractionStrength: config.attractionStrength,
    minAttractiveScale: config.minAttractiveScale,
    progressInterval: 0,
    skipInitialUpdates: 0,
    renderSampleRate: 1,
    onProgress: ({ epoch, nodes: pos }) => {
      if (epoch % 50 === 0) {
        trajectory.push(computeSpread(pos));
      }
    },
  });

  const final = trajectory[trajectory.length - 1] || 0;

  // Check if converged: last 3 samples within 5% of each other
  const last3 = trajectory.slice(-3);
  const converged = last3.length >= 3 &&
    Math.max(...last3) / Math.min(...last3) < 1.05;

  return { trajectory, final, converged };
}

async function main() {
  console.log("Convergence Test\n");
  console.log("================\n");

  const res = await fetch("http://localhost:3000/api/map?level=7&neighbors=true&maxEdges=6");
  if (!res.ok) throw new Error(`Failed: ${res.status}`);
  const data: MapData = await res.json();

  console.log(`Dataset: ${data.nodes.length} nodes, ${data.edges.length} edges\n`);

  const knn = buildKnnFromEdges(
    data.nodes.map(n => ({ ...n, type: "keyword" as const, label: n.id })),
    data.edges
  );

  const configs: TestConfig[] = [
    // Baseline
    { label: "Default (rep=200, attr=1, scale=50)" },

    // Reduce minAttractiveScale (the 1003px exclusion zone)
    { label: "minAttrScale=1", minAttractiveScale: 1 },
    { label: "minAttrScale=0.1", minAttractiveScale: 0.1 },

    // Low repulsion
    { label: "rep=10", repulsionStrength: 10 },
    { label: "rep=1", repulsionStrength: 1 },

    // High attraction
    { label: "attr=200", attractionStrength: 200 },
    { label: "attr=1000", attractionStrength: 1000 },

    // Combined: low repulsion + reduced scale
    { label: "rep=10 + scale=1", repulsionStrength: 10, minAttractiveScale: 1 },
    { label: "rep=1 + scale=1", repulsionStrength: 1, minAttractiveScale: 1 },

    // Combined: high attraction + reduced scale
    { label: "attr=200 + scale=1", attractionStrength: 200, minAttractiveScale: 1 },

    // Extreme: disable spacing attenuation entirely
    { label: "scale=0 (no exclusion)", minAttractiveScale: 0 },
    { label: "rep=1 + scale=0", repulsionStrength: 1, minAttractiveScale: 0 },
  ];

  console.log("Config                              | Final Spread | Converged | Trajectory (every 50 epochs)");
  console.log("-".repeat(100));

  for (const config of configs) {
    process.stdout.write(`${config.label.padEnd(35)} |`);

    const result = await runTest(knn, config);

    const traj = result.trajectory.map(s => s.toFixed(0).padStart(5)).join(" → ");
    const status = result.converged ? "YES" : "no";

    console.log(` ${result.final.toFixed(0).padStart(12)} | ${status.padStart(9)} | ${traj}`);
  }

  console.log("\n\nLooking for: Converged=YES with reasonable Final Spread (~500-2000)");
}

main().catch(console.error);
