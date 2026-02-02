"use client";

interface Props {
  message: string | null;
  onDismiss?: () => void;
}

interface ParsedError {
  type?: string;
  message: string;
}

/**
 * Try to extract a structured error from a raw message.
 * Handles various formats:
 * - Plain JSON: {"message": "..."}
 * - Nested: {"error": {"type": "...", "message": "..."}}
 * - Prefixed: "400 {...json...}"
 * - Plain text (returns null)
 */
function parseErrorMessage(raw: string): ParsedError | null {
  // Find where JSON might start
  const jsonStart = raw.indexOf("{");
  if (jsonStart === -1) return null;

  // Try to parse from there
  const jsonCandidate = raw.slice(jsonStart);
  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonCandidate);
  } catch {
    return null;
  }

  if (typeof parsed !== "object" || parsed === null) return null;

  // Recursively search for a "message" field
  function findMessage(obj: unknown, depth = 0): ParsedError | null {
    if (depth > 3 || typeof obj !== "object" || obj === null) return null;

    const record = obj as Record<string, unknown>;

    // Check if this level has a message
    if (typeof record.message === "string") {
      return {
        type: typeof record.type === "string" ? record.type : undefined,
        message: record.message,
      };
    }

    // Check nested "error" field (common pattern)
    if (record.error) {
      const nested = findMessage(record.error, depth + 1);
      if (nested) return nested;
    }

    return null;
  }

  return findMessage(parsed);
}

function ErrorContent({ message }: { message: string }) {
  const parsed = parseErrorMessage(message);

  if (parsed) {
    return (
      <div className="flex-1 space-y-1">
        {parsed.type && (
          <span className="text-xs text-zinc-400 font-mono">{parsed.type}</span>
        )}
        <p className="text-sm">{parsed.message}</p>
      </div>
    );
  }

  return <span className="text-sm flex-1">{message}</span>;
}

export function ErrorBanner({ message, onDismiss }: Props) {
  if (!message) return null;

  return (
    <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-50 max-w-lg">
      <div className="bg-zinc-800 dark:bg-zinc-700 text-zinc-100 px-4 py-3 rounded-lg shadow-lg flex items-start gap-3">
        <svg
          className="w-5 h-5 text-amber-400 flex-shrink-0 mt-0.5"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
          />
        </svg>
        <ErrorContent message={message} />
        {onDismiss && (
          <button
            onClick={onDismiss}
            className="text-zinc-400 hover:text-zinc-200 flex-shrink-0"
            aria-label="Dismiss"
          >
            <svg
              className="w-4 h-4"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M6 18L18 6M6 6l12 12"
              />
            </svg>
          </button>
        )}
      </div>
    </div>
  );
}
