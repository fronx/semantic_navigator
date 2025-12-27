"use client";

import { useState, useEffect } from "react";
import { Node } from "@/lib/types";

interface NodeData {
  node: Node;
  children: Node[] | null;
  parent: { id: string; node_type: string; summary: string | null } | null;
  backlinks: { id: string; node_type: string; summary: string | null }[] | null;
}

interface NodeViewModel {
  id: string;
  nodeType: string;
  sourcePath: string;
  headerLevel: number | null;
  displayText: string;
  preview: string;
}

function toViewModel(node: Node): NodeViewModel {
  const displayText = node.content || node.summary || "";
  const preview = (node.summary || node.content || "").slice(0, 60);

  return {
    id: node.id,
    nodeType: node.node_type,
    sourcePath: node.source_path,
    headerLevel: node.header_level,
    displayText,
    preview,
  };
}

function toPreview(node: { summary?: string | null; content?: string | null; node_type: string }): string {
  return (node.summary || node.content || node.node_type).slice(0, 60);
}

interface Props {
  nodeId: string | null;
  onNavigate: (id: string) => void;
}

export function NodeViewer({ nodeId, onNavigate }: Props) {
  const [data, setData] = useState<NodeData | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (nodeId) {
      fetchNode(nodeId);
    } else {
      setData(null);
    }
  }, [nodeId]);

  async function fetchNode(id: string) {
    setLoading(true);
    const res = await fetch(`/api/nodes/${id}`);
    const nodeData = await res.json();
    setData(nodeData);
    setLoading(false);
  }

  if (!nodeId) {
    return (
      <div className="border rounded-lg p-6 bg-white dark:bg-zinc-900 text-zinc-500 text-center">
        Select a node to view details
      </div>
    );
  }

  if (loading) {
    return (
      <div className="border rounded-lg p-6 bg-white dark:bg-zinc-900 text-zinc-500 text-center">
        Loading...
      </div>
    );
  }

  if (!data) {
    return (
      <div className="border rounded-lg p-6 bg-white dark:bg-zinc-900 text-red-500 text-center">
        Node not found
      </div>
    );
  }

  const { node, children, parent, backlinks } = data;
  const vm = toViewModel(node);
  const childViewModels = children?.map(toViewModel) || [];
  const parentPreview = parent ? toPreview(parent) : null;
  const backlinkPreviews = backlinks?.map((b) => ({ id: b.id, preview: toPreview(b) })) || [];

  return (
    <div className="border rounded-lg bg-white dark:bg-zinc-900 overflow-hidden">
      {/* Header */}
      <div className="p-4 border-b dark:border-zinc-700">
        <div className="flex items-center gap-2 mb-2">
          <span className="text-xs px-2 py-0.5 bg-zinc-200 dark:bg-zinc-700 rounded">
            {vm.nodeType}
          </span>
          {vm.headerLevel && (
            <span className="text-xs text-zinc-500">H{vm.headerLevel}</span>
          )}
        </div>
        <div className="text-xs text-zinc-500">{vm.sourcePath}</div>
      </div>

      {/* Navigation */}
      {parent && (
        <div className="px-4 py-2 border-b dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800">
          <button
            onClick={() => onNavigate(parent.id)}
            className="text-sm text-blue-600 hover:underline"
          >
            Zoom out: {parentPreview}...
          </button>
        </div>
      )}

      {/* Content */}
      <div className="p-4 border-b dark:border-zinc-700">
        <div className="text-sm whitespace-pre-wrap max-h-64 overflow-y-auto">
          {vm.displayText}
        </div>
      </div>

      {/* Children */}
      {childViewModels.length > 0 && (
        <div className="p-4 border-b dark:border-zinc-700">
          <div className="text-xs text-zinc-500 mb-2">
            Children ({childViewModels.length})
          </div>
          <div className="space-y-1">
            {childViewModels.map((child) => (
              <button
                key={child.id}
                onClick={() => onNavigate(child.id)}
                className="block w-full text-left p-2 text-sm rounded hover:bg-zinc-100 dark:hover:bg-zinc-800"
              >
                <span className="text-xs px-1 py-0.5 bg-zinc-200 dark:bg-zinc-700 rounded mr-2">
                  {child.nodeType}
                </span>
                {child.preview}...
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Backlinks */}
      {backlinkPreviews.length > 0 && (
        <div className="p-4">
          <div className="text-xs text-zinc-500 mb-2">
            Backlinks ({backlinkPreviews.length})
          </div>
          <div className="space-y-1">
            {backlinkPreviews.map((link) => (
              <button
                key={link.id}
                onClick={() => onNavigate(link.id)}
                className="block w-full text-left p-2 text-sm rounded hover:bg-zinc-100 dark:hover:bg-zinc-800"
              >
                {link.preview}...
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
