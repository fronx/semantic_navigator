/**
 * A/B slider toggle for switching between Articles and Chunks granularity
 */

interface GranularityToggleProps {
  value: 'article' | 'chunk';
  onChange: (value: 'article' | 'chunk') => void;
}

export function GranularityToggle({ value, onChange }: GranularityToggleProps) {
  return (
    <div className="inline-flex items-center gap-2">
      <span className="text-xs text-zinc-500 dark:text-zinc-400">View:</span>
      <div className="relative inline-flex bg-zinc-100 dark:bg-zinc-800 rounded-lg p-0.5 shadow-sm border border-zinc-200 dark:border-zinc-700">
        {/* Sliding background pill */}
        <div
          className={`absolute top-0.5 bottom-0.5 w-[calc(50%-2px)] bg-white dark:bg-zinc-700 rounded-md shadow-sm transition-transform duration-200 ease-out ${
            value === 'chunk' ? 'translate-x-[calc(100%+4px)]' : 'translate-x-0'
          }`}
        />

        {/* Article button */}
        <button
          onClick={() => onChange('article')}
          className={`relative z-10 px-3 py-1 text-xs font-medium rounded-md transition-colors duration-200 ${
            value === 'article'
              ? 'text-zinc-900 dark:text-zinc-100'
              : 'text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100'
          }`}
        >
          Articles
        </button>

        {/* Chunk button */}
        <button
          onClick={() => onChange('chunk')}
          className={`relative z-10 px-3 py-1 text-xs font-medium rounded-md transition-colors duration-200 ${
            value === 'chunk'
              ? 'text-zinc-900 dark:text-zinc-100'
              : 'text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100'
          }`}
        >
          Chunks
        </button>
      </div>
    </div>
  );
}
