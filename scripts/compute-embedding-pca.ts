/**
 * Compute PCA transformation matrix for stable cluster coloring.
 * Projects 256-dim keyword embeddings to 2D for color mapping.
 *
 * Output: public/data/embedding-pca-transform.json
 * Format: { transform: number[][] } where transform is 2×256 matrix
 */
import * as fs from "fs";
import * as path from "path";
import { createServerClient } from "../src/lib/supabase";

const OUTPUT_PATH = path.join(
  process.cwd(),
  "public",
  "data",
  "embedding-pca-transform.json"
);

/**
 * Simple PCA via power iteration.
 * Returns top k principal components as row vectors.
 */
function computePCA(
  data: number[][],
  k: number = 2,
  iterations: number = 100
): number[][] {
  const n = data.length;
  const dim = data[0].length;

  // Center the data (subtract mean)
  const mean = new Array(dim).fill(0);
  for (const row of data) {
    for (let j = 0; j < dim; j++) {
      mean[j] += row[j];
    }
  }
  for (let j = 0; j < dim; j++) {
    mean[j] /= n;
  }

  const centered = data.map((row) => row.map((val, j) => val - mean[j]));

  // Compute covariance matrix (dim × dim)
  // For efficiency, compute X^T * X directly
  console.log("Computing covariance matrix...");
  const cov: number[][] = Array.from({ length: dim }, () => new Array(dim).fill(0));
  for (let i = 0; i < dim; i++) {
    for (let j = i; j < dim; j++) {
      let sum = 0;
      for (let r = 0; r < n; r++) {
        sum += centered[r][i] * centered[r][j];
      }
      cov[i][j] = sum / (n - 1);
      cov[j][i] = cov[i][j]; // Symmetric
    }
  }

  // Power iteration for top k eigenvectors
  const components: number[][] = [];

  for (let c = 0; c < k; c++) {
    console.log(`Computing component ${c + 1}/${k}...`);

    // Random initial vector
    let v = Array.from({ length: dim }, () => Math.random() - 0.5);
    v = normalize(v);

    // Power iteration
    for (let iter = 0; iter < iterations; iter++) {
      // Multiply by covariance matrix
      const newV = new Array(dim).fill(0);
      for (let i = 0; i < dim; i++) {
        for (let j = 0; j < dim; j++) {
          newV[i] += cov[i][j] * v[j];
        }
      }

      // Orthogonalize against previous components (deflation)
      for (const prev of components) {
        const dot = dotProduct(newV, prev);
        for (let i = 0; i < dim; i++) {
          newV[i] -= dot * prev[i];
        }
      }

      v = normalize(newV);
    }

    components.push(v);

    // Deflate covariance matrix
    for (let i = 0; i < dim; i++) {
      for (let j = 0; j < dim; j++) {
        const eigenvalue = dotProduct(
          matVecMul(cov, components[c]),
          components[c]
        );
        cov[i][j] -= eigenvalue * components[c][i] * components[c][j];
      }
    }
  }

  return components;
}

function normalize(v: number[]): number[] {
  let norm = 0;
  for (const x of v) norm += x * x;
  norm = Math.sqrt(norm);
  if (norm === 0) return v;
  return v.map((x) => x / norm);
}

function dotProduct(a: number[], b: number[]): number {
  let sum = 0;
  for (let i = 0; i < a.length; i++) {
    sum += a[i] * b[i];
  }
  return sum;
}

function matVecMul(mat: number[][], vec: number[]): number[] {
  const result = new Array(mat.length).fill(0);
  for (let i = 0; i < mat.length; i++) {
    for (let j = 0; j < vec.length; j++) {
      result[i] += mat[i][j] * vec[j];
    }
  }
  return result;
}

async function main() {
  const supabase = createServerClient();

  // Fetch all keyword embeddings
  console.log("Fetching keyword embeddings...");

  const allEmbeddings: number[][] = [];
  let offset = 0;

  while (true) {
    const { data, error } = await supabase
      .from("keywords")
      .select("embedding_256")
      .not("embedding_256", "is", null)
      .range(offset, offset + 999);

    if (error) {
      console.error("Error fetching embeddings:", error);
      process.exit(1);
    }

    if (!data || data.length === 0) break;

    for (const row of data) {
      if (row.embedding_256) {
        // Supabase returns vector columns as strings, parse if needed
        const emb = typeof row.embedding_256 === "string"
          ? JSON.parse(row.embedding_256)
          : row.embedding_256;
        allEmbeddings.push(emb as number[]);
      }
    }

    console.log(`  Fetched ${allEmbeddings.length} embeddings...`);

    if (data.length < 1000) break;
    offset += 1000;
  }

  if (allEmbeddings.length === 0) {
    console.error("No embeddings found!");
    process.exit(1);
  }

  console.log(`\nTotal: ${allEmbeddings.length} embeddings of dimension ${allEmbeddings[0].length}`);

  // Compute PCA
  console.log("\nComputing PCA...");
  const transform = computePCA(allEmbeddings, 2);

  // Verify orthogonality
  const dot = dotProduct(transform[0], transform[1]);
  console.log(`Component orthogonality check (should be ~0): ${dot.toFixed(6)}`);

  // Project a few embeddings to check range
  console.log("\nSample projections:");
  for (let i = 0; i < Math.min(5, allEmbeddings.length); i++) {
    const x = dotProduct(transform[0], allEmbeddings[i]);
    const y = dotProduct(transform[1], allEmbeddings[i]);
    console.log(`  Sample ${i}: (${x.toFixed(4)}, ${y.toFixed(4)})`);
  }

  // Compute stats on projections
  let minX = Infinity, maxX = -Infinity;
  let minY = Infinity, maxY = -Infinity;
  for (const emb of allEmbeddings) {
    const x = dotProduct(transform[0], emb);
    const y = dotProduct(transform[1], emb);
    minX = Math.min(minX, x);
    maxX = Math.max(maxX, x);
    minY = Math.min(minY, y);
    maxY = Math.max(maxY, y);
  }
  console.log(`\nProjection ranges:`);
  console.log(`  X: [${minX.toFixed(4)}, ${maxX.toFixed(4)}]`);
  console.log(`  Y: [${minY.toFixed(4)}, ${maxY.toFixed(4)}]`);

  // Ensure output directory exists
  const outputDir = path.dirname(OUTPUT_PATH);
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  // Write output
  const output = {
    transform,
    meta: {
      numEmbeddings: allEmbeddings.length,
      embeddingDim: allEmbeddings[0].length,
      computedAt: new Date().toISOString(),
    },
  };

  fs.writeFileSync(OUTPUT_PATH, JSON.stringify(output, null, 2));
  console.log(`\nWrote PCA transform to: ${OUTPUT_PATH}`);
}

main();
