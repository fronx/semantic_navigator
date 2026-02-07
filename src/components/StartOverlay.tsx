"use client";

export function StartOverlay({ onStart }: { onStart: () => void }) {
  return (
    <div className="start-overlay" onClick={onStart}>
      <button className="start-overlay-btn" aria-label="Start">
        <svg viewBox="0 0 24 24" fill="currentColor" width="48" height="48">
          <path d="M8 5v14l11-7z" />
        </svg>
      </button>
    </div>
  );
}
