import { promises as fs } from "fs";
import path from "path";

export const DATA_DIR = path.join(process.cwd(), "data", "artifact");

export function missingDataResponse() {
  return new Response(
    "Artifact data not found. Run: npm run script scripts/generate-artifact-data.ts",
    { status: 503 }
  );
}

/** Read a file from the artifact data directory and return it as a JSON response. */
export async function readArtifactJson(filename: string): Promise<Response> {
  try {
    const data = await fs.readFile(path.join(DATA_DIR, filename), "utf-8");
    return new Response(data, { headers: { "Content-Type": "application/json" } });
  } catch {
    return missingDataResponse();
  }
}

export interface NodeRecord {
  id: string;
  content: string | null;
  summary: string | null;
  source_path: string | null;
  heading_context: string[] | null;
  chunk_type: string | null;
  node_type: string;
}

// Lazy-loaded cache shared between /nodes/[id] and /reader/articles routes
let chunkNodes: NodeRecord[] | null = null;
let articleNodes: NodeRecord[] | null = null;

export async function loadNodes(): Promise<{ chunkNodes: NodeRecord[]; articleNodes: NodeRecord[] } | null> {
  if (!chunkNodes || !articleNodes) {
    try {
      const [chunksData, articlesData] = await Promise.all([
        fs.readFile(path.join(DATA_DIR, "nodes-chunk.json"), "utf-8"),
        fs.readFile(path.join(DATA_DIR, "nodes-article.json"), "utf-8"),
      ]);
      chunkNodes = (JSON.parse(chunksData) as { nodes: NodeRecord[] }).nodes;
      articleNodes = (JSON.parse(articlesData) as { nodes: NodeRecord[] }).nodes;
    } catch {
      return null;
    }
  }
  return { chunkNodes: chunkNodes!, articleNodes: articleNodes! };
}
