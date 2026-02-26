// Next.js instrumentation hook - runs once on server startup
// https://nextjs.org/docs/app/building-your-application/optimizing/instrumentation

export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    // Conditional import keeps fs/path out of the Edge bundler's analysis
    const { checkArtifactData, warmupVectorIndexes } = await import("./instrumentation.node");
    await checkArtifactData();
    await warmupVectorIndexes();
  }
}
