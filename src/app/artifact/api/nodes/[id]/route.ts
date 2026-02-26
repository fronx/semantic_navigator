import { NextRequest } from "next/server";
import { loadNodes, missingDataResponse } from "@/app/artifact/artifact-data";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const nodes = await loadNodes();
  if (!nodes) return missingDataResponse();
  const { chunkNodes, articleNodes } = nodes;

  const chunk = chunkNodes.find((n) => n.id === id);
  if (chunk) {
    const parent = articleNodes.find((a) => a.source_path === chunk.source_path) ?? null;
    return Response.json({ node: chunk, children: null, parent, backlinks: null });
  }

  const article = articleNodes.find((n) => n.id === id);
  if (article) {
    const children = chunkNodes
      .filter((c) => c.source_path === article.source_path)
      .map((c) => ({ ...c, keywords: [], similarKeywords: [] }));
    return Response.json({ node: article, children, parent: null, backlinks: null });
  }

  return new Response(null, { status: 404 });
}
