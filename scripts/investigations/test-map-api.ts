async function testMapApi() {
  const res = await fetch("http://localhost:3000/api/map");
  const data = await res.json();

  console.log("Nodes:", data.nodes.length);
  console.log("Edges:", data.edges.length);

  const articles = data.nodes.filter((n: { type: string }) => n.type === "article");
  const keywords = data.nodes.filter((n: { type: string }) => n.type === "keyword");
  console.log("  Articles:", articles.length);
  console.log("  Keywords:", keywords.length);

  const kwEdges = data.edges.filter(
    (e: { source: string; target: string }) =>
      e.source.startsWith("kw:") && e.target.startsWith("kw:")
  );
  console.log("Keyword-keyword edges:", kwEdges.length);

  const withSim = kwEdges.filter((e: { similarity?: number }) => e.similarity !== undefined);
  console.log("  With similarity score:", withSim.length);

  // Check similarity distribution
  const sims = withSim.map((e: { similarity: number }) => e.similarity).sort((a: number, b: number) => b - a);
  if (sims.length > 0) {
    console.log("  Max similarity:", sims[0].toFixed(3));
    console.log("  Min similarity:", sims[sims.length - 1].toFixed(3));
    console.log("  Median:", sims[Math.floor(sims.length / 2)].toFixed(3));
  }
}

testMapApi().catch(console.error);
