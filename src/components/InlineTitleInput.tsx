"use client";

import { useEffect, useRef, useState } from "react";

export interface InlineTitleInputProps {
  /** Position in screen coordinates (pixels from top-left of container) */
  screenPosition: { x: number; y: number };
  /** Called when user confirms the title (Enter key) */
  onConfirm: (title: string) => void;
  /** Called when user cancels (Escape key or clicks outside) */
  onCancel: () => void;
}

/**
 * Floating input field for entering a project title at a specific screen position.
 * Auto-focuses on mount, confirms on Enter, cancels on Escape.
 */
export function InlineTitleInput({
  screenPosition,
  onConfirm,
  onCancel,
}: InlineTitleInputProps) {
  const [value, setValue] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  // Auto-focus on mount
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      e.preventDefault();
      const trimmed = value.trim();
      if (trimmed) {
        onConfirm(trimmed);
      }
    } else if (e.key === "Escape") {
      e.preventDefault();
      onCancel();
    }
  };

  const handleBlur = () => {
    // Cancel on blur (clicking outside)
    onCancel();
  };

  return (
    <div
      className="absolute z-50 pointer-events-auto"
      style={{
        left: screenPosition.x,
        top: screenPosition.y,
        transform: "translate(-50%, -50%)",
      }}
    >
      <input
        ref={inputRef}
        type="text"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={handleKeyDown}
        onBlur={handleBlur}
        placeholder="Project title..."
        className="
          px-3 py-1.5 rounded-lg
          bg-white dark:bg-zinc-800
          border border-zinc-300 dark:border-zinc-600
          text-sm text-zinc-900 dark:text-zinc-100
          placeholder:text-zinc-400 dark:placeholder:text-zinc-500
          shadow-lg
          outline-none focus:ring-2 focus:ring-amber-500 focus:border-amber-500
          min-w-[200px]
        "
      />
    </div>
  );
}
