import { SupabaseClient } from "@supabase/supabase-js";
import { Node, NodeType } from "./types";

/**
 * Defines the fields that constitute unique identity for each node type.
 * This is the single source of truth for node identity - used by both
 * ingestion (to check for existing nodes) and deduplication (to find duplicates).
 */
export const nodeIdentityKeys: Record<NodeType, readonly (keyof Node)[]> = {
  article: ["source_path"],
  chunk: ["source_path", "content_hash"],  // Content-based identity within article
  project: ["title"],  // Projects identified by unique title
} as const;

type IdentityValues = Partial<Record<keyof Node, string>>;

/**
 * Find an existing node by its identity keys.
 * Returns the node if found, null otherwise.
 */
export async function findExistingNode(
  supabase: SupabaseClient,
  nodeType: NodeType,
  values: IdentityValues
): Promise<Node | null> {
  const keys = nodeIdentityKeys[nodeType];

  let query = supabase
    .from("nodes")
    .select("*")
    .eq("node_type", nodeType);

  for (const key of keys) {
    const value = values[key];
    if (value === undefined) {
      throw new Error(`Missing identity key "${key}" for node type "${nodeType}"`);
    }
    query = query.eq(key, value);
  }

  const { data } = await query.single();
  return data as Node | null;
}

/**
 * Generate a unique identity key string for grouping nodes.
 * Used by deduplication to group nodes that should be the same.
 */
export function getIdentityKey(node: Pick<Node, "node_type" | "source_path" | "content_hash" | "title">): string {
  const keys = nodeIdentityKeys[node.node_type];
  const values = keys.map(k => node[k as keyof typeof node]);
  return values.join("::");
}

/**
 * Group nodes by their identity key.
 * Returns a map from identity key to list of nodes with that identity.
 * Nodes are sorted by created_at ascending (oldest first).
 */
export function groupByIdentity<T extends Pick<Node, "node_type" | "source_path" | "content_hash" | "title">>(
  nodes: T[]
): Map<string, T[]> {
  const groups = new Map<string, T[]>();

  for (const node of nodes) {
    const key = getIdentityKey(node);
    const existing = groups.get(key) || [];
    existing.push(node);
    groups.set(key, existing);
  }

  return groups;
}
