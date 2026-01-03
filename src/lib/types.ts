export type NodeType = "article" | "chunk";

export interface Node {
  id: string;
  content: string | null;  // only populated for chunk nodes
  summary: string | null;
  content_hash: string;
  embedding: number[] | null;
  node_type: NodeType;
  source_path: string;
  header_level: number | null;
  chunk_type: string | null;  // semantic classification for chunks (e.g., "problem statement")
  heading_context: string[] | null;  // heading path for chunks (e.g., ["Introduction", "Background"])
  dirty: boolean;
  created_at: string;
  updated_at: string;
}

export interface ContainmentEdge {
  id: string;
  parent_id: string;
  child_id: string;
  position: number;
  created_at: string;
}

export interface BacklinkEdge {
  id: string;
  source_id: string;
  target_id: string;
  link_text: string | null;
  context: string | null;
  created_at: string;
}

export interface SummaryCache {
  id: string;
  node_id: string;
  zoom_level: number;
  lens: string | null;
  summary: string;
  content_hash: string;
  created_at: string;
}

// Parsed markdown structure
export interface ParsedSection {
  title: string;
  level: number;
  content: string;
  children: ParsedSection[];
  paragraphs: string[];
}

export interface ParsedArticle {
  title: string;
  content: string;
  sections: ParsedSection[];
  backlinks: string[];  // extracted [[wiki-links]]
}

// Vault browsing
export interface VaultEntry {
  name: string;
  path: string;
  type: "file" | "directory";
  size?: number;
  estimatedTokens?: number;
  children?: VaultEntry[];
}

// Import progress
export interface ImportProgress {
  total: number;
  completed: number;
  current: string;
  status: "idle" | "importing" | "complete" | "error";
  error?: string;
}
