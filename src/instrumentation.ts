// Next.js instrumentation hook - runs once on server startup
// https://nextjs.org/docs/app/building-your-application/optimizing/instrumentation

export async function register() {
  // Only run on server, not during build
  if (process.env.NEXT_RUNTIME === "nodejs") {
    await warmupVectorIndexes();
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
