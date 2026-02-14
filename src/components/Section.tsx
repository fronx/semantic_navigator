import type { ReactElement, ReactNode } from "react";

interface SectionProps {
  title: string;
  isOpen: boolean;
  onToggle: () => void;
  children: ReactNode;
}

export function Section({ title, isOpen, onToggle, children }: SectionProps): ReactElement {
  return (
    <div className="border-b border-zinc-200 dark:border-zinc-700">
      <button
        onClick={onToggle}
        className="w-full px-3 py-2 text-left text-[11px] uppercase tracking-wider font-semibold text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800 flex items-center justify-between"
      >
        <span>{title}</span>
        <span className="text-[10px]">{isOpen ? "−" : "+"}</span>
      </button>
      {isOpen && <div className="px-3 pb-3 space-y-2">{children}</div>}
    </div>
  );
}
