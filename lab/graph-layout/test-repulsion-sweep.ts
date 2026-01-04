/**
 * Fine-grained repulsion sweep to find balanced configuration.
 * Generates trajectory charts and saves to charts/ folder.
 */

import type { MapData } from "@/app/api/map/route";
import { buildKnnFromEdges, type LayoutPosition } from "@/lib/map-layout";
import { umapLayout } from "umapper";
import * as fs from "fs";
import { lineChart, barChart } from "./lib/svg-chart";

interface TrajectoryPoint {
  epoch: number;
  spread: number;
  meanRatio: number;
}

function computeMetrics(
  positions: LayoutPosition[],
  nodes: MapData["nodes"]
): { spread: number; meanRatio: number } {
  const posById = new Map(positions.map(p => [p.id, p]));

  // Compute spread
  const xs = positions.map(p => p.x);
  const ys = positions.map(p => p.y);
  const spread = Math.max(
    Math.max(...xs) - Math.min(...xs),
    Math.max(...ys) - Math.min(...ys)
  );

  // Compute centroid
  const centroid = {
    x: xs.reduce((a, b) => a + b, 0) / xs.length,
    y: ys.reduce((a, b) => a + b, 0) / ys.length,
  };

  const articles = nodes.filter(n => n.type === "article");
  const keywords = nodes.filter(n => n.type === "keyword");

  const artDist = articles
    .map(n => posById.get(n.id))
    .filter((p): p is LayoutPosition => !!p)
    .map(p => Math.sqrt((p.x - centroid.x) ** 2 + (p.y - centroid.y) ** 2));

  const kwDist = keywords
    .map(n => posById.get(n.id))
    .filter((p): p is LayoutPosition => !!p)
    .map(p => Math.sqrt((p.x - centroid.x) ** 2 + (p.y - centroid.y) ** 2));

  const artMean = artDist.reduce((a, b) => a + b, 0) / artDist.length;
  const kwMean = kwDist.reduce((a, b) => a + b, 0) / kwDist.length;

  return { spread, meanRatio: artMean / kwMean };
}

async function main() {
  console.log("Repulsion Sweep Test\n");

  const res = await fetch("http://localhost:3000/api/map?level=7&neighbors=true&maxEdges=6");
  if (!res.ok) throw new Error(`Failed: ${res.status}`);
  const data: MapData = await res.json();

  console.log(`Dataset: ${data.nodes.length} nodes, ${data.edges.length} edges\n`);

  const knn = buildKnnFromEdges(
    data.nodes.map(n => ({ ...n, type: "keyword" as const, label: n.id })),
    data.edges
  );

  // Test repulsion values from 1 to 200 on log scale
  const repulsionValues = [1, 2, 5, 10, 20, 30, 50, 75, 100, 150, 200];

  const results: { rep: number; finalRatio: number; finalSpread: number; trajectory: TrajectoryPoint[] }[] = [];

  console.log("Rep    | Final Ratio | Final Spread | Status");
  console.log("-".repeat(60));

  const colors = [
    "#e74c3c", "#e67e22", "#f1c40f", "#2ecc71", "#1abc9c",
    "#3498db", "#9b59b6", "#34495e", "#95a5a6", "#d35400", "#c0392b"
  ];

  for (let idx = 0; idx < repulsionValues.length; idx++) {
    const rep = repulsionValues[idx];
    const trajectory: TrajectoryPoint[] = [];
    let lastEpoch = 0;

    const positions = await umapLayout(knn, {
      minDist: 20.0,
      spread: 200,
      epochs: 500,
      repulsionStrength: rep,
      progressInterval: 0,
      skipInitialUpdates: 0,
      renderSampleRate: 1,
      onProgress: ({ epoch, nodes: pos }) => {
        if (epoch % 25 === 0 || epoch === 1) {
          const { spread, meanRatio } = computeMetrics(pos, data.nodes);
          trajectory.push({ epoch, spread, meanRatio });
        }
        lastEpoch = epoch;
      },
    });

    const { spread, meanRatio } = computeMetrics(positions, data.nodes);
    trajectory.push({ epoch: lastEpoch, spread, meanRatio });

    const status = meanRatio > 1.15 ? "Articles at periphery" :
                   meanRatio < 0.85 ? "Keywords at periphery" : "BALANCED";

    console.log(
      `${rep.toString().padStart(6)} | ${meanRatio.toFixed(2).padStart(11)} | ${spread.toFixed(0).padStart(12)} | ${status}`
    );

    results.push({ rep, finalRatio: meanRatio, finalSpread: spread, trajectory });
  }

  // Ensure charts directory exists
  if (!fs.existsSync("lab/graph-layout/charts")) {
    fs.mkdirSync("lab/graph-layout/charts", { recursive: true });
  }

  // Generate spread trajectory chart
  const spreadSeries = results.map((r, i) => ({
    label: `rep=${r.rep}`,
    data: r.trajectory.map(t => ({ x: t.epoch, y: t.spread })),
    color: colors[i % colors.length],
  }));

  const spreadChart = lineChart(spreadSeries, {
    title: "Layout Spread Over Epochs (by Repulsion Strength)",
    xLabel: "Epoch",
    yLabel: "Spread (px)",
    width: 1000,
    height: 500,
  });
  fs.writeFileSync("lab/graph-layout/charts/spread-trajectory.svg", spreadChart);
  console.log("\nSaved: charts/spread-trajectory.svg");

  // Generate ratio trajectory chart
  const ratioSeries = results.map((r, i) => ({
    label: `rep=${r.rep}`,
    data: r.trajectory.map(t => ({ x: t.epoch, y: t.meanRatio })),
    color: colors[i % colors.length],
  }));

  const ratioChart = lineChart(ratioSeries, {
    title: "Centrality Ratio Over Epochs (by Repulsion Strength)",
    xLabel: "Epoch",
    yLabel: "Mean Ratio (articles/keywords)",
    width: 1000,
    height: 500,
    yMin: 0.5,
    yMax: 1.5,
  });
  fs.writeFileSync("lab/graph-layout/charts/ratio-trajectory.svg", ratioChart);
  console.log("Saved: charts/ratio-trajectory.svg");

  // Generate final ratio bar chart
  const barData = results.map(r => ({
    label: `rep=${r.rep}`,
    value: r.finalRatio,
    color: r.finalRatio > 1.15 ? "#e74c3c" : r.finalRatio < 0.85 ? "#3498db" : "#2ecc71",
  }));

  const ratioBarChart = barChart(barData, {
    title: "Final Centrality Ratio by Repulsion Strength",
    yLabel: "Mean Ratio",
    width: 700,
    height: 400,
    yMin: 0.5,
    yMax: 1.5,
  });
  fs.writeFileSync("lab/graph-layout/charts/final-ratio-bar.svg", ratioBarChart);
  console.log("Saved: charts/final-ratio-bar.svg");

  // Save raw data
  fs.writeFileSync(
    "lab/graph-layout/charts/repulsion-sweep-data.json",
    JSON.stringify(results, null, 2)
  );
  console.log("Saved: charts/repulsion-sweep-data.json");

  // Find optimal repulsion (closest to ratio 1.0)
  const sorted = [...results].sort((a, b) =>
    Math.abs(a.finalRatio - 1.0) - Math.abs(b.finalRatio - 1.0)
  );
  console.log(`\nBest config: repulsion=${sorted[0].rep} (ratio=${sorted[0].finalRatio.toFixed(2)})`);
}

main().catch(console.error);
