import { NextResponse } from "next/server";
import { anthropic } from "@/lib/llm";

/**
 * GET /api/cluster-labels/warm
 *
 * Pre-warms the Anthropic connection by making a minimal request.
 * Call this early (e.g., on page load) so subsequent label requests are faster.
 *
 * Returns immediately after firing the warm-up request (doesn't wait).
 */
export async function GET() {
  // Fire and forget - warm up connection in background
  anthropic.messages
    .create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 1,
      messages: [{ role: "user", content: "." }],
    })
    .catch(() => {
      // Ignore errors - this is just a warm-up
    });

  return NextResponse.json({ status: "warming" });
}
