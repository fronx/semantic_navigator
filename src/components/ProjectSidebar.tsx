"use client";

import { useEffect, useRef, useState } from "react";
import ContentEditable, { ContentEditableEvent } from "react-contenteditable";

export interface Project {
  id: string;
  title: string;
  content: string | null;
  created_at: string;
  updated_at: string;
}

interface ProjectSidebarProps {
  /** The project to display/edit, or null if closed */
  project: Project | null;
  /** Called when user closes the sidebar */
  onClose: () => void;
  /** Called when user updates the project */
  onUpdate: (id: string, updates: { title?: string; content?: string }) => void;
  /** Whether an update is in progress */
  isUpdating?: boolean;
}

/**
 * Right sidebar panel for editing project details.
 * Shows inline-editable title and description fields.
 */
export function ProjectSidebar({
  project,
  onClose,
  onUpdate,
  isUpdating,
}: ProjectSidebarProps) {
  // Local state for immediate feedback while typing
  const [localTitle, setLocalTitle] = useState(project?.title ?? "");
  const [localContent, setLocalContent] = useState(project?.content ?? "");

  // Track whether we have uncommitted changes
  const titleDirty = useRef(false);
  const contentDirty = useRef(false);

  // Sync local state when project changes
  useEffect(() => {
    setLocalTitle(project?.title ?? "");
    setLocalContent(project?.content ?? "");
    titleDirty.current = false;
    contentDirty.current = false;
  }, [project?.id, project?.title, project?.content]);

  // Commit title changes on blur
  const handleTitleBlur = () => {
    if (!project || !titleDirty.current) return;
    const trimmed = localTitle.trim();
    if (trimmed && trimmed !== project.title) {
      onUpdate(project.id, { title: trimmed });
    }
    titleDirty.current = false;
  };

  // Commit content changes on blur
  const handleContentBlur = () => {
    if (!project || !contentDirty.current) return;
    const trimmed = localContent.trim();
    if (trimmed !== (project.content ?? "")) {
      onUpdate(project.id, { content: trimmed || undefined });
    }
    contentDirty.current = false;
  };

  const handleTitleChange = (e: ContentEditableEvent) => {
    // Strip HTML tags and get plain text
    const text = e.target.value.replace(/<[^>]*>/g, "");
    setLocalTitle(text);
    titleDirty.current = true;
  };

  const handleContentChange = (e: ContentEditableEvent) => {
    // Strip HTML tags and get plain text
    const text = e.target.value.replace(/<[^>]*>/g, "");
    setLocalContent(text);
    contentDirty.current = true;
  };

  // Handle Enter key in title (should blur, not add newline)
  const handleTitleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      e.preventDefault();
      (e.target as HTMLElement).blur();
    }
  };

  if (!project) {
    return null;
  }

  return (
    <div className="w-72 border-l border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-zinc-200 dark:border-zinc-800">
        <span className="text-xs font-medium text-zinc-500 dark:text-zinc-400 uppercase tracking-wide">
          Project
        </span>
        <button
          onClick={onClose}
          className="p-1 hover:bg-zinc-100 dark:hover:bg-zinc-800 rounded text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300"
          title="Close sidebar"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-3 space-y-4">
        {/* Title */}
        <div className="space-y-1">
          <label className="text-xs font-medium text-zinc-500 dark:text-zinc-400 uppercase tracking-wide">
            Title
          </label>
          <ContentEditable
            html={localTitle}
            onChange={handleTitleChange}
            onBlur={handleTitleBlur}
            onKeyDown={handleTitleKeyDown}
            className="
              block w-full px-2 py-1.5 rounded
              text-sm font-medium text-zinc-900 dark:text-zinc-100
              bg-zinc-50 dark:bg-zinc-800
              border border-transparent
              hover:border-zinc-300 dark:hover:border-zinc-600
              focus:border-amber-500 focus:ring-1 focus:ring-amber-500
              outline-none transition-colors cursor-text
            "
          />
        </div>

        {/* Description */}
        <div className="space-y-1">
          <label className="text-xs font-medium text-zinc-500 dark:text-zinc-400 uppercase tracking-wide">
            Description
          </label>
          <ContentEditable
            html={localContent}
            onChange={handleContentChange}
            onBlur={handleContentBlur}
            className="
              block w-full px-2 py-1.5 rounded min-h-[120px]
              text-sm text-zinc-700 dark:text-zinc-300
              bg-zinc-50 dark:bg-zinc-800
              border border-transparent
              hover:border-zinc-300 dark:hover:border-zinc-600
              focus:border-amber-500 focus:ring-1 focus:ring-amber-500
              outline-none transition-colors cursor-text
              whitespace-pre-wrap
            "
          />
          <p className="text-[10px] text-zinc-400 dark:text-zinc-500">
            Describe the project to help with semantic matching
          </p>
        </div>

        {/* Status */}
        {isUpdating && (
          <div className="text-xs text-zinc-500 dark:text-zinc-400 flex items-center gap-1.5">
            <svg className="w-3 h-3 animate-spin" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
            </svg>
            Saving...
          </div>
        )}

        {/* Metadata */}
        <div className="pt-4 border-t border-zinc-200 dark:border-zinc-800 space-y-1 text-[10px] text-zinc-400 dark:text-zinc-500">
          <p>Created: {new Date(project.created_at).toLocaleDateString()}</p>
          <p>Updated: {new Date(project.updated_at).toLocaleDateString()}</p>
        </div>
      </div>
    </div>
  );
}
