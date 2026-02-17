import { createServerClient } from "@/lib/supabase";
import { NextRequest, NextResponse } from "next/server";

const TABLE = "localstorage_backups";

/** POST - Save current localStorage snapshot to database. */
export async function POST(request: NextRequest): Promise<NextResponse> {
  const data = await request.json();
  if (!data || typeof data !== "object") {
    return NextResponse.json({ error: "Invalid backup data" }, { status: 400 });
  }

  const keys = Object.keys(data);
  const size_bytes = new Blob([JSON.stringify(data)]).size;
  const supabase = await createServerClient();

  const { error } = await supabase.from(TABLE).insert({ data, keys, size_bytes });
  if (error) {
    console.error("Failed to save backup:", error);
    return NextResponse.json({ error: "Failed to save backup" }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}

/** GET - List backups, or fetch a specific one by ?id=. */
export async function GET(request: NextRequest): Promise<NextResponse> {
  const backupId = new URL(request.url).searchParams.get("id");
  const supabase = await createServerClient();

  if (backupId) {
    const { data, error } = await supabase
      .from(TABLE)
      .select("*")
      .eq("id", Number(backupId))
      .single();

    if (error || !data) {
      return NextResponse.json({ error: "Backup not found" }, { status: 404 });
    }
    return NextResponse.json(data);
  }

  const { data, error } = await supabase
    .from(TABLE)
    .select("id, created_at, keys, size_bytes")
    .order("created_at", { ascending: false })
    .limit(50);

  if (error) {
    console.error("Failed to list backups:", error);
    return NextResponse.json({ error: "Failed to list backups" }, { status: 500 });
  }

  return NextResponse.json({ backups: data ?? [] });
}

/** DELETE - Clean up old backups via database RPC. */
export async function DELETE(): Promise<NextResponse> {
  const supabase = await createServerClient();
  const { error } = await supabase.rpc("cleanup_old_localstorage_backups");

  if (error) {
    console.error("Failed to cleanup backups:", error);
    return NextResponse.json({ error: "Failed to cleanup backups" }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}
