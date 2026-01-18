"use client";

import { useEffect, useState, useRef } from "react";

export interface Project {
  id: string;
  title: string;
  summary: string | null;
}

interface Props {
  selectedProject: Project | null;
  onSelect: (project: Project | null) => void;
}

export function ProjectSelector({ selectedProject, onSelect }: Props) {
  const [projects, setProjects] = useState<Project[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const containerRef = useRef<HTMLDivElement>(null);

  // Fetch projects on mount
  useEffect(() => {
    fetch("/api/projects")
      .then((r) => r.json())
      .then((data) => {
        setProjects(data || []);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  // Close dropdown on outside click
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const displayText = selectedProject?.title || "All Topics";

  return (
    <div ref={containerRef} className="relative">
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-1.5 px-2 py-1 text-sm font-medium text-zinc-700 dark:text-zinc-300
                   bg-zinc-100 dark:bg-zinc-800 hover:bg-zinc-200 dark:hover:bg-zinc-700
                   border border-zinc-200 dark:border-zinc-700 rounded transition-colors"
        disabled={loading}
      >
        <span className="max-w-[150px] truncate">{loading ? "Loading..." : displayText}</span>
        <svg
          className={`w-3.5 h-3.5 transition-transform ${open ? "rotate-180" : ""}`}
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {open && (
        <div
          className="absolute z-50 top-full left-0 mt-1 min-w-[200px] max-h-[300px] overflow-y-auto
                     bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700
                     rounded shadow-lg"
        >
          {/* "All Topics" option to clear filter */}
          <button
            onClick={() => {
              onSelect(null);
              setOpen(false);
            }}
            className={`w-full text-left px-3 py-2 text-sm hover:bg-zinc-100 dark:hover:bg-zinc-700
                       ${!selectedProject ? "bg-zinc-100 dark:bg-zinc-700 font-medium" : ""}`}
          >
            All Topics
          </button>

          {projects.length > 0 && (
            <div className="border-t border-zinc-200 dark:border-zinc-700" />
          )}

          {projects.map((project) => (
            <button
              key={project.id}
              onClick={() => {
                onSelect(project);
                setOpen(false);
              }}
              className={`w-full text-left px-3 py-2 text-sm hover:bg-zinc-100 dark:hover:bg-zinc-700
                         ${selectedProject?.id === project.id ? "bg-zinc-100 dark:bg-zinc-700 font-medium" : ""}`}
            >
              <div className="truncate">{project.title}</div>
              {project.summary && (
                <div className="text-xs text-zinc-500 dark:text-zinc-400 truncate mt-0.5">
                  {project.summary}
                </div>
              )}
            </button>
          ))}

          {projects.length === 0 && !loading && (
            <div className="px-3 py-2 text-sm text-zinc-500 dark:text-zinc-400">
              No projects yet
            </div>
          )}
        </div>
      )}
    </div>
  );
}
