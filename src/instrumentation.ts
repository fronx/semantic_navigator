// Next.js instrumentation hook - runs once on server startup
// https://nextjs.org/docs/app/building-your-application/optimizing/instrumentation

export async function register() {
  // Only run on server, not during build
  if (process.env.NEXT_RUNTIME === "nodejs") {
    await checkArtifactData();
    await warmupVectorIndexes();
  }
}

const ARTIFACT_FILES = [
  "chunks-embeddings.json",
  "chunks-layout.json",
  "nodes-chunk.json",
  "nodes-article.json",
];

async function checkArtifactData() {
  const { promises: fs } = await import("fs");
  const path = await import("path");
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

async function warmupVectorIndexes() {
  const { createServerClient } = await import("@/lib/supabase");

  // Create a dummy embedding (all zeros) just to force index load
  const dummyEmbedding = new Array(1536).fill(0);

  const supabase = createServerClient();
  const start = performance.now();

  // Warm up nodes embedding index
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error: nodeErr } = await (supabase.rpc as any)("test_node_search", {
    query_embedding: dummyEmbedding,
    match_count: 1,
  });

  // Warm up keywords embedding index
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
