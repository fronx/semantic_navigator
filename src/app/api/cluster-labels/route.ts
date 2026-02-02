import { NextRequest, NextResponse } from "next/server";
import { generateClusterLabels } from "@/lib/llm";
import { errorResponse } from "@/lib/api-error";

export async function POST(request: NextRequest) {
  const { clusters } = await request.json();

  if (!clusters || !Array.isArray(clusters)) {
    return NextResponse.json({ error: "clusters array required" }, { status: 400 });
  }

  // Validate cluster format
  for (const cluster of clusters) {
    if (typeof cluster.id !== "number" || !Array.isArray(cluster.keywords)) {
      return NextResponse.json(
        { error: "Each cluster must have numeric id and keywords array" },
        { status: 400 }
      );
    }
  }

  try {
    const labels = await generateClusterLabels(clusters);
    return NextResponse.json({ labels });
  } catch (error) {
    console.error("[cluster-labels] Error generating labels:", error);
    return errorResponse(error);
  }
}
