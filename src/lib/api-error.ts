/**
 * API error handling utilities.
 * Extracts meaningful error messages from various error types.
 */
import { NextResponse } from "next/server";

/**
 * Extract a user-friendly error message from any error type.
 * Handles Anthropic SDK errors, OpenAI errors, and generic errors.
 */
export function extractErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    // Anthropic SDK errors have nested structure: error.error.message
    const anyError = error as unknown as Record<string, unknown>;
    if (
      "error" in anyError &&
      typeof anyError.error === "object" &&
      anyError.error !== null &&
      "message" in anyError.error &&
      typeof (anyError.error as Record<string, unknown>).message === "string"
    ) {
      return (anyError.error as Record<string, unknown>).message as string;
    }
    return error.message;
  }
  return String(error);
}

/**
 * Create a standardized error response for API routes.
 */
export function errorResponse(error: unknown, status = 500): NextResponse {
  const message = extractErrorMessage(error);
  return NextResponse.json({ error: message }, { status });
}
