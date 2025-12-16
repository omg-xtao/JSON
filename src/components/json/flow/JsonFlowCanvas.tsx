"use client";

import {
  Background,
  Controls,
  type Edge,
  type Node,
  type NodeTypes,
  ReactFlow,
  type ReactFlowInstance,
} from "@xyflow/react";
import ELK from "elkjs/lib/elk.bundled.js";
import { useEffect, useMemo, useRef, useState } from "react";
import { useTheme } from "@/components/ui/ThemeProvider";
import type { JsonGraph } from "../lib/jsonGraph";
import styles from "./JsonFlowCanvas.module.css";
import { JsonFlowNode, type JsonFlowNodeData } from "./JsonFlowNode";

const nodeTypes: NodeTypes = { jsonNode: JsonFlowNode };

function nodeHeight(rowCount: number): number {
  const header = 42;
  const row = 18;
  const padding = 18;
  const visibleRows = Math.min(rowCount, 18);
  return header + padding + visibleRows * row;
}

export function JsonFlowCanvas({ graph }: { graph: JsonGraph | null }) {
  const [nodes, setNodes] = useState<Node<JsonFlowNodeData, "jsonNode">[]>([]);
  const [edges, setEdges] = useState<Edge[]>([]);
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const { theme } = useTheme();
  const rfRef = useRef<ReactFlowInstance<
    Node<JsonFlowNodeData, "jsonNode">,
    Edge
  > | null>(null);

  const base = useMemo(() => {
    if (!graph) return null;
    const edgeColor =
      theme === "dark" ? "rgba(226,232,240,0.55)" : "rgba(148,163,184,0.65)";

    const nextNodes: Node<JsonFlowNodeData, "jsonNode">[] = graph.nodes.map(
      (n) => ({
        id: n.id,
        type: "jsonNode",
        position: { x: 0, y: 0 },
        data: { node: n },
      }),
    );

    const nextEdges: Edge[] = graph.edges.map((e, index) => ({
      id: `e${index}`,
      source: e.from,
      target: e.to,
      animated: false,
      style: { strokeWidth: 1.25, stroke: edgeColor },
    }));

    return { nodes: nextNodes, edges: nextEdges };
  }, [graph, theme]);

  useEffect(() => {
    if (!graph || !base) {
      setNodes([]);
      setEdges([]);
      setSelectedPath(null);
      return;
    }

    let cancelled = false;
    const elk = new ELK();

    const elkNodes = graph.nodes.map((n) => ({
      id: n.id,
      width: 280,
      height: nodeHeight(n.rows.length),
    }));

    const elkEdges = graph.edges.map((e, index) => ({
      id: `e${index}`,
      sources: [e.from],
      targets: [e.to],
    }));

    elk
      .layout({
        id: "root",
        layoutOptions: {
          "elk.algorithm": "layered",
          "elk.direction": "RIGHT",
          "elk.layered.spacing.nodeNodeBetweenLayers": "110",
          "elk.spacing.nodeNode": "30",
          "elk.edgeRouting": "SPLINES",
        },
        children: elkNodes,
        edges: elkEdges,
      })
      .then((result) => {
        if (cancelled) return;
        const positions = new Map<string, { x: number; y: number }>();
        for (const child of result.children ?? []) {
          positions.set(child.id, { x: child.x ?? 0, y: child.y ?? 0 });
        }

        setNodes(
          base.nodes.map((node) => ({
            ...node,
            position: positions.get(node.id) ?? { x: 0, y: 0 },
          })),
        );
        setEdges(base.edges);

        queueMicrotask(() => {
          rfRef.current?.fitView({ padding: 0.18, duration: 240 });
        });
      })
      .catch(() => {
        if (cancelled) return;
        setNodes(base.nodes);
        setEdges(base.edges);
      });

    return () => {
      cancelled = true;
    };
  }, [base, graph]);

  if (!graph) {
    return (
      <div className="flex h-full w-full items-center justify-center text-sm text-zinc-500 dark:text-zinc-400">
        先点击“校验 / 格式化 / 压缩”生成可视化
      </div>
    );
  }

  return (
    <div className={`${styles.flowWrapper} relative h-full w-full`}>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        fitView
        style={{
          background: theme === "dark" ? "#0b0b0f" : "#f8fafc",
        }}
        onInit={(rf) => {
          rfRef.current = rf;
        }}
        onNodeClick={(_, node) => {
          setSelectedPath(node.data.node.path);
        }}
        proOptions={{ hideAttribution: true }}
      >
        <Background
          gap={18}
          size={1}
          color={
            theme === "dark"
              ? "rgba(255,255,255,0.08)"
              : "rgba(148,163,184,0.35)"
          }
        />
        <Controls position="bottom-right" showInteractive={false} />
      </ReactFlow>

      {selectedPath ? (
        <div className="pointer-events-none absolute right-3 top-3 max-w-[70%] rounded-xl border border-zinc-200 bg-white/90 p-3 text-xs text-zinc-800 shadow-sm backdrop-blur dark:border-zinc-800 dark:bg-zinc-950/80 dark:text-zinc-200">
          <div className="truncate font-mono text-zinc-900 dark:text-zinc-100">
            {selectedPath}
          </div>
        </div>
      ) : null}

      {graph.truncated ? (
        <div className="pointer-events-none absolute left-3 top-3 rounded-full border border-zinc-200 bg-white/90 px-3 py-1 text-xs text-zinc-700 shadow-sm backdrop-blur dark:border-zinc-800 dark:bg-zinc-950/80 dark:text-zinc-200">
          已截断 · {graph.nodes.length.toLocaleString()} 节点
        </div>
      ) : null}
    </div>
  );
}
