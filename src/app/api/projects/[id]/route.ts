import { createHash } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase";
import { generateEmbeddingsBatched } from "@/lib/embeddings";

function hash(content: string): string {
  return createHash("sha256").update(content).digest("hex").slice(0, 16);
}

// GET /api/projects/[id] - Get a project with its associations
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const supabase = createServerClient();

  // Get the project
  const { data: project, error: projectError } = await supabase
    .from("nodes")
    .select("*")
    .eq("id", id)
    .eq("node_type", "project")
    .single();

  if (projectError) {
    return NextResponse.json({ error: "Project not found" }, { status: 404 });
  }

  // Get associations with target node info
  const { data: associations } = await supabase
    .from("project_associations")
    .select("id, target_id, association_type, created_at")
    .eq("project_id", id);

  // Fetch target node details
  type EnrichedTarget = {
    id: string;
    title: string | null;
    node_type: string | null;
    source_path: string | null;
    summary: string | null;
    association_id: string;
    association_type: string;
  };
  let targets: EnrichedTarget[] = [];

  if (associations && associations.length > 0) {
    const targetIds = associations.map((a) => a.target_id);
    const { data: targetNodes } = await supabase
      .from("nodes")
      .select("id, title, node_type, source_path, summary")
      .in("id", targetIds);

    if (targetNodes) {
      const assocMap = new Map(
        associations.map((a) => [a.target_id, a])
      );
      targets = targetNodes.map((node) => {
        const assoc = assocMap.get(node.id)!;
        return {
          ...node,
          association_id: assoc.id,
          association_type: assoc.association_type,
        };
      });
    }
  }

  return NextResponse.json({ project, associations: targets });
}

// PUT /api/projects/[id] - Update a project
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const { title, content } = await request.json();

  if (!title || typeof title !== "string" || title.trim().length === 0) {
    return NextResponse.json({ error: "Title is required" }, { status: 400 });
  }

  const supabase = createServerClient();

  // Check project exists
  const { data: existing } = await supabase
    .from("nodes")
    .select("id")
    .eq("id", id)
    .eq("node_type", "project")
    .single();

  if (!existing) {
    return NextResponse.json({ error: "Project not found" }, { status: 404 });
  }

  // Check for title conflict with other projects
  const { data: conflict } = await supabase
    .from("nodes")
    .select("id")
    .eq("node_type", "project")
    .eq("title", title.trim())
    .neq("id", id)
    .single();

  if (conflict) {
    return NextResponse.json(
      { error: "Another project with this title already exists" },
      { status: 409 }
    );
  }

  // Regenerate embedding
  const embeddingText = `${title}\n\n${content || ""}`.trim();
  const [embedding] = await generateEmbeddingsBatched([embeddingText]);

  const { data: project, error } = await supabase
    .from("nodes")
    .update({
      title: title.trim(),
      content: content || null,
      content_hash: hash(embeddingText),
      embedding: JSON.stringify(embedding),
    })
    .eq("id", id)
    .select()
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json(project);
}

// DELETE /api/projects/[id] - Delete a project
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const supabase = createServerClient();

  // Delete the project (associations cascade via FK)
  const { error } = await supabase
    .from("nodes")
    .delete()
    .eq("id", id)
    .eq("node_type", "project");

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}
