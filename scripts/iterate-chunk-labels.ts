/**
 * Iterate on the chunk cluster labeling prompt.
 *
 * Edit PROMPT below, then run:
 *   npm run script scripts/iterate-chunk-labels.ts
 *
 * By default runs on coarse clusters. Pass --fine to test fine clusters.
 * Pass --clusters 0,3,5 to test specific cluster IDs only.
 */

import { promises as fs } from "fs";
import path from "path";
import Anthropic from "@anthropic-ai/sdk";
import { createServerClient } from "../src/lib/supabase";
import { extractJsonFromResponse } from "../src/lib/llm";

// ─── EDIT THIS ───────────────────────────────────────────────────────────────

const PROMPT = (clusterDescriptions: string) => `\
Label these clusters of personal writing for a 2D map. Labels float over regions like chapter titles.

Format: 2 words strongly preferred. 3 only when truly necessary. Lowercase. No "the" to start. No commas.

Style: treat the writing as philosophical poetry, not academic text. Don't retheorize — resonate.
Noun phrases preferred. If you use a verb, make it blunt and specific, not poetic or soft.
No verb gerunds (words acting as verbs: "forming", "questioning", "breaking"). Nouns ending in -ing are fine ("sneezing", "meaning").
Do not lift words directly from the excerpts — find your own angle on what the cluster is about.
Aim to intrigue, not summarize. A reader should think "what's that?" not "I see".

Bad (soft verb): "thoughts drift", "patterns emerge", "habits return"
Bad (verb gerund): "pattern forming", "self questioning", "habit breaking"
Bad (too long): "what sneezing reveals", "how stories shape us", "the cost of clarity"
Bad (flat pair): "concept limit", "value reach", "idea count"
Good: "two hungers", "borrowed time", "maps lie", "static breaks", "artful sneezing", "fault inside"

${clusterDescriptions}

Return ONLY a JSON object: {"0": "label", "1": "label", ...}`;

// ─────────────────────────────────────────────────────────────────────────────

const CACHE_PATH = path.join(process.cwd(), "data", "chunks-layout.json");
const EXCERPT_LENGTH = 200;
const MAX_EXCERPTS = 15;

interface CachedLayout {
  chunkIds: string[];
  coarseClusters: Record<string, number>;
  fineClusters: Record<string, number>;
  coarseLabels: Record<string, string>;
  fineLabels: Record<string, string>;
}

async function fetchExcerpts(chunkIds: string[]): Promise<Map<string, string>> {
  const sb = createServerClient();
  const excerpts = new Map<string, string>();
  const PAGE = 50; // large .in() queries hit URL length limits
  for (let i = 0; i < chunkIds.length; i += PAGE) {
    const batch = chunkIds.slice(i, i + PAGE);
    const { data } = await sb.from("nodes").select("id, content").in("id", batch);
    for (const row of data ?? []) {
      if (row.content) excerpts.set(row.id, row.content.slice(0, EXCERPT_LENGTH));
    }
  }
  return excerpts;
}

function buildClusterExcerpts(
  clusterMap: Record<string, number>,
  chunkIds: string[],
  excerpts: Map<string, string>,
  filter?: Set<number>
): Array<{ id: number; excerpts: string[] }> {
  const byCluster = new Map<number, string[]>();
  for (const [idxStr, clusterId] of Object.entries(clusterMap)) {
    if (filter && !filter.has(clusterId)) continue;
    const excerpt = excerpts.get(chunkIds[parseInt(idxStr)]);
    if (!excerpt) continue;
    if (!byCluster.has(clusterId)) byCluster.set(clusterId, []);
    const arr = byCluster.get(clusterId)!;
    if (arr.length < MAX_EXCERPTS) arr.push(excerpt);
  }
  return Array.from(byCluster, ([id, excs]) => ({ id, excerpts: excs })).sort(
    (a, b) => a.id - b.id
  );
}

async function labelClusters(
  clusters: Array<{ id: number; excerpts: string[] }>
): Promise<Record<number, string>> {
  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  const descriptions = clusters
    .map((c) => `Cluster ${c.id}:\n${c.excerpts.map((e) => `  - ${e}`).join("\n")}`)
    .join("\n\n");

  const resp = await anthropic.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 1000,
    messages: [{ role: "user", content: PROMPT(descriptions) }],
  });

  const block = resp.content.find((b) => b.type === "text");
  if (!block?.text) return {};

  const parsed = JSON.parse(extractJsonFromResponse(block.text));
  const result: Record<number, string> = {};
  for (const [k, v] of Object.entries(parsed)) {
    if (typeof v === "string") result[parseInt(k)] = v;
  }
  return result;
}

async function main() {
  const args = process.argv.slice(2);
  const useFine = args.includes("--fine");
  const filterArg = args.find((a) => a.startsWith("--clusters="));
  const filterIds = filterArg
    ? new Set(filterArg.replace("--clusters=", "").split(",").map(Number))
    : undefined;

  const raw = await fs.readFile(CACHE_PATH, "utf-8");
  const layout = JSON.parse(raw) as CachedLayout;

  const resolution = useFine ? "fine" : "coarse";
  const clusterMap = useFine ? layout.fineClusters : layout.coarseClusters;
  const existingLabels = useFine ? layout.fineLabels : layout.coarseLabels;

  console.log(`\nFetching content for ${layout.chunkIds.length} chunks...`);
  const excerpts = await fetchExcerpts(layout.chunkIds);
  console.log(`Got excerpts for ${excerpts.size} chunks`);

  const clusters = buildClusterExcerpts(clusterMap, layout.chunkIds, excerpts, filterIds);
  console.log(`\nLabeling ${clusters.length} ${resolution} clusters...\n`);

  const newLabels = await labelClusters(clusters);

  // Print side-by-side comparison
  const colWidth = 36;
  const header = `${"CLUSTER".padEnd(10)}${"OLD LABEL".padEnd(colWidth)}NEW LABEL`;
  console.log(header);
  console.log("─".repeat(header.length));

  for (const { id } of clusters) {
    const old = (existingLabels[id] ?? "(none)").padEnd(colWidth);
    const next = newLabels[id] ?? "(missing)";
    console.log(`${String(id).padEnd(10)}${old}${next}`);
  }

  // Show all clusters with excerpts for manual assessment
  console.log("\n─── EXCERPTS ─────────────────────────────────────────────────────\n");
  for (const { id, excerpts: excs } of clusters) {
    const next = newLabels[id] ?? "(missing)";
    console.log(`Cluster ${id}: "${next}"`);
    for (const e of excs.slice(0, 5)) {
      console.log(`  · ${e.slice(0, 140).replace(/\n/g, " ")}`);
    }
    console.log();
  }
}

main().catch(console.error);
