"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useElementSize } from "./hooks/useElementSize";
import type { JsonGraph } from "./lib/jsonGraph";
import { layoutJsonGraph } from "./lib/jsonLayout";

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

export function JsonCanvas({ graph }: { graph: JsonGraph | null }) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const { width, height } = useElementSize(containerRef);
  const rootId = graph?.rootId ?? null;

  const truncationHint = useMemo(() => {
    if (!graph?.truncated) return null;
    const reasons: string[] = [];
    if (graph.truncatedBy.children) reasons.push("行数");
    if (graph.truncatedBy.nodes) reasons.push("节点数");
    if (graph.truncatedBy.depth) reasons.push("深度");
    return reasons.length > 0 ? reasons.join(" / ") : "限制";
  }, [graph]);

  const layout = useMemo(() => {
    if (!graph) return null;
    return layoutJsonGraph(graph);
  }, [graph]);

  const [view, setView] = useState({ offsetX: 24, offsetY: 24, scale: 1 });
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const dragRef = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    startOffsetX: number;
    startOffsetY: number;
    moved: boolean;
  } | null>(null);

  const selectedNode = useMemo(() => {
    if (!layout || !selectedId) return null;
    return layout.nodesById.get(selectedId) ?? null;
  }, [layout, selectedId]);

  const fitToLayout = useCallback(() => {
    if (!layout || width <= 0 || height <= 0) return;
    const { bounds } = layout;
    const worldWidth = Math.max(1, bounds.maxX - bounds.minX);
    const worldHeight = Math.max(1, bounds.maxY - bounds.minY);
    const padding = 36;
    const scaleX = (width - padding * 2) / worldWidth;
    const scaleY = (height - padding * 2) / worldHeight;
    const nextScale = clamp(Math.min(scaleX, scaleY, 1), 0.2, 2);
    const nextOffsetX = padding - bounds.minX * nextScale;
    const nextOffsetY = padding - bounds.minY * nextScale;
    setView({ offsetX: nextOffsetX, offsetY: nextOffsetY, scale: nextScale });
    setSelectedId(null);
  }, [height, layout, width]);

  useEffect(() => {
    fitToLayout();
  }, [fitToLayout]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !layout || width <= 0 || height <= 0) return;

    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.max(1, Math.floor(width * dpr));
    canvas.height = Math.max(1, Math.floor(height * dpr));

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);

    const isDark =
      window.matchMedia?.("(prefers-color-scheme: dark)").matches ?? false;
    const colors = isDark
      ? {
          edge: "rgba(255,255,255,0.18)",
          nodeFill: "rgba(9,9,11,0.92)",
          nodeBorder: "rgba(255,255,255,0.16)",
          nodeText: "rgba(244,244,245,0.96)",
          nodeSubText: "rgba(161,161,170,0.95)",
          highlight: "rgba(96,165,250,0.95)",
        }
      : {
          edge: "rgba(24,24,27,0.16)",
          nodeFill: "rgba(255,255,255,0.95)",
          nodeBorder: "rgba(24,24,27,0.16)",
          nodeText: "rgba(24,24,27,0.96)",
          nodeSubText: "rgba(82,82,91,0.92)",
          highlight: "rgba(37,99,235,0.95)",
        };

    ctx.translate(view.offsetX, view.offsetY);
    ctx.scale(view.scale, view.scale);

    const headerHeight = 26;
    const rowHeight = 18;
    const paddingX = 12;
    const paddingY = 10;
    const radius = 12;
    const portRadius = 3.5;

    const lineWidth = 1 / view.scale;
    ctx.lineWidth = lineWidth;
    ctx.strokeStyle = colors.edge;

    for (const edge of layout.edges) {
      const fromRect = layout.rects.get(edge.from);
      const toRect = layout.rects.get(edge.to);
      const fromNode = layout.nodesById.get(edge.from);
      if (!fromRect || !toRect || !fromNode) continue;
      if (edge.fromRow < 0 || edge.fromRow >= fromNode.rows.length) continue;

      const fromX = fromRect.x + fromRect.w;
      const fromY =
        fromRect.y +
        paddingY +
        headerHeight +
        edge.fromRow * rowHeight +
        rowHeight / 2;

      const toX = toRect.x;
      const toY = toRect.y + paddingY + headerHeight / 2;
      const midX = fromX + (toX - fromX) * 0.5;

      ctx.beginPath();
      ctx.moveTo(fromX, fromY);
      ctx.bezierCurveTo(midX, fromY, midX, toY, toX, toY);
      ctx.stroke();
    }

    ctx.textBaseline = "middle";

    for (const [id, rect] of layout.rects.entries()) {
      const node = layout.nodesById.get(id);
      if (!node) continue;
      const isSelected = id === selectedId;

      ctx.fillStyle = colors.nodeFill;
      ctx.strokeStyle = isSelected ? colors.highlight : colors.nodeBorder;
      ctx.lineWidth = isSelected ? 2 / view.scale : lineWidth;

      ctx.beginPath();
      ctx.moveTo(rect.x + radius, rect.y);
      ctx.lineTo(rect.x + rect.w - radius, rect.y);
      ctx.quadraticCurveTo(
        rect.x + rect.w,
        rect.y,
        rect.x + rect.w,
        rect.y + radius,
      );
      ctx.lineTo(rect.x + rect.w, rect.y + rect.h - radius);
      ctx.quadraticCurveTo(
        rect.x + rect.w,
        rect.y + rect.h,
        rect.x + rect.w - radius,
        rect.y + rect.h,
      );
      ctx.lineTo(rect.x + radius, rect.y + rect.h);
      ctx.quadraticCurveTo(
        rect.x,
        rect.y + rect.h,
        rect.x,
        rect.y + rect.h - radius,
      );
      ctx.lineTo(rect.x, rect.y + radius);
      ctx.quadraticCurveTo(rect.x, rect.y, rect.x + radius, rect.y);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();

      const isRoot = rootId === id;

      const titleY = rect.y + paddingY + headerHeight / 2;
      ctx.font =
        '12px ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace';
      ctx.fillStyle = colors.nodeText;
      ctx.textAlign = "left";
      const title =
        node.label.length > 34 ? `${node.label.slice(0, 34)}…` : node.label;
      ctx.fillText(title, rect.x + paddingX, titleY);

      ctx.textAlign = "right";
      ctx.fillStyle = colors.nodeSubText;
      const summary =
        node.summary.length > 18
          ? `${node.summary.slice(0, 18)}…`
          : node.summary;
      ctx.fillText(summary, rect.x + rect.w - paddingX, titleY);
      ctx.textAlign = "left";

      ctx.strokeStyle = colors.edge;
      ctx.lineWidth = lineWidth;
      ctx.beginPath();
      ctx.moveTo(rect.x + lineWidth, rect.y + paddingY + headerHeight);
      ctx.lineTo(rect.x + rect.w - lineWidth, rect.y + paddingY + headerHeight);
      ctx.stroke();

      const keyColor = isDark
        ? "rgba(248,113,113,0.95)"
        : "rgba(220,38,38,0.95)";
      const valueColor = isDark
        ? "rgba(147,197,253,0.95)"
        : "rgba(37,99,235,0.95)";

      ctx.font =
        '11px ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace';

      const maxKeyChars = 16;
      const maxValueChars = 36;

      for (let i = 0; i < node.rows.length; i++) {
        const row = node.rows[i];
        const rowY =
          rect.y + paddingY + headerHeight + i * rowHeight + rowHeight / 2;

        ctx.fillStyle = keyColor;
        const key =
          row.key.length > maxKeyChars
            ? `${row.key.slice(0, maxKeyChars)}…`
            : row.key;
        ctx.fillText(key, rect.x + paddingX, rowY);

        ctx.textAlign = "right";
        ctx.fillStyle = valueColor;
        const reservedRight = row.childId ? 14 : 0;
        const rawValue = row.value;
        const valueText =
          rawValue.length > maxValueChars
            ? `${rawValue.slice(0, maxValueChars)}…`
            : rawValue;
        ctx.fillText(
          valueText,
          rect.x + rect.w - paddingX - reservedRight,
          rowY,
        );
        ctx.textAlign = "left";

        if (row.childId) {
          ctx.fillStyle = colors.nodeBorder;
          ctx.beginPath();
          ctx.arc(rect.x + rect.w, rowY, portRadius, 0, Math.PI * 2);
          ctx.fill();
        }
      }

      if (!isRoot) {
        ctx.fillStyle = colors.nodeBorder;
        ctx.beginPath();
        ctx.arc(
          rect.x,
          rect.y + paddingY + headerHeight / 2,
          portRadius,
          0,
          Math.PI * 2,
        );
        ctx.fill();
      }
    }
  }, [layout, rootId, selectedId, view, width, height]);

  function screenToWorld(
    screenX: number,
    screenY: number,
  ): { worldX: number; worldY: number } {
    return {
      worldX: (screenX - view.offsetX) / view.scale,
      worldY: (screenY - view.offsetY) / view.scale,
    };
  }

  function hitTest(worldX: number, worldY: number): string | null {
    if (!layout) return null;
    for (const [id, rect] of layout.rects.entries()) {
      if (
        worldX >= rect.x &&
        worldX <= rect.x + rect.w &&
        worldY >= rect.y &&
        worldY <= rect.y + rect.h
      ) {
        return id;
      }
    }
    return null;
  }

  function handlePointerDown(e: React.PointerEvent<HTMLCanvasElement>) {
    if (!layout) return;
    if (e.button !== 0) return;
    const canvas = e.currentTarget;
    canvas.setPointerCapture(e.pointerId);
    dragRef.current = {
      pointerId: e.pointerId,
      startX: e.clientX,
      startY: e.clientY,
      startOffsetX: view.offsetX,
      startOffsetY: view.offsetY,
      moved: false,
    };
  }

  function handlePointerMove(e: React.PointerEvent<HTMLCanvasElement>) {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== e.pointerId) return;
    const dx = e.clientX - drag.startX;
    const dy = e.clientY - drag.startY;
    if (Math.abs(dx) + Math.abs(dy) > 3) drag.moved = true;
    setView((prev) => ({
      ...prev,
      offsetX: drag.startOffsetX + dx,
      offsetY: drag.startOffsetY + dy,
    }));
  }

  function handlePointerUp(e: React.PointerEvent<HTMLCanvasElement>) {
    const drag = dragRef.current;
    dragRef.current = null;
    if (!drag || drag.pointerId !== e.pointerId) return;

    if (!drag.moved) {
      const rect = e.currentTarget.getBoundingClientRect();
      const screenX = e.clientX - rect.left;
      const screenY = e.clientY - rect.top;
      const { worldX, worldY } = screenToWorld(screenX, screenY);
      setSelectedId(hitTest(worldX, worldY));
    }
  }

  function handleWheel(e: React.WheelEvent<HTMLCanvasElement>) {
    if (!layout) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const screenX = e.clientX - rect.left;
    const screenY = e.clientY - rect.top;

    const zoom = e.deltaY < 0 ? 1.12 : 0.9;
    setView((prev) => {
      const worldX = (screenX - prev.offsetX) / prev.scale;
      const worldY = (screenY - prev.offsetY) / prev.scale;
      const nextScale = clamp(prev.scale * zoom, 0.2, 3);
      return {
        scale: nextScale,
        offsetX: screenX - worldX * nextScale,
        offsetY: screenY - worldY * nextScale,
      };
    });
  }

  function handleReset() {
    fitToLayout();
  }

  return (
    <div
      ref={containerRef}
      className="relative h-full w-full bg-[radial-gradient(circle_at_1px_1px,rgba(24,24,27,0.12)_1px,transparent_0)] [background-size:18px_18px] dark:bg-[radial-gradient(circle_at_1px_1px,rgba(244,244,245,0.10)_1px,transparent_0)]"
    >
      <canvas
        ref={canvasRef}
        className="h-full w-full touch-none"
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onWheel={handleWheel}
      />

      {!graph ? (
        <div className="absolute inset-0 flex items-center justify-center text-sm text-zinc-500 dark:text-zinc-400">
          先点击“校验 / 格式化 / 压缩”生成可视化
        </div>
      ) : null}

      {graph?.truncated ? (
        <div className="absolute left-3 top-3 rounded-full border border-zinc-200 bg-white/90 px-3 py-1 text-xs text-zinc-700 shadow-sm backdrop-blur dark:border-zinc-800 dark:bg-zinc-950/80 dark:text-zinc-200">
          已截断：受 {truncationHint} 限制 {"·"}{" "}
          {graph.nodes.length.toLocaleString()} 节点
        </div>
      ) : null}

      {selectedNode ? (
        <div className="absolute right-3 top-3 max-w-[70%] rounded-xl border border-zinc-200 bg-white/90 p-3 text-xs text-zinc-800 shadow-sm backdrop-blur dark:border-zinc-800 dark:bg-zinc-950/80 dark:text-zinc-200">
          <div className="truncate font-mono text-zinc-900 dark:text-zinc-100">
            {selectedNode.path}
          </div>
          <div className="mt-1 truncate text-zinc-600 dark:text-zinc-400">
            {selectedNode.type} · {selectedNode.summary}
          </div>
        </div>
      ) : null}

      {graph ? (
        <div className="absolute bottom-3 left-3 rounded-full border border-zinc-200 bg-white/90 px-3 py-1 text-xs text-zinc-700 shadow-sm backdrop-blur dark:border-zinc-800 dark:bg-zinc-950/80 dark:text-zinc-200">
          拖拽平移 · 滚轮缩放 · 点击查看路径
        </div>
      ) : null}

      {graph ? (
        <div className="absolute bottom-3 right-3 flex items-center gap-2">
          <button
            type="button"
            className="inline-flex h-8 items-center justify-center rounded-full border border-zinc-200 bg-white/90 px-3 text-xs font-medium text-zinc-900 shadow-sm backdrop-blur hover:bg-white dark:border-zinc-800 dark:bg-zinc-950/80 dark:text-zinc-100 dark:hover:bg-zinc-900"
            onClick={() =>
              setView((prev) => ({
                ...prev,
                scale: clamp(prev.scale * 1.15, 0.2, 3),
              }))
            }
          >
            放大
          </button>
          <button
            type="button"
            className="inline-flex h-8 items-center justify-center rounded-full border border-zinc-200 bg-white/90 px-3 text-xs font-medium text-zinc-900 shadow-sm backdrop-blur hover:bg-white dark:border-zinc-800 dark:bg-zinc-950/80 dark:text-zinc-100 dark:hover:bg-zinc-900"
            onClick={() =>
              setView((prev) => ({
                ...prev,
                scale: clamp(prev.scale / 1.15, 0.2, 3),
              }))
            }
          >
            缩小
          </button>
          <button
            type="button"
            className="inline-flex h-8 items-center justify-center rounded-full border border-zinc-200 bg-white/90 px-3 text-xs font-medium text-zinc-900 shadow-sm backdrop-blur hover:bg-white dark:border-zinc-800 dark:bg-zinc-950/80 dark:text-zinc-100 dark:hover:bg-zinc-900"
            onClick={handleReset}
          >
            复位
          </button>
        </div>
      ) : null}
    </div>
  );
}
