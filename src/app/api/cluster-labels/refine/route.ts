import { NextRequest, NextResponse } from "next/server";
import { refineClusterLabels, type RefinementRequest } from "@/lib/llm";

export async function POST(request: NextRequest) {
  const { refinements } = await request.json();

  if (!refinements || !Array.isArray(refinements)) {
    return NextResponse.json({ error: "refinements array required" }, { status: 400 });
  }

  // Validate refinement format
  for (const ref of refinements) {
    if (
      typeof ref.id !== "number" ||
      typeof ref.oldLabel !== "string" ||
      !Array.isArray(ref.oldKeywords) ||
      !Array.isArray(ref.newKeywords)
    ) {
      return NextResponse.json(
        { error: "Each refinement must have id, oldLabel, oldKeywords, newKeywords" },
        { status: 400 }
      );
    }
  }

  try {
    const labels = await refineClusterLabels(refinements as RefinementRequest[]);

    // Log refinement decisions
    console.log(`[cluster-labels/refine] Processed ${refinements.length} clusters:`);
    for (const ref of refinements as RefinementRequest[]) {
      const newLabel = labels[ref.id];
      const kept = newLabel === ref.oldLabel;
      const decision = kept ? "KEEP" : "CHANGED";

      // Show keyword diff
      const oldSet = new Set(ref.oldKeywords);
      const newSet = new Set(ref.newKeywords);
      const added = ref.newKeywords.filter(k => !oldSet.has(k));
      const removed = ref.oldKeywords.filter(k => !newSet.has(k));

      console.log(`  [${ref.id}] ${decision}: "${ref.oldLabel}"${kept ? "" : ` -> "${newLabel}"`}`);
      if (added.length > 0 || removed.length > 0) {
        if (added.length > 0) console.log(`       +keywords: ${added.slice(0, 5).join(", ")}${added.length > 5 ? ` (+${added.length - 5} more)` : ""}`);
        if (removed.length > 0) console.log(`       -keywords: ${removed.slice(0, 5).join(", ")}${removed.length > 5 ? ` (+${removed.length - 5} more)` : ""}`);
      }
    }

    return NextResponse.json({ labels });
  } catch (error) {
    console.error("[cluster-labels/refine] Error:", error);
    return NextResponse.json({ error: "Failed to refine labels" }, { status: 500 });
  }
}
