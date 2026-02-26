// Node.js-only instrumentation — imported conditionally from instrumentation.ts
// Static imports here are safe because this file is never analyzed by the Edge bundler.
import { promises as fs } from "fs";
import path from "path";

const ARTIFACT_FILES = [
  "chunks-embeddings.json",
  "chunks-layout.json",
  "nodes-chunk.json",
  "nodes-article.json",
];

export async function checkArtifactData() {
  const dir = path.join(process.cwd(), "data", "artifact");
  const missing: string[] = [];

  console.log("[artifact] Checking data files:");
  for (const file of ARTIFACT_FILES) {
    try {
      const stat = await fs.stat(path.join(dir, file));
      const kb = Math.round(stat.size / 1024);
      console.log(`[artifact]   ${file.padEnd(28)} ${kb} KB`);
    } catch {
      console.log(`[artifact]   ${file.padEnd(28)} MISSING`);
      missing.push(file);
    }
  }

  if (missing.length > 0) {
    const msg =
      `[artifact] ${missing.length} file(s) missing — /artifact will not work.\n` +
      `[artifact] Run: npm run script scripts/generate-artifact-data.ts`;
    if (process.env.NODE_ENV === "production") {
      throw new Error(msg);
    }
    console.warn(msg);
  } else {
    console.log("[artifact] All files present.");
  }
}

export async function warmupVectorIndexes() {
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL) {
    console.log("[warmup] Skipping — no Supabase credentials configured");
    return;
  }

  const { createServerClient } = await import("@/lib/supabase");

  const dummyEmbedding = new Array(1536).fill(0);
  const supabase = createServerClient();
  const start = performance.now();

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error: nodeErr } = await (supabase.rpc as any)("test_node_search", {
    query_embedding: dummyEmbedding,
    match_count: 1,
  });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error: kwErr } = await (supabase.rpc as any)("test_keyword_search", {
    query_embedding: dummyEmbedding,
    match_count: 1,
  });

  const elapsed = (performance.now() - start).toFixed(0);

  if (nodeErr || kwErr) {
    console.log(`[warmup] Index warmup failed (${elapsed}ms):`, nodeErr?.message || kwErr?.message);
  } else {
    console.log(`[warmup] Vector indexes warmed up in ${elapsed}ms`);
  }
}
