/**
 * Reusable collapsible sidebar shell.
 * Provides the outer container with collapse toggle; content is supplied via children.
 */

import type { ReactElement, ReactNode } from "react";

interface CollapsibleSidebarProps {
  collapsed: boolean;
  onToggle: () => void;
  children: ReactNode;
  /** Width class when expanded (default: "w-72") */
  width?: string;
}

export function CollapsibleSidebar({
  collapsed,
  onToggle,
  children,
  width = "w-72",
}: CollapsibleSidebarProps): ReactElement {
  return (
    <div
      className={`
        flex-shrink-0 bg-white dark:bg-zinc-900 border-r border-zinc-200 dark:border-zinc-700
        transition-all duration-200 ease-in-out overflow-hidden
        ${collapsed ? "w-10" : width}
      `}
    >
      <button
        onClick={onToggle}
        className="w-full h-10 flex items-center justify-center border-b border-zinc-200 dark:border-zinc-700 hover:bg-zinc-100 dark:hover:bg-zinc-800"
        title={collapsed ? "Expand controls" : "Collapse controls"}
      >
        <span className="text-zinc-500 text-sm">{collapsed ? "\u00BB" : "\u00AB"}</span>
      </button>

      {!collapsed && (
        <div className="overflow-y-auto h-[calc(100%-40px)]">
          {children}
        </div>
      )}
    </div>
  );
}
