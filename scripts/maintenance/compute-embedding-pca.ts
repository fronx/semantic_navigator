/**
 * Compute PCA transformation matrix for stable cluster coloring.
 * Projects 256-dim keyword embeddings to 2D for color mapping.
 *
 * Output: public/data/embedding-pca-transform.json
 *
 * Usage: npm run script scripts/maintenance/compute-embedding-pca.ts
 */
import * as fs from "fs";
import * as path from "path";
import { computeEmbeddingPCA } from "../src/lib/embedding-pca";

const OUTPUT_PATH = path.join(
  process.cwd(),
  "public",
  "data",
  "embedding-pca-transform.json"
);

async function main() {
  const output = await computeEmbeddingPCA();

  // Ensure output directory exists
  const outputDir = path.dirname(OUTPUT_PATH);
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  fs.writeFileSync(OUTPUT_PATH, JSON.stringify(output, null, 2));
  console.log(`Wrote PCA transform to: ${OUTPUT_PATH}`);
}

main();
