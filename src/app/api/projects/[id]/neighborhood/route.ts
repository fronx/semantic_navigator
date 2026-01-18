import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase";

// GET /api/projects/[id]/neighborhood?hops=2 - Get keyword neighborhood for a project
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: projectId } = await params;
  const { searchParams } = new URL(request.url);
  const hops = parseInt(searchParams.get("hops") || "2", 10);

  if (hops < 0 || hops > 5) {
    return NextResponse.json(
      { error: "hops must be between 0 and 5" },
      { status: 400 }
    );
  }

  const supabase = createServerClient();

  // Verify project exists
  const { data: project } = await supabase
    .from("nodes")
    .select("id, title")
    .eq("id", projectId)
    .eq("node_type", "project")
    .single();

  if (!project) {
    return NextResponse.json({ error: "Project not found" }, { status: 404 });
  }

  // Call the SQL function to expand neighborhood
  const { data, error } = await supabase.rpc("get_project_neighborhood", {
    p_project_id: projectId,
    p_hops: hops,
  });

  if (error) {
    console.error("Neighborhood query error:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // Convert to the format TopicsView expects: keyword labels prefixed with "kw:"
  const keywordIds = new Set<string>();
  const keywordLabels: string[] = [];

  for (const row of data || []) {
    keywordIds.add(row.keyword_id);
    keywordLabels.push(row.keyword_label);
  }

  return NextResponse.json({
    projectId,
    projectTitle: project.title,
    hops,
    keywordCount: keywordIds.size,
    // Return labels for TopicsView filtering (format: "kw:label")
    keywordLabels,
  });
}
