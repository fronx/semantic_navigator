import { createHash } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase";
import { generateEmbeddingsBatched } from "@/lib/embeddings";

function hash(content: string): string {
  return createHash("sha256").update(content).digest("hex").slice(0, 16);
}

// GET /api/projects - List all projects
export async function GET() {
  const supabase = createServerClient();

  const { data, error } = await supabase
    .from("nodes")
    .select("id, title, summary, content, created_at, updated_at")
    .eq("node_type", "project")
    .order("updated_at", { ascending: false });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json(data);
}

// POST /api/projects - Create a new project
export async function POST(request: NextRequest) {
  const { title, content, position_x, position_y } = await request.json();

  if (!title || typeof title !== "string" || title.trim().length === 0) {
    return NextResponse.json({ error: "Title is required" }, { status: 400 });
  }

  const supabase = createServerClient();

  // Check for existing project with same title
  const { data: existing } = await supabase
    .from("nodes")
    .select("id")
    .eq("node_type", "project")
    .eq("title", title.trim())
    .single();

  if (existing) {
    return NextResponse.json(
      { error: "A project with this title already exists" },
      { status: 409 }
    );
  }

  // Generate embedding from title + content for semantic search
  const embeddingText = `${title}\n\n${content || ""}`.trim();
  const [embedding] = await generateEmbeddingsBatched([embeddingText]);

  const { data: project, error } = await supabase
    .from("nodes")
    .insert({
      title: title.trim(),
      content: content || null,
      content_hash: hash(embeddingText),
      embedding: JSON.stringify(embedding),
      node_type: "project",
      source_path: null,
      provenance: "user",
      dirty: false,
      position_x: typeof position_x === "number" ? position_x : null,
      position_y: typeof position_y === "number" ? position_y : null,
    })
    .select()
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json(project, { status: 201 });
}
