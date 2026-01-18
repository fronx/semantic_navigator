import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase";

// GET /api/projects/[id]/associations - List associations for a project
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const supabase = createServerClient();

  const { data, error } = await supabase
    .from("project_associations")
    .select("id, target_id, association_type, created_at")
    .eq("project_id", id);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // Enrich with target node info
  if (data && data.length > 0) {
    const targetIds = data.map((a) => a.target_id);
    const { data: targets } = await supabase
      .from("nodes")
      .select("id, title, node_type, source_path, summary")
      .in("id", targetIds);

    const targetMap = new Map(targets?.map((t) => [t.id, t]) || []);
    const enriched = data.map((a) => ({
      ...a,
      target: targetMap.get(a.target_id) || null,
    }));

    return NextResponse.json(enriched);
  }

  return NextResponse.json(data);
}

// POST /api/projects/[id]/associations - Add an association
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: projectId } = await params;
  const { targetId, associationType } = await request.json();

  if (!targetId) {
    return NextResponse.json({ error: "targetId is required" }, { status: 400 });
  }

  const type = associationType || "contains";
  if (type !== "contains" && type !== "references") {
    return NextResponse.json(
      { error: "associationType must be 'contains' or 'references'" },
      { status: 400 }
    );
  }

  const supabase = createServerClient();

  // Verify project exists
  const { data: project } = await supabase
    .from("nodes")
    .select("id")
    .eq("id", projectId)
    .eq("node_type", "project")
    .single();

  if (!project) {
    return NextResponse.json({ error: "Project not found" }, { status: 404 });
  }

  // Verify target exists
  const { data: target } = await supabase
    .from("nodes")
    .select("id, node_type")
    .eq("id", targetId)
    .single();

  if (!target) {
    return NextResponse.json({ error: "Target node not found" }, { status: 404 });
  }

  // Prevent self-reference
  if (projectId === targetId) {
    return NextResponse.json(
      { error: "A project cannot reference itself" },
      { status: 400 }
    );
  }

  // Create association
  const { data: association, error } = await supabase
    .from("project_associations")
    .insert({
      project_id: projectId,
      target_id: targetId,
      association_type: type,
    })
    .select()
    .single();

  if (error) {
    if (error.code === "23505") {
      return NextResponse.json(
        { error: "Association already exists" },
        { status: 409 }
      );
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json(association, { status: 201 });
}

// DELETE /api/projects/[id]/associations?targetId=xxx - Remove an association
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: projectId } = await params;
  const { searchParams } = new URL(request.url);
  const targetId = searchParams.get("targetId");

  if (!targetId) {
    return NextResponse.json(
      { error: "targetId query parameter is required" },
      { status: 400 }
    );
  }

  const supabase = createServerClient();

  const { error } = await supabase
    .from("project_associations")
    .delete()
    .eq("project_id", projectId)
    .eq("target_id", targetId);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}
