/**
 * Evaluate how well community assignments align with spatial layout.
 *
 * Computes "community cohesion" metric:
 *   - Within-community distance: avg distance between nodes in same community
 *   - Between-community distance: avg distance between nodes in different communities
 *   - Cohesion ratio: between/within (higher = better spatial clustering)
 *
 * Usage:
 *   npm run script lab/graph-layout/evaluate-community-cohesion.ts
 *
 * Compares:
 *   1. Current database communities (semantic-only Louvain)
 *   2. Bipartite communities (from prototype script, if available)
 */
import type { MapData, MapNode, MapEdge } from "@/app/api/map/route";
import { computeUmapLayoutRaw, type LayoutPosition } from "@/lib/map-layout";
import * as fs from "fs";
import * as path from "path";

const DATA_DIR = path.join(process.cwd(), "data");
const COMMUNITIES_FILE = path.join(DATA_DIR, "bipartite-communities.json");

interface CommunityResult {
  level: number;
  resolution: number;
  communityCount: number;
  assignments: Record<string, number>;
}

function computeCohesion(
  positions: LayoutPosition[],
  assignments: Record<string, number>
): { withinDist: number; betweenDist: number; ratio: number; coverage: number } {
  const posById = new Map(positions.map(p => [p.id, p]));

  // Filter to nodes that have both position and community assignment
  const nodesWithBoth = positions.filter(p => assignments[p.id] !== undefined);
  const coverage = nodesWithBoth.length / positions.length;

  if (nodesWithBoth.length < 2) {
    return { withinDist: 0, betweenDist: 0, ratio: 0, coverage };
  }

  let withinSum = 0, withinCount = 0;
  let betweenSum = 0, betweenCount = 0;

  for (let i = 0; i < nodesWithBoth.length; i++) {
    const a = nodesWithBoth[i];
    const comA = assignments[a.id];

    for (let j = i + 1; j < nodesWithBoth.length; j++) {
      const b = nodesWithBoth[j];
      const comB = assignments[b.id];

      const dist = Math.sqrt((a.x - b.x) ** 2 + (a.y - b.y) ** 2);

      if (comA === comB) {
        withinSum += dist;
        withinCount++;
      } else {
        betweenSum += dist;
        betweenCount++;
      }
    }
  }

  const withinDist = withinCount > 0 ? withinSum / withinCount : 0;
  const betweenDist = betweenCount > 0 ? betweenSum / betweenCount : 0;
  const ratio = withinDist > 0 ? betweenDist / withinDist : 0;

  return { withinDist, betweenDist, ratio, coverage };
}

async function fetchMapData(): Promise<MapData> {
  // Fetch from running dev server with UI-matching parameters:
  // level=7, density=6, neighbors=true, clustered=false
  const res = await fetch("http://localhost:3000/api/map?level=7&neighbors=true&maxEdges=6&clustered=false");
  if (!res.ok) throw new Error(`Failed to fetch map data: ${res.status}`);
  return res.json();
}

async function main() {
  console.log("Community Cohesion Evaluation\n");
  console.log("Fetching map data from dev server...");

  const data = await fetchMapData();
  console.log(`Loaded ${data.nodes.length} nodes, ${data.edges.length} edges\n`);

  // Run UMAP layout
  console.log("Running UMAP layout (this may take a minute)...");
  const positions = await computeUmapLayoutRaw(data.nodes, data.edges, {
    epochs: 1000,
    repulsionStrength: 100, // Balanced setting from lab experiments
  });
  console.log(`Layout complete: ${positions.length} positions\n`);

  // Extract current database community assignments
  const dbAssignments: Record<string, number> = {};
  for (const node of data.nodes) {
    if (node.communityId !== undefined) {
      dbAssignments[node.id] = node.communityId;
    }
  }

  console.log("=== Current Database Communities (semantic-only) ===");
  const dbCohesion = computeCohesion(positions, dbAssignments);
  console.log(`Coverage: ${(dbCohesion.coverage * 100).toFixed(1)}% of nodes have community`);
  console.log(`Within-community distance: ${dbCohesion.withinDist.toFixed(1)}`);
  console.log(`Between-community distance: ${dbCohesion.betweenDist.toFixed(1)}`);
  console.log(`Cohesion ratio (between/within): ${dbCohesion.ratio.toFixed(2)}`);
  console.log(`  (higher = better spatial clustering)\n`);

  // Load bipartite communities if available
  if (fs.existsSync(COMMUNITIES_FILE)) {
    console.log("=== Bipartite Communities (from prototype) ===");
    const bipartiteCommunities: CommunityResult[] = JSON.parse(
      fs.readFileSync(COMMUNITIES_FILE, "utf-8")
    );

    // Test a few resolution levels
    const testLevels = [1, 3, 5, 7];
    console.log("\nLevel | Resolution | Communities | Coverage | Within | Between | Ratio");
    console.log("------|------------|-------------|----------|--------|---------|------");

    for (const level of testLevels) {
      const result = bipartiteCommunities.find(c => c.level === level);
      if (!result) continue;

      const cohesion = computeCohesion(positions, result.assignments);

      console.log(
        `${level.toString().padStart(5)} | ` +
        `${result.resolution.toString().padStart(10)} | ` +
        `${result.communityCount.toString().padStart(11)} | ` +
        `${(cohesion.coverage * 100).toFixed(0).padStart(7)}% | ` +
        `${cohesion.withinDist.toFixed(0).padStart(6)} | ` +
        `${cohesion.betweenDist.toFixed(0).padStart(7)} | ` +
        `${cohesion.ratio.toFixed(2).padStart(5)}`
      );
    }

    // Compare best bipartite vs database
    const bestBipartite = bipartiteCommunities
      .map(c => ({ ...c, cohesion: computeCohesion(positions, c.assignments) }))
      .sort((a, b) => b.cohesion.ratio - a.cohesion.ratio)[0];

    console.log(`\n--- Comparison ---`);
    console.log(`Database cohesion ratio: ${dbCohesion.ratio.toFixed(2)}`);
    console.log(`Best bipartite ratio: ${bestBipartite.cohesion.ratio.toFixed(2)} (level ${bestBipartite.level})`);
    console.log(`Improvement: ${((bestBipartite.cohesion.ratio / dbCohesion.ratio - 1) * 100).toFixed(1)}%`);
  } else {
    console.log("No bipartite communities found. Run prototype script first:");
    console.log("  npm run script scripts/prototype-bipartite-communities.ts");
  }
}

main().catch(console.error);
