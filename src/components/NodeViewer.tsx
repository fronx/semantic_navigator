"use client";

import { useState, useEffect } from "react";
import { Node } from "@/lib/types";

interface NodeData {
  node: Node;
  children: Node[] | null;
  parent: { id: string; node_type: string; summary: string } | null;
  backlinks: { id: string; node_type: string; summary: string }[] | null;
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

  return (
    <div className="border rounded-lg bg-white dark:bg-zinc-900 overflow-hidden">
      {/* Header */}
      <div className="p-4 border-b dark:border-zinc-700">
        <div className="flex items-center gap-2 mb-2">
          <span className="text-xs px-2 py-0.5 bg-zinc-200 dark:bg-zinc-700 rounded">
            {node.node_type}
          </span>
          {node.header_level && (
            <span className="text-xs text-zinc-500">H{node.header_level}</span>
          )}
        </div>
        <div className="text-xs text-zinc-500">{node.source_path}</div>
      </div>

      {/* Navigation */}
      {parent && (
        <div className="px-4 py-2 border-b dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800">
          <button
            onClick={() => onNavigate(parent.id)}
            className="text-sm text-blue-600 hover:underline"
          >
            Zoom out: {parent.summary?.slice(0, 50) || parent.node_type}...
          </button>
        </div>
      )}

      {/* Summary */}
      {node.summary && (
        <div className="p-4 border-b dark:border-zinc-700 bg-blue-50 dark:bg-blue-900/20">
          <div className="text-xs text-zinc-500 mb-1">Summary</div>
          <div className="text-sm">{node.summary}</div>
        </div>
      )}

      {/* Content */}
      <div className="p-4 border-b dark:border-zinc-700">
        <div className="text-xs text-zinc-500 mb-1">Content</div>
        <div className="text-sm whitespace-pre-wrap max-h-64 overflow-y-auto">
          {node.content}
        </div>
      </div>

      {/* Children */}
      {children && children.length > 0 && (
        <div className="p-4 border-b dark:border-zinc-700">
          <div className="text-xs text-zinc-500 mb-2">
            Children ({children.length})
          </div>
          <div className="space-y-1">
            {children.map((child) => (
              <button
                key={child.id}
                onClick={() => onNavigate(child.id)}
                className="block w-full text-left p-2 text-sm rounded hover:bg-zinc-100 dark:hover:bg-zinc-800"
              >
                <span className="text-xs px-1 py-0.5 bg-zinc-200 dark:bg-zinc-700 rounded mr-2">
                  {child.node_type}
                </span>
                {child.summary?.slice(0, 60) || child.content.slice(0, 60)}...
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Backlinks */}
      {backlinks && backlinks.length > 0 && (
        <div className="p-4">
          <div className="text-xs text-zinc-500 mb-2">
            Backlinks ({backlinks.length})
          </div>
          <div className="space-y-1">
            {backlinks.map((link) => (
              <button
                key={link.id}
                onClick={() => onNavigate(link.id)}
                className="block w-full text-left p-2 text-sm rounded hover:bg-zinc-100 dark:hover:bg-zinc-800"
              >
                {link.summary?.slice(0, 60)}...
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
