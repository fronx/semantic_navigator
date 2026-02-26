/**
 * Generate static data files for the read-only artifact deployment.
 * Run with: npm run script scripts/generate-artifact-data.ts
 *
 * Requires:
 *   - Dev server running (for fetching embeddings)
 *   - data/chunks-layout.json (generated after one ChunksView session)
 *   - data/offline-cache/nodes-*.json (from download-offline-data.ts)
 *
 * Outputs to data/artifact/:
 *   - chunks-embeddings.json  (chunk metadata with pre-computed colors, vectors stripped)
 *   - chunks-layout.json      (pre-computed UMAP positions + clusters + labels)
 *   - nodes-chunk.json        (full chunk content for article reader)
 *   - nodes-article.json      (full article content for article reader)
 */

import fs from "fs/promises";
import path from "path";
import {
  pcaProject,
  coordinatesToHSL,
  type PCATransform,
} from "../src/lib/semantic-colors";
import { normalize } from "../src/lib/math-utils";
import { CHUNKS_DEFAULTS } from "../src/lib/chunks-defaults";
import * as THREE from "three";

const BASE_URL = process.env.NEXT_PUBLIC_BASE_URL || "http://localhost:3000";
const OUTPUT_DIR = path.join(process.cwd(), "data", "artifact");
const OFFLINE_CACHE_DIR = path.join(process.cwd(), "data", "offline-cache");
const LAYOUT_PATH = path.join(process.cwd(), "data", "chunks-layout.json");
const PCA_PATH = path.join(process.cwd(), "public", "data", "embedding-pca-transform.json");

// Baked at generation time; artifact mode ignores the runtime slider.
const CHUNK_COLOR_MIX = CHUNKS_DEFAULTS.chunkColorMix;

interface RawChunk {
  id: string;
  content: string;
  summary: string | null;
  sourcePath: string;
  headingContext: string[] | null;
  chunkType: string | null;
  embedding: number[];
}

function computeChunkColors(chunks: RawChunk[], transform: PCATransform): Map<string, string> {
  // Compute article centroid colors (same algorithm as ChunksScene)
  const articleEmbeddings = new Map<string, number[][]>();
  for (const chunk of chunks) {
    if (!articleEmbeddings.has(chunk.sourcePath)) articleEmbeddings.set(chunk.sourcePath, []);
    articleEmbeddings.get(chunk.sourcePath)!.push(chunk.embedding);
  }

  const articleColors = new Map<string, THREE.Color>();
  for (const [sourcePath, embeddings] of articleEmbeddings) {
    const centroid = computeCentroid(embeddings);
    const [x, y] = pcaProject(centroid, transform);
    articleColors.set(sourcePath, new THREE.Color(coordinatesToHSL(x, y)));
  }

  // Compute blended per-chunk colors
  const result = new Map<string, string>();
  for (const chunk of chunks) {
    const articleColor = articleColors.get(chunk.sourcePath) ?? new THREE.Color(0.6, 0.6, 0.6);
    const [x, y] = pcaProject(chunk.embedding, transform);
    const chunkColor = new THREE.Color(coordinatesToHSL(x, y));
    const final = articleColor.clone().lerp(chunkColor, CHUNK_COLOR_MIX);
    result.set(chunk.id, "#" + final.getHexString());
  }
  return result;
}

function computeCentroid(embeddings: number[][]): number[] {
  const dim = embeddings[0].length;
  const sum = new Array(dim).fill(0);
  for (const emb of embeddings) {
    for (let i = 0; i < dim; i++) sum[i] += emb[i];
  }
  for (let i = 0; i < dim; i++) sum[i] /= embeddings.length;
  return normalize(sum);
}

async function main() {
  console.log("Generating artifact data...\n");

  await fs.mkdir(OUTPUT_DIR, { recursive: true });

  // 1. Fetch embeddings from dev server
  console.log(`Fetching ${BASE_URL}/api/chunks/embeddings...`);
  const embeddingsRes = await fetch(`${BASE_URL}/api/chunks/embeddings`);
  if (!embeddingsRes.ok) {
    throw new Error(`Failed to fetch embeddings: ${embeddingsRes.statusText}`);
  }
  const embeddings: RawChunk[] = await embeddingsRes.json();

  // 2. Pre-compute colors from embeddings + PCA transform before stripping vectors
  let chunkColors: Map<string, string> | null = null;
  try {
    const pcaRaw = await fs.readFile(PCA_PATH, "utf-8");
    const pcaData = JSON.parse(pcaRaw);
    const transform: PCATransform = pcaData.transform;
    chunkColors = computeChunkColors(embeddings, transform);
    console.log(`Computed PCA-based colors for ${chunkColors.size} chunks`);
  } catch {
    console.warn("PCA transform not found at", PCA_PATH, "— colors will use hash fallback");
  }

  // 3. Strip embedding vectors, add pre-computed colors
  const stripped = embeddings.map(({ embedding: _embedding, ...rest }) => ({
    ...rest,
    ...(chunkColors?.has(rest.id) ? { color: chunkColors.get(rest.id) } : {}),
  }));

  const strippedJson = JSON.stringify(stripped);
  await fs.writeFile(path.join(OUTPUT_DIR, "chunks-embeddings.json"), strippedJson, "utf-8");
  const strippedKB = (Buffer.byteLength(strippedJson) / 1024).toFixed(1);
  const savedKB = ((Buffer.byteLength(JSON.stringify(embeddings)) - Buffer.byteLength(strippedJson)) / 1024).toFixed(1);
  console.log(`chunks-embeddings.json (${strippedKB} KB, saved ${savedKB} KB by stripping vectors, ${stripped.length} chunks)`);

  // 4. Copy pre-computed UMAP layout
  try {
    const layout = await fs.readFile(LAYOUT_PATH, "utf-8");
    await fs.writeFile(path.join(OUTPUT_DIR, "chunks-layout.json"), layout, "utf-8");
    const layoutKB = (Buffer.byteLength(layout) / 1024).toFixed(1);
    console.log(`chunks-layout.json (${layoutKB} KB)`);
  } catch {
    throw new Error(
      `data/chunks-layout.json not found. Open ChunksView in the app first to generate it, ` +
      `then re-run this script.`
    );
  }

  // 5. Copy nodes from offline cache
  for (const filename of ["nodes-chunk.json", "nodes-article.json"]) {
    try {
      const data = await fs.readFile(path.join(OFFLINE_CACHE_DIR, filename), "utf-8");
      await fs.writeFile(path.join(OUTPUT_DIR, filename), data, "utf-8");
      const kb = (Buffer.byteLength(data) / 1024).toFixed(1);
      console.log(`${filename} (${kb} KB)`);
    } catch {
      throw new Error(
        `data/offline-cache/${filename} not found. Run download-offline-data.ts first.`
      );
    }
  }

  // Summary
  const files = await fs.readdir(OUTPUT_DIR);
  let totalBytes = 0;
  for (const f of files) {
    const stat = await fs.stat(path.join(OUTPUT_DIR, f));
    totalBytes += stat.size;
  }
  console.log(`\nDone! Total: ${(totalBytes / 1024).toFixed(1)} KB in ${OUTPUT_DIR}`);
}

main().catch((err) => {
  console.error("\nError:", err.message);
  process.exit(1);
});
