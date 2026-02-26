// Artifact: recluster is disabled (pre-computed static layout).
// Return empty object so ChunksView's `if (data.coarseClusters)` guard
// leaves the existing cached layout unchanged.
export async function POST() {
  return Response.json({});
}
