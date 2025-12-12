"use client";

import {
  type ChangeEvent,
  type RefObject,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

type IndentOption = "2" | "4" | "tab";
type OutputKind = "formatted" | "minified" | null;
type RightPane = "canvas" | "output";

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb.toFixed(1)} KB`;
  const mb = kb / 1024;
  return `${mb.toFixed(1)} MB`;
}

function extractJsonErrorPosition(message: string): number | null {
  const match = message.match(/position\s+(\d+)/i);
  if (!match) return null;
  const position = Number(match[1]);
  return Number.isFinite(position) ? position : null;
}

function indexToLineColumn(
  text: string,
  index: number,
): { line: number; column: number } {
  let line = 1;
  let lastLineStart = 0;
  const max = Math.min(index, text.length);

  for (let i = 0; i < max; i++) {
    if (text.charCodeAt(i) === 10) {
      line++;
      lastLineStart = i + 1;
    }
  }

  return { line, column: max - lastLineStart + 1 };
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== "object") return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

function sortKeysDeep(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeysDeep);
  if (!isPlainObject(value)) return value;

  const sorted: Record<string, unknown> = {};
  for (const key of Object.keys(value).sort((a, b) => a.localeCompare(b))) {
    sorted[key] = sortKeysDeep(value[key]);
  }
  return sorted;
}

function normalizeJsonText(text: string): string {
  return text.replace(/^\uFEFF/, "").trim();
}

type JsonValueType =
  | "object"
  | "array"
  | "string"
  | "number"
  | "boolean"
  | "null";

type JsonGraphRow = {
  key: string;
  value: string;
  childId?: string;
};

type JsonGraphNode = {
  id: string;
  label: string;
  path: string;
  type: JsonValueType;
  summary: string;
  rows: JsonGraphRow[];
  depth: number;
};

type JsonGraphEdge = { from: string; to: string; fromRow: number };

type JsonGraph = {
  rootId: string;
  nodes: JsonGraphNode[];
  edges: JsonGraphEdge[];
  truncated: boolean;
};

function jsonValueType(value: unknown): JsonValueType {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  if (typeof value === "string") return "string";
  if (typeof value === "number") return "number";
  if (typeof value === "boolean") return "boolean";
  return "object";
}

function jsonPreview(value: unknown): string {
  if (value === null) return "null";
  if (typeof value === "string") {
    const compact = value.length > 48 ? `${value.slice(0, 48)}…` : value;
    return JSON.stringify(compact);
  }
  if (typeof value === "number" || typeof value === "boolean")
    return String(value);
  if (Array.isArray(value)) return `Array(${value.length.toLocaleString()})`;
  if (isPlainObject(value))
    return `Object(${Object.keys(value).length.toLocaleString()})`;
  return Object.prototype.toString.call(value);
}

function isIdentifierKey(key: string): boolean {
  return /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(key);
}

function jsonPathAppend(path: string, key: string | number): string {
  if (typeof key === "number") return `${path}[${key}]`;
  if (isIdentifierKey(key)) return `${path}.${key}`;
  return `${path}[${JSON.stringify(key)}]`;
}

function isContainer(
  value: unknown,
): value is unknown[] | Record<string, unknown> {
  return Array.isArray(value) || isPlainObject(value);
}

function buildJsonGraph(
  root: unknown,
  options: { maxDepth: number; maxNodes: number; maxChildrenPerNode: number },
): JsonGraph {
  const nodes: JsonGraphNode[] = [];
  const nodesById = new Map<string, JsonGraphNode>();
  const edges: JsonGraphEdge[] = [];
  let truncated = false;

  const { maxDepth, maxNodes, maxChildrenPerNode } = options;
  let nextId = 0;

  function pushNode(
    label: string,
    path: string,
    value: unknown,
    depth: number,
  ): string {
    const id = `n${nextId++}`;
    const node: JsonGraphNode = {
      id,
      label,
      path,
      depth,
      type: jsonValueType(value),
      summary: jsonPreview(value),
      rows: [],
    };
    nodes.push(node);
    nodesById.set(id, node);
    return id;
  }

  const rootId = pushNode("$", "$", root, 0);
  const queue: Array<{
    id: string;
    value: unknown;
    path: string;
    depth: number;
  }> = [{ id: rootId, value: root, path: "$", depth: 0 }];

  while (queue.length > 0) {
    const current = queue.shift();
    if (!current) break;

    const { id: parentId, value, path, depth } = current;
    const node = nodesById.get(parentId);
    if (!node) continue;

    if (!isContainer(value)) continue;

    const rows: JsonGraphRow[] = [];

    if (Array.isArray(value)) {
      const visible = Math.min(value.length, maxChildrenPerNode);
      if (value.length > visible) truncated = true;

      for (let i = 0; i < visible; i++) {
        const childValue = value[i];
        const rowIndex = rows.length;
        let childId: string | undefined;

        if (
          isContainer(childValue) &&
          depth < maxDepth &&
          nodes.length < maxNodes
        ) {
          const childPath = jsonPathAppend(path, i);
          childId = pushNode(`[${i}]`, childPath, childValue, depth + 1);
          edges.push({ from: parentId, to: childId, fromRow: rowIndex });
          queue.push({
            id: childId,
            value: childValue,
            path: childPath,
            depth: depth + 1,
          });
        } else if (
          isContainer(childValue) &&
          (depth >= maxDepth || nodes.length >= maxNodes)
        ) {
          truncated = true;
        }

        rows.push({ key: String(i), value: jsonPreview(childValue), childId });
      }

      if (value.length > visible) {
        rows.push({
          key: "…",
          value: `+${(value.length - visible).toLocaleString()} 更多`,
        });
      }

      node.rows = rows;
      continue;
    }

    if (isPlainObject(value)) {
      let shown = 0;
      let hasMore = false;

      for (const key in value) {
        if (!Object.hasOwn(value, key)) continue;
        if (shown >= maxChildrenPerNode) {
          hasMore = true;
          truncated = true;
          break;
        }

        const childValue = value[key];
        const rowIndex = rows.length;
        let childId: string | undefined;

        if (
          isContainer(childValue) &&
          depth < maxDepth &&
          nodes.length < maxNodes
        ) {
          const childPath = jsonPathAppend(path, key);
          childId = pushNode(key, childPath, childValue, depth + 1);
          edges.push({ from: parentId, to: childId, fromRow: rowIndex });
          queue.push({
            id: childId,
            value: childValue,
            path: childPath,
            depth: depth + 1,
          });
        } else if (
          isContainer(childValue) &&
          (depth >= maxDepth || nodes.length >= maxNodes)
        ) {
          truncated = true;
        }

        rows.push({ key, value: jsonPreview(childValue), childId });
        shown++;
      }

      if (hasMore) {
        rows.push({ key: "…", value: "更多字段…" });
      }

      node.rows = rows;
    }
  }

  return { rootId, nodes, edges, truncated };
}

type Rect = { x: number; y: number; w: number; h: number };
type GraphBounds = { minX: number; minY: number; maxX: number; maxY: number };
type GraphLayout = {
  rects: Map<string, Rect>;
  nodesById: Map<string, JsonGraphNode>;
  edges: JsonGraphEdge[];
  bounds: GraphBounds;
};

function layoutJsonGraph(graph: JsonGraph): GraphLayout {
  const rects = new Map<string, Rect>();
  const nodesById = new Map<string, JsonGraphNode>();

  const nodeWidth = 280;
  const headerHeight = 26;
  const rowHeight = 18;
  const paddingY = 10;

  const xGap = 120;
  const yGap = 26;
  const padding = 28;

  for (const node of graph.nodes) {
    nodesById.set(node.id, node);
  }

  const childrenByParent = new Map<string, JsonGraphEdge[]>();
  for (const edge of graph.edges) {
    const bucket = childrenByParent.get(edge.from) ?? [];
    bucket.push(edge);
    childrenByParent.set(edge.from, bucket);
  }
  for (const bucket of childrenByParent.values()) {
    bucket.sort((a, b) => a.fromRow - b.fromRow);
  }

  function measureNodeHeight(node: JsonGraphNode): number {
    return paddingY * 2 + headerHeight + node.rows.length * rowHeight;
  }

  let nextY = padding;
  const visited = new Set<string>();

  function dfs(
    nodeId: string,
    depth: number,
  ): { top: number; bottom: number; center: number } {
    const node = nodesById.get(nodeId);
    if (!node) return { top: 0, bottom: 0, center: 0 };
    if (visited.has(nodeId)) return { top: 0, bottom: 0, center: 0 };
    visited.add(nodeId);

    const h = measureNodeHeight(node);
    const children = childrenByParent.get(nodeId) ?? [];

    if (children.length === 0) {
      const y = nextY;
      rects.set(nodeId, {
        x: padding + depth * (nodeWidth + xGap),
        y,
        w: nodeWidth,
        h,
      });
      nextY += h + yGap;
      return { top: y, bottom: y + h, center: y + h / 2 };
    }

    const childInfos: Array<{ top: number; bottom: number; center: number }> =
      [];
    for (const edge of children) {
      childInfos.push(dfs(edge.to, depth + 1));
    }

    const first = childInfos[0];
    const last = childInfos[childInfos.length - 1];
    const center =
      first && last ? (first.center + last.center) / 2 : nextY + h / 2;
    const y = center - h / 2;

    rects.set(nodeId, {
      x: padding + depth * (nodeWidth + xGap),
      y,
      w: nodeWidth,
      h,
    });

    const top = Math.min(y, ...childInfos.map((c) => c.top));
    const bottom = Math.max(y + h, ...childInfos.map((c) => c.bottom));
    return { top, bottom, center: y + h / 2 };
  }

  if (graph.nodes.length > 0) {
    dfs(graph.rootId, 0);
  }

  for (const node of graph.nodes) {
    if (rects.has(node.id)) continue;
    const h = measureNodeHeight(node);
    rects.set(node.id, { x: padding, y: nextY, w: nodeWidth, h });
    nextY += h + yGap;
  }

  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;

  for (const rect of rects.values()) {
    minX = Math.min(minX, rect.x);
    minY = Math.min(minY, rect.y);
    maxX = Math.max(maxX, rect.x + rect.w);
    maxY = Math.max(maxY, rect.y + rect.h);
  }

  const bounds: GraphBounds =
    rects.size > 0
      ? { minX, minY, maxX, maxY }
      : { minX: 0, minY: 0, maxX: 0, maxY: 0 };

  return { rects, nodesById, edges: graph.edges, bounds };
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function useElementSize<T extends HTMLElement>(ref: RefObject<T | null>) {
  const [size, setSize] = useState({ width: 0, height: 0 });

  useEffect(() => {
    const element = ref.current;
    if (!element) return;

    const resizeObserver = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) return;
      const { width, height } = entry.contentRect;
      setSize({ width, height });
    });

    resizeObserver.observe(element);
    return () => resizeObserver.disconnect();
  }, [ref]);

  return size;
}

function JsonCanvas({ graph }: { graph: JsonGraph | null }) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const { width, height } = useElementSize(containerRef);

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

  useEffect(() => {
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
  }, [layout, width, height]);

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

      const isRoot = graph?.rootId === id;

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
  }, [layout, selectedId, view, width, height, graph?.rootId]);

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
    if (!layout) return;
    const { bounds } = layout;
    const padding = 36;
    const worldWidth = Math.max(1, bounds.maxX - bounds.minX);
    const worldHeight = Math.max(1, bounds.maxY - bounds.minY);
    const scaleX = (width - padding * 2) / worldWidth;
    const scaleY = (height - padding * 2) / worldHeight;
    const nextScale = clamp(Math.min(scaleX, scaleY, 1), 0.2, 2);
    const nextOffsetX = padding - bounds.minX * nextScale;
    const nextOffsetY = padding - bounds.minY * nextScale;
    setView({ offsetX: nextOffsetX, offsetY: nextOffsetY, scale: nextScale });
    setSelectedId(null);
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
          已截断：仅展示前 {graph.nodes.length.toLocaleString()} 个节点
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

export function JsonFormatter() {
  const [input, setInput] = useState<string>("");
  const [output, setOutput] = useState<string>("");
  const [outputKind, setOutputKind] = useState<OutputKind>(null);
  const [rightPane, setRightPane] = useState<RightPane>("canvas");
  const [parsedValue, setParsedValue] = useState<unknown | undefined>(
    undefined,
  );
  const [indent, setIndent] = useState<IndentOption>("2");
  const [sortKeys, setSortKeys] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [timingMs, setTimingMs] = useState<number | null>(null);
  const [inputFileName, setInputFileName] = useState<string | null>(null);
  const [inputFileBytes, setInputFileBytes] = useState<number | null>(null);

  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const messageTimerRef = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (messageTimerRef.current != null) {
        window.clearTimeout(messageTimerRef.current);
      }
    };
  }, []);

  const indentValue = useMemo(() => {
    if (indent === "tab") return "\t";
    return Number(indent);
  }, [indent]);

  const stats = useMemo(() => {
    const inputBytes = new Blob([input]).size;
    const outputBytes = new Blob([output]).size;
    return { inputBytes, outputBytes };
  }, [input, output]);

  const graph = useMemo(() => {
    if (parsedValue === undefined) return null;
    return buildJsonGraph(parsedValue, {
      maxDepth: 6,
      maxNodes: 240,
      maxChildrenPerNode: 30,
    });
  }, [parsedValue]);

  function parseOrThrow() {
    const normalized = normalizeJsonText(input);
    if (!normalized) {
      throw new Error("输入为空：请粘贴或上传 JSON。");
    }
    return { normalized, value: JSON.parse(normalized) as unknown };
  }

  function flash(nextMessage: string) {
    setMessage(nextMessage);
    if (messageTimerRef.current != null) {
      window.clearTimeout(messageTimerRef.current);
    }
    messageTimerRef.current = window.setTimeout(() => {
      setMessage(null);
      messageTimerRef.current = null;
    }, 2200);
  }

  function setErrorFromUnknown(
    unknownError: unknown,
    normalizedForPosition?: string,
  ) {
    if (unknownError instanceof Error) {
      const position = extractJsonErrorPosition(unknownError.message);
      if (position != null && normalizedForPosition) {
        const { line, column } = indexToLineColumn(
          normalizedForPosition,
          position,
        );
        setError(`${unknownError.message}（第 ${line} 行，第 ${column} 列）`);
        return;
      }
      setError(unknownError.message);
      return;
    }

    setError("解析失败：未知错误。");
  }

  function handleFormat() {
    setError(null);
    setMessage(null);
    setTimingMs(null);
    setOutputKind(null);

    const start = performance.now();
    try {
      const { value } = parseOrThrow();
      const valueForOutput = sortKeys ? sortKeysDeep(value) : value;
      const formatted = JSON.stringify(valueForOutput, null, indentValue);
      setOutput(`${formatted}\n`);
      setOutputKind("formatted");
      setParsedValue(valueForOutput);
      setTimingMs(performance.now() - start);
      inputRef.current?.focus();
    } catch (unknownError) {
      const normalized = normalizeJsonText(input);
      setOutput("");
      setOutputKind(null);
      setParsedValue(undefined);
      setTimingMs(performance.now() - start);
      setErrorFromUnknown(unknownError, normalized);
    }
  }

  function handleMinify() {
    setError(null);
    setMessage(null);
    setTimingMs(null);
    setOutputKind(null);

    const start = performance.now();
    try {
      const { value } = parseOrThrow();
      const valueForOutput = sortKeys ? sortKeysDeep(value) : value;
      const minified = JSON.stringify(valueForOutput);
      setOutput(`${minified}\n`);
      setOutputKind("minified");
      setParsedValue(valueForOutput);
      setTimingMs(performance.now() - start);
      inputRef.current?.focus();
    } catch (unknownError) {
      const normalized = normalizeJsonText(input);
      setOutput("");
      setOutputKind(null);
      setParsedValue(undefined);
      setTimingMs(performance.now() - start);
      setErrorFromUnknown(unknownError, normalized);
    }
  }

  function handleValidate() {
    setError(null);
    setMessage(null);
    setTimingMs(null);

    const start = performance.now();
    try {
      const { value } = parseOrThrow();
      setParsedValue(sortKeys ? sortKeysDeep(value) : value);
      setTimingMs(performance.now() - start);
      setError(null);
      flash("JSON 校验通过。");
    } catch (unknownError) {
      const normalized = normalizeJsonText(input);
      setParsedValue(undefined);
      setTimingMs(performance.now() - start);
      setErrorFromUnknown(unknownError, normalized);
    }
  }

  function handleClear() {
    setInput("");
    setOutput("");
    setOutputKind(null);
    setError(null);
    setMessage(null);
    setTimingMs(null);
    setParsedValue(undefined);
    setInputFileName(null);
    setInputFileBytes(null);
    inputRef.current?.focus();
  }

  async function writeToClipboard(text: string) {
    if (!text) return;

    if (navigator.clipboard?.writeText && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return;
    }

    const textarea = document.createElement("textarea");
    textarea.value = text;
    textarea.setAttribute("readonly", "");
    textarea.style.position = "fixed";
    textarea.style.left = "-9999px";
    textarea.style.top = "0";
    document.body.appendChild(textarea);
    textarea.focus();
    textarea.select();
    document.execCommand("copy");
    textarea.remove();
  }

  async function handleCopyInput() {
    setError(null);
    try {
      await writeToClipboard(input);
      flash("已复制输入到剪贴板。");
    } catch {
      setError("复制失败：浏览器未授予剪贴板权限。");
    }
  }

  async function handleCopyOutput() {
    setError(null);
    try {
      await writeToClipboard(output);
      flash("已复制输出到剪贴板。");
    } catch {
      setError("复制失败：浏览器未授予剪贴板权限。");
    }
  }

  async function handlePasteFromClipboard() {
    setError(null);
    setMessage(null);

    if (!navigator.clipboard?.readText || !window.isSecureContext) {
      setError("无法读取剪贴板：需要 HTTPS 或 localhost 环境。");
      return;
    }

    try {
      const text = await navigator.clipboard.readText();
      setInput(text);
      setOutput("");
      setOutputKind(null);
      setTimingMs(null);
      setParsedValue(undefined);
      setInputFileName(null);
      setInputFileBytes(null);
      flash("已从剪贴板粘贴到输入。");
      inputRef.current?.focus();
    } catch {
      setError("粘贴失败：浏览器未授予剪贴板权限。");
    }
  }

  function handlePickFile() {
    fileInputRef.current?.click();
  }

  async function handleFileChange(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;

    setError(null);
    setMessage(null);

    try {
      const text = await file.text();
      setInput(text);
      setOutput("");
      setOutputKind(null);
      setTimingMs(null);
      setParsedValue(undefined);
      setInputFileName(file.name);
      setInputFileBytes(file.size);
      flash(`已加载：${file.name}（${formatBytes(file.size)}）`);
      inputRef.current?.focus();
    } catch {
      setError("读取文件失败：请确认文件可访问且为文本 JSON。");
    }
  }

  function buildDownloadName(): string {
    const base = inputFileName
      ? inputFileName.replace(/\.json$/i, "")
      : outputKind === "minified"
        ? "minified"
        : "formatted";

    if (outputKind === "minified") return `${base}.min.json`;
    if (outputKind === "formatted") return `${base}.formatted.json`;
    return `${base}.json`;
  }

  function handleDownloadOutput() {
    if (!output) return;

    const blob = new Blob([output], { type: "application/json;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = buildDownloadName();
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    flash("已开始下载输出文件。");
  }

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-zinc-50 text-zinc-900 dark:bg-black dark:text-zinc-100">
      <header className="flex h-12 shrink-0 items-center gap-3 border-b border-zinc-200/70 bg-white/80 px-3 backdrop-blur dark:border-zinc-800/70 dark:bg-zinc-950/70">
        <div className="flex items-center gap-2">
          <span className="rounded-md bg-zinc-900 px-2 py-0.5 font-mono text-xs font-semibold text-white dark:bg-zinc-100 dark:text-zinc-950">
            {"{}"}
          </span>
          <span className="text-sm font-semibold tracking-tight">JSON Web</span>
        </div>
        <div className="ml-auto flex min-w-0 max-w-[70vw] items-center gap-2 overflow-x-auto">
          <button
            type="button"
            className="inline-flex h-8 shrink-0 items-center justify-center rounded-full border border-zinc-200 bg-white px-3 text-xs font-medium text-zinc-900 hover:bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-100 dark:hover:bg-zinc-900"
            onClick={handlePasteFromClipboard}
          >
            粘贴
          </button>
          <button
            type="button"
            className="inline-flex h-8 shrink-0 items-center justify-center rounded-full border border-zinc-200 bg-white px-3 text-xs font-medium text-zinc-900 hover:bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-100 dark:hover:bg-zinc-900"
            onClick={handlePickFile}
          >
            上传
          </button>
          <button
            type="button"
            className="inline-flex h-8 shrink-0 items-center justify-center rounded-full bg-zinc-900 px-3 text-xs font-medium text-white hover:bg-zinc-800 disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-950 dark:hover:bg-white"
            onClick={handleFormat}
            disabled={!input.trim()}
          >
            格式化
          </button>
          <button
            type="button"
            className="inline-flex h-8 shrink-0 items-center justify-center rounded-full border border-zinc-200 bg-white px-3 text-xs font-medium text-zinc-900 hover:bg-zinc-50 disabled:opacity-50 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-100 dark:hover:bg-zinc-900"
            onClick={handleMinify}
            disabled={!input.trim()}
          >
            压缩
          </button>
          <button
            type="button"
            className="inline-flex h-8 shrink-0 items-center justify-center rounded-full border border-zinc-200 bg-white px-3 text-xs font-medium text-zinc-900 hover:bg-zinc-50 disabled:opacity-50 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-100 dark:hover:bg-zinc-900"
            onClick={handleValidate}
            disabled={!input.trim()}
          >
            校验
          </button>
          <button
            type="button"
            className="inline-flex h-8 shrink-0 items-center justify-center rounded-full border border-zinc-200 bg-white px-3 text-xs font-medium text-zinc-900 hover:bg-zinc-50 disabled:opacity-50 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-100 dark:hover:bg-zinc-900"
            onClick={handleClear}
            disabled={!input && !output}
          >
            清空
          </button>
        </div>
        <input
          ref={fileInputRef}
          type="file"
          accept="application/json,.json"
          className="hidden"
          onChange={handleFileChange}
        />
      </header>

      <main className="grid min-h-0 flex-1 grid-cols-1 lg:grid-cols-2">
        <section className="flex min-h-0 flex-col lg:border-r lg:border-zinc-200/70 lg:dark:border-zinc-800/70">
          <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-zinc-200/70 bg-white/60 p-2 dark:border-zinc-800/70 dark:bg-zinc-950/40">
            <div className="flex min-w-0 flex-1 items-center gap-2">
              <span className="text-xs font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
                输入
              </span>
              {inputFileName ? (
                <span className="truncate text-xs text-zinc-500 dark:text-zinc-400">
                  {inputFileName}
                  {inputFileBytes != null
                    ? `（${formatBytes(inputFileBytes)}）`
                    : ""}
                </span>
              ) : (
                <span className="truncate text-xs text-zinc-400 dark:text-zinc-500">
                  粘贴或上传 JSON
                </span>
              )}
            </div>

            <label className="inline-flex items-center gap-2 text-xs text-zinc-600 dark:text-zinc-400">
              <span>缩进</span>
              <select
                className="h-8 rounded-full border border-zinc-200 bg-white px-3 text-xs text-zinc-900 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-100"
                value={indent}
                onChange={(e) => setIndent(e.target.value as IndentOption)}
              >
                <option value="2">2</option>
                <option value="4">4</option>
                <option value="tab">Tab</option>
              </select>
            </label>

            <label className="inline-flex items-center gap-2 text-xs text-zinc-600 dark:text-zinc-400">
              <input
                type="checkbox"
                className="h-4 w-4 accent-zinc-900 dark:accent-zinc-100"
                checked={sortKeys}
                onChange={(e) => setSortKeys(e.target.checked)}
              />
              <span>排序 key</span>
            </label>

            <button
              type="button"
              className="inline-flex h-8 shrink-0 items-center justify-center rounded-full border border-zinc-200 bg-white px-3 text-xs font-medium text-zinc-900 hover:bg-zinc-50 disabled:opacity-50 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-100 dark:hover:bg-zinc-900"
              onClick={handleCopyInput}
              disabled={!input}
            >
              复制
            </button>
          </div>

          <textarea
            ref={inputRef}
            className="min-h-0 flex-1 resize-none bg-white p-3 font-mono text-sm leading-6 text-zinc-900 outline-none placeholder:text-zinc-400 dark:bg-zinc-950 dark:text-zinc-100 dark:placeholder:text-zinc-600"
            value={input}
            onChange={(e) => {
              setInput(e.target.value);
              setParsedValue(undefined);
              setError(null);
              setMessage(null);
              setOutputKind(null);
            }}
            placeholder="在这里粘贴 JSON（支持很大的 JSON），或用“上传”导入文件。"
            spellCheck={false}
            wrap="off"
          />
        </section>

        <section className="flex min-h-0 flex-col">
          <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-zinc-200/70 bg-white/60 p-2 dark:border-zinc-800/70 dark:bg-zinc-950/40">
            <div className="inline-flex items-center rounded-full border border-zinc-200 bg-white p-0.5 text-xs dark:border-zinc-800 dark:bg-zinc-950">
              <button
                type="button"
                className={`inline-flex h-8 items-center justify-center rounded-full px-3 font-medium ${
                  rightPane === "canvas"
                    ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-950"
                    : "text-zinc-700 hover:bg-zinc-50 dark:text-zinc-300 dark:hover:bg-zinc-900"
                }`}
                onClick={() => setRightPane("canvas")}
              >
                画布
              </button>
              <button
                type="button"
                className={`inline-flex h-8 items-center justify-center rounded-full px-3 font-medium ${
                  rightPane === "output"
                    ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-950"
                    : "text-zinc-700 hover:bg-zinc-50 dark:text-zinc-300 dark:hover:bg-zinc-900"
                }`}
                onClick={() => setRightPane("output")}
              >
                输出
              </button>
            </div>

            <div className="ml-auto flex items-center gap-2">
              <button
                type="button"
                className="inline-flex h-8 shrink-0 items-center justify-center rounded-full border border-zinc-200 bg-white px-3 text-xs font-medium text-zinc-900 hover:bg-zinc-50 disabled:opacity-50 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-100 dark:hover:bg-zinc-900"
                onClick={handleCopyOutput}
                disabled={!output}
              >
                复制
              </button>
              <button
                type="button"
                className="inline-flex h-8 shrink-0 items-center justify-center rounded-full border border-zinc-200 bg-white px-3 text-xs font-medium text-zinc-900 hover:bg-zinc-50 disabled:opacity-50 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-100 dark:hover:bg-zinc-900"
                onClick={handleDownloadOutput}
                disabled={!output}
              >
                下载
              </button>
            </div>
          </div>

          <div className="min-h-0 flex-1">
            {rightPane === "output" ? (
              <textarea
                className="h-full w-full resize-none bg-zinc-50 p-3 font-mono text-sm leading-6 text-zinc-900 outline-none placeholder:text-zinc-400 dark:bg-black dark:text-zinc-100 dark:placeholder:text-zinc-600"
                value={output}
                readOnly
                placeholder="格式化/压缩结果会显示在这里。"
                spellCheck={false}
                wrap="off"
              />
            ) : (
              <JsonCanvas graph={graph} />
            )}
          </div>
        </section>
      </main>

      <footer className="flex shrink-0 items-center gap-3 border-t border-zinc-200/70 bg-white/80 px-3 py-2 text-xs text-zinc-500 backdrop-blur dark:border-zinc-800/70 dark:bg-zinc-950/70 dark:text-zinc-400">
        <div className="flex min-w-0 flex-1 items-center gap-3 overflow-x-auto">
          <span>输入 {formatBytes(stats.inputBytes)}</span>
          <span>输出 {formatBytes(stats.outputBytes)}</span>
          {timingMs != null ? <span>耗时 {timingMs.toFixed(1)} ms</span> : null}
          {outputKind ? (
            <span>{outputKind === "formatted" ? "已格式化" : "已压缩"}</span>
          ) : null}
          {graph ? (
            <span>
              画布 {graph.nodes.length.toLocaleString()} 节点
              {graph.truncated ? "（截断）" : ""}
            </span>
          ) : null}
        </div>
        {error ? (
          <div className="min-w-0 max-w-[60vw] truncate text-red-700 dark:text-red-300">
            {error}
          </div>
        ) : message ? (
          <div className="min-w-0 max-w-[60vw] truncate">{message}</div>
        ) : (
          <div className="min-w-0 max-w-[60vw] truncate">
            1MB+ JSON 建议用按钮触发解析
          </div>
        )}
      </footer>
    </div>
  );
}
