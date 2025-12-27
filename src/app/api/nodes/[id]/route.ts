import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const supabase = createServerClient();

  // Get the node
  const { data: node, error: nodeError } = await supabase
    .from("nodes")
    .select("*")
    .eq("id", id)
    .single();

  if (nodeError) {
    return NextResponse.json({ error: nodeError.message }, { status: 404 });
  }

  // Get children via containment edges
  const { data: childEdges } = await supabase
    .from("containment_edges")
    .select("child_id, position")
    .eq("parent_id", id)
    .order("position");

  let children = null;
  if (childEdges && childEdges.length > 0) {
    const childIds = childEdges.map((e) => e.child_id);
    const { data: childNodes } = await supabase
      .from("nodes")
      .select("*")
      .in("id", childIds);

    // Sort by position
    const positionMap = new Map(childEdges.map((e) => [e.child_id, e.position]));
    children = childNodes?.sort(
      (a, b) => (positionMap.get(a.id) || 0) - (positionMap.get(b.id) || 0)
    );
  }

  // Get parent
  const { data: parentEdge } = await supabase
    .from("containment_edges")
    .select("parent_id")
    .eq("child_id", id)
    .single();

  let parent = null;
  if (parentEdge) {
    const { data: parentNode } = await supabase
      .from("nodes")
      .select("id, node_type, summary, source_path")
      .eq("id", parentEdge.parent_id)
      .single();
    parent = parentNode;
  }

  // Get backlinks (nodes that link to this one)
  const { data: incomingLinks } = await supabase
    .from("backlink_edges")
    .select("source_id, link_text")
    .eq("target_id", id);

  let backlinks = null;
  if (incomingLinks && incomingLinks.length > 0) {
    const sourceIds = incomingLinks.map((l) => l.source_id);
    const { data: sourceNodes } = await supabase
      .from("nodes")
      .select("id, node_type, summary, source_path")
      .in("id", sourceIds);
    backlinks = sourceNodes;
  }

  return NextResponse.json({ node, children, parent, backlinks });
}
