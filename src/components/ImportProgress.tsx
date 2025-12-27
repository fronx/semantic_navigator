"use client";

export interface ImportProgressState {
  phase: "idle" | "importing" | "complete";
  completed: number;
  total: number;
  activeFiles: string[];
  error?: string;
  successful?: number;
  failed?: number;
}

interface Props {
  progress: ImportProgressState;
  onDismiss?: () => void;
}

function ProgressBar({ value, max, className = "" }: { value: number; max: number; className?: string }) {
  const percent = max > 0 ? Math.round((value / max) * 100) : 0;
  return (
    <div className={`h-2 bg-zinc-200 dark:bg-zinc-700 rounded-full overflow-hidden ${className}`}>
      <div
        className="h-full bg-blue-600 transition-all duration-300 ease-out"
        style={{ width: `${percent}%` }}
      />
    </div>
  );
}

export function ImportProgress({ progress, onDismiss }: Props) {
  if (progress.phase === "idle") {
    return null;
  }

  const { completed, total, activeFiles, phase } = progress;

  return (
    <div className="border rounded-lg p-4 bg-white dark:bg-zinc-900 space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="font-medium">
          {phase === "complete" ? "Import Complete" : "Importing..."}
        </h3>
        <div className="flex items-center gap-3">
          {phase === "complete" && progress.successful !== undefined && (
            <span className="text-sm text-zinc-500">
              {progress.successful} successful
              {progress.failed ? `, ${progress.failed} failed` : ""}
            </span>
          )}
          {phase === "complete" && onDismiss && (
            <button
              onClick={onDismiss}
              className="text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300"
              aria-label="Dismiss"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          )}
        </div>
      </div>

      {/* Overall progress */}
      <div>
        <div className="flex justify-between text-sm mb-1">
          <span>Progress</span>
          <span className="text-zinc-500">
            {completed} / {total} files
          </span>
        </div>
        <ProgressBar value={completed} max={total} />
      </div>

      {/* Active files */}
      {phase === "importing" && activeFiles.length > 0 && (
        <div className="text-xs text-zinc-500 space-y-0.5">
          {activeFiles.map((file) => (
            <div key={file} className="truncate">
              {file}
            </div>
          ))}
        </div>
      )}

      {/* Error display */}
      {progress.error && (
        <div className="text-sm text-red-600 dark:text-red-400">
          Error: {progress.error}
        </div>
      )}
    </div>
  );
}
