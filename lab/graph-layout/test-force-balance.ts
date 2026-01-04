/**
 * Test different force balance configurations to find convergent settings.
 *
 * The current issue: spread=200 means repulsionStrength=200, but
 * edge weights are 0.5-1.0, so repulsion overwhelms attraction.
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
  spread: number;
  repulsionStrength?: number;
  attractionStrength?: number;
  label: string;
}

async function testConfig(
  nodes: { id: string }[],
  edges: { source: string; target: string; similarity?: number }[],
  config: TestConfig
): Promise<{ finalSpread: number; spreadHistory: number[] }> {
  const knn = buildKnnFromEdges(
    nodes.map(n => ({ ...n, type: "keyword" as const, label: n.id })),
    edges
  );

  const spreadHistory: number[] = [];

  const positions = await umapLayout(knn, {
    minDist: 20.0,
    spread: config.spread,
    epochs: 500,
    repulsionStrength: config.repulsionStrength,
    attractionStrength: config.attractionStrength,
    progressInterval: 50,
    onProgress: ({ nodes: pos }) => {
      spreadHistory.push(computeSpread(pos));
    },
  });

  return {
    finalSpread: computeSpread(positions),
    spreadHistory,
  };
}

async function main() {
  console.log("Force Balance Test\n");

  const res = await fetch("http://localhost:3000/api/map?level=7&neighbors=true&maxEdges=6");
  if (!res.ok) throw new Error(`Failed: ${res.status}`);
  const data: MapData = await res.json();

  console.log(`Dataset: ${data.nodes.length} nodes, ${data.edges.length} edges\n`);

  // Just test one config and show the full trajectory
  const config: TestConfig = { spread: 200, label: "Default" };

  console.log("Tracking spread over epochs (default config):\n");

  const knn = buildKnnFromEdges(
    data.nodes.map(n => ({ ...n, type: "keyword" as const, label: n.id })),
    data.edges
  );

  let epochNum = 0;
  const positions = await umapLayout(knn, {
    minDist: 20.0,
    spread: 200,
    epochs: 1000,
    progressInterval: 0, // Report every epoch
    skipInitialUpdates: 0,
    renderSampleRate: 1,
    onProgress: ({ epoch, nodes: pos }) => {
      const spread = computeSpread(pos);
      // Print every 100 epochs
      if (epoch % 100 === 0 || epoch === 1) {
        console.log(`  Epoch ${epoch.toString().padStart(4)}: spread = ${spread.toFixed(0)}`);
      }
      epochNum = epoch;
    },
  });

  const finalSpread = computeSpread(positions);
  console.log(`\n  Final (${epochNum}): spread = ${finalSpread.toFixed(0)}`);

  // Test various extreme configurations
  const configs = [
    { label: "repulsion=5", repulsionStrength: 5, attractionStrength: 1 },
    { label: "repulsion=1", repulsionStrength: 1, attractionStrength: 1 },
    { label: "attraction=200 (match repulsion)", repulsionStrength: 200, attractionStrength: 200 },
  ];

  for (const cfg of configs) {
    console.log(`\n\nWith ${cfg.label}:\n`);

    epochNum = 0;
    const pos = await umapLayout(knn, {
      minDist: 20.0,
      spread: 200,
      epochs: 1000,
      repulsionStrength: cfg.repulsionStrength,
      attractionStrength: cfg.attractionStrength,
      progressInterval: 0,
      skipInitialUpdates: 0,
      renderSampleRate: 1,
      onProgress: ({ epoch, nodes: p }) => {
        const sp = computeSpread(p);
        if (epoch % 100 === 0 || epoch === 1) {
          console.log(`  Epoch ${epoch.toString().padStart(4)}: spread = ${sp.toFixed(0)}`);
        }
        epochNum = epoch;
      },
    });

    const fs = computeSpread(pos);
    console.log(`\n  Final (${epochNum}): spread = ${fs.toFixed(0)}`);
  }
}

main().catch(console.error);
