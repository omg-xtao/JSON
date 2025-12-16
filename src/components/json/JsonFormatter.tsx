"use client";

import {
  CheckCircle2,
  ClipboardPaste,
  Code,
  EllipsisVertical,
  Minimize2,
  Moon,
  Sun,
  Trash2,
  Undo2,
  Upload,
} from "lucide-react";
import type { editor as MonacoEditorNamespace } from "monaco-editor";
import { type ChangeEvent, useEffect, useMemo, useRef, useState } from "react";
import { useTheme } from "@/components/ui/ThemeProvider";
import { JsonFlowCanvas } from "./flow/JsonFlowCanvas";
import { JsonCanvas } from "./JsonCanvas";
import { buildJsonGraph } from "./lib/jsonGraph";
import {
  escapeJsonString,
  extractJsonErrorPosition,
  formatBytes,
  indexToLineColumn,
  normalizeJsonText,
  sortKeysDeep,
  unescapeJsonString,
} from "./lib/jsonUtils";
import { MonacoJsonEditor } from "./MonacoJsonEditor";

type IndentOption = "2" | "4" | "tab";
type OutputKind = "formatted" | "minified" | "escaped" | "unescaped" | null;
type RightPane = "canvas" | "output";
type GraphPreset = "default" | "more" | "all";
type CanvasMode = "flow" | "native";
type MobilePane = "input" | RightPane;

type MonacoEditor = MonacoEditorNamespace.IStandaloneCodeEditor;

type GraphOptions = {
  maxDepth: number;
  maxNodes: number;
  maxChildrenPerNode: number;
};

const GRAPH_PRESETS: Record<GraphPreset, GraphOptions> = {
  default: { maxDepth: 6, maxNodes: 240, maxChildrenPerNode: 30 },
  more: { maxDepth: 12, maxNodes: 3000, maxChildrenPerNode: 200 },
  all: {
    maxDepth: Number.POSITIVE_INFINITY,
    maxNodes: Number.POSITIVE_INFINITY,
    maxChildrenPerNode: Number.POSITIVE_INFINITY,
  },
};

const OUTPUT_KIND_LABELS: Record<NonNullable<OutputKind>, string> = {
  formatted: "已格式化",
  minified: "已压缩",
  escaped: "已转义",
  unescaped: "已反转义",
};

export function JsonFormatter() {
  const [input, setInput] = useState<string>("");
  const [output, setOutput] = useState<string>("");
  const [outputKind, setOutputKind] = useState<OutputKind>(null);
  const [rightPane, setRightPane] = useState<RightPane>("canvas");
  const [mobilePane, setMobilePane] = useState<MobilePane>("input");
  const [parsedValue, setParsedValue] = useState<unknown | undefined>(
    undefined,
  );
  const [indent, setIndent] = useState<IndentOption>("2");
  const [sortKeys, setSortKeys] = useState<boolean>(false);
  const [graphPreset, setGraphPreset] = useState<GraphPreset>("default");
  const [canvasMode, setCanvasMode] = useState<CanvasMode>("flow");
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [timingMs, setTimingMs] = useState<number | null>(null);
  const [inputFileName, setInputFileName] = useState<string | null>(null);
  const [inputFileBytes, setInputFileBytes] = useState<number | null>(null);
  const { theme, toggleTheme } = useTheme();

  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const messageTimerRef = useRef<number | null>(null);
  const inputEditorRef = useRef<MonacoEditor | null>(null);
  const outputEditorRef = useRef<MonacoEditor | null>(null);

  useEffect(() => {
    return () => {
      if (messageTimerRef.current != null) {
        window.clearTimeout(messageTimerRef.current);
      }
    };
  }, []);

  const indentValue = indent === "tab" ? "\t" : Number(indent);
  const tabSize = indent === "4" ? 4 : 2;
  const insertSpaces = indent !== "tab";

  const stats = useMemo(() => {
    const inputBytes = new Blob([input]).size;
    const outputBytes = new Blob([output]).size;
    return { inputBytes, outputBytes };
  }, [input, output]);

  const graphOptions = GRAPH_PRESETS[graphPreset];

  const graph = useMemo(() => {
    if (parsedValue === undefined) return null;
    return buildJsonGraph(parsedValue, graphOptions);
  }, [parsedValue, graphOptions]);

  function parseOrThrow() {
    const normalized = normalizeJsonText(input);
    if (!normalized) {
      throw new Error("输入为空：请粘贴或上传 JSON。");
    }
    return { normalized, value: JSON.parse(normalized) as unknown };
  }

  function focusInputEditor() {
    inputEditorRef.current?.focus();
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
        const editor = inputEditorRef.current;
        if (editor) {
          editor.focus();
          editor.setPosition({ lineNumber: line, column });
          editor.revealPositionInCenter({ lineNumber: line, column });
        }
        return;
      }
      setError(unknownError.message);
      return;
    }

    setError("解析失败：未知错误。");
  }

  function handleFormatOrMinify(kind: "formatted" | "minified") {
    setError(null);
    setMessage(null);
    setTimingMs(null);
    setOutputKind(null);

    const start = performance.now();
    let normalized: string | undefined;
    try {
      const parsed = parseOrThrow();
      normalized = parsed.normalized;
      const { value } = parsed;
      const valueForOutput = sortKeys ? sortKeysDeep(value) : value;

      const nextOutput =
        kind === "formatted"
          ? JSON.stringify(valueForOutput, null, indentValue)
          : JSON.stringify(valueForOutput);

      setOutput(`${nextOutput}\n`);
      setOutputKind(kind);
      setParsedValue(valueForOutput);
      setTimingMs(performance.now() - start);
      focusInputEditor();
    } catch (unknownError) {
      setOutput("");
      setOutputKind(null);
      setParsedValue(undefined);
      setTimingMs(performance.now() - start);
      setErrorFromUnknown(unknownError, normalized ?? normalizeJsonText(input));
    }
  }

  function handleFormat() {
    handleFormatOrMinify("formatted");
  }

  function handleMinify() {
    handleFormatOrMinify("minified");
  }

  function handleEscape() {
    setError(null);
    setMessage(null);
    setTimingMs(null);
    setOutputKind(null);

    const start = performance.now();
    try {
      if (!input.trim()) {
        throw new Error("输入为空：请粘贴或上传 JSON。");
      }
      const escaped = escapeJsonString(input);
      setOutput(`${escaped}\n`);
      setOutputKind("escaped");
      setParsedValue(undefined);
      setTimingMs(performance.now() - start);
      flash("已转义。");
    } catch (unknownError) {
      setOutput("");
      setOutputKind(null);
      setParsedValue(undefined);
      setTimingMs(performance.now() - start);
      setErrorFromUnknown(unknownError);
    }
  }

  function handleUnescape() {
    setError(null);
    setMessage(null);
    setTimingMs(null);
    setOutputKind(null);

    const start = performance.now();
    try {
      if (!input.trim()) {
        throw new Error("输入为空：请粘贴或上传 JSON。");
      }
      const unescaped = unescapeJsonString(input);
      setOutput(`${unescaped}\n`);
      setOutputKind("unescaped");
      let nextParsed: unknown | undefined;
      try {
        nextParsed = JSON.parse(normalizeJsonText(unescaped));
      } catch {
        nextParsed = undefined;
      }
      setParsedValue(nextParsed);
      setTimingMs(performance.now() - start);
      flash(nextParsed ? "已反转义并解析。" : "已反转义。");
    } catch (unknownError) {
      setOutput("");
      setOutputKind(null);
      setParsedValue(undefined);
      setTimingMs(performance.now() - start);
      setErrorFromUnknown(unknownError);
    }
  }

  function handleValidate() {
    setError(null);
    setMessage(null);
    setTimingMs(null);

    const start = performance.now();
    let normalized: string | undefined;
    try {
      const parsed = parseOrThrow();
      normalized = parsed.normalized;
      const { value } = parsed;
      const valueForOutput = sortKeys ? sortKeysDeep(value) : value;
      setOutputKind(null);
      setParsedValue(valueForOutput);
      setTimingMs(performance.now() - start);
      flash("JSON 校验通过。");
    } catch (unknownError) {
      setParsedValue(undefined);
      setTimingMs(performance.now() - start);
      setErrorFromUnknown(unknownError, normalized ?? normalizeJsonText(input));
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
    focusInputEditor();
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
      focusInputEditor();
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
      focusInputEditor();
    } catch {
      setError("读取文件失败：请确认文件可访问且为文本 JSON。");
    }
  }

  function buildDownloadName(): string {
    const baseFromInput = inputFileName
      ? inputFileName.replace(/\.json$/i, "")
      : null;

    const fallbackBase =
      outputKind === "minified"
        ? "minified"
        : outputKind === "escaped"
          ? "escaped"
          : outputKind === "unescaped"
            ? "unescaped"
            : "formatted";

    const base = baseFromInput ?? fallbackBase;

    if (outputKind === "minified") return `${base}.min.json`;
    if (outputKind === "formatted") return `${base}.formatted.json`;
    if (outputKind === "escaped") return `${base}.escaped.txt`;
    if (outputKind === "unescaped") return `${base}.unescaped.json`;
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

  async function runOutputAction(actionId: string) {
    const editor = outputEditorRef.current;
    if (!editor) return;
    const action = editor.getAction(actionId);
    if (!action) return;
    try {
      await action.run();
    } catch {
      // ignore
    }
  }

  function switchToInput() {
    setMobilePane("input");
  }

  function switchToCanvas() {
    setRightPane("canvas");
    setMobilePane("canvas");
  }

  function switchToOutput() {
    setRightPane("output");
    setMobilePane("output");
  }

  return (
    <div className="flex h-svh flex-col overflow-hidden bg-zinc-50 text-zinc-900 lg:h-screen dark:bg-black dark:text-zinc-100">
      <header className="flex h-12 shrink-0 items-center gap-3 border-b border-zinc-200/70 bg-white/80 px-3 backdrop-blur dark:border-zinc-800/70 dark:bg-zinc-950/70">
        <div className="flex items-center gap-2">
          <span className="rounded-md bg-zinc-900 px-2 py-0.5 font-mono text-xs font-semibold text-white dark:bg-zinc-100 dark:text-zinc-950">
            {"{}"}
          </span>
          <span className="hidden text-sm font-semibold tracking-tight sm:inline">
            JSON Web
          </span>
        </div>

        {/* Desktop buttons - hidden on mobile */}
        <div className="ml-auto hidden items-center gap-2 lg:flex">
          <button
            type="button"
            className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-zinc-200 bg-white text-zinc-900 hover:bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-100 dark:hover:bg-zinc-900"
            onClick={toggleTheme}
            aria-label="切换主题"
          >
            {theme === "dark" ? (
              <Sun className="h-4.5 w-4.5" aria-hidden="true" />
            ) : (
              <Moon className="h-4.5 w-4.5" aria-hidden="true" />
            )}
          </button>
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
            onClick={handleEscape}
            disabled={!input.trim()}
          >
            转义
          </button>
          <button
            type="button"
            className="inline-flex h-8 shrink-0 items-center justify-center rounded-full border border-zinc-200 bg-white px-3 text-xs font-medium text-zinc-900 hover:bg-zinc-50 disabled:opacity-50 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-100 dark:hover:bg-zinc-900"
            onClick={handleUnescape}
            disabled={!input.trim()}
          >
            反转义
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

        {/* Mobile buttons - simplified with menu */}
        <div className="ml-auto flex items-center gap-2 lg:hidden">
          <button
            type="button"
            className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-zinc-200 bg-white text-zinc-900 hover:bg-zinc-50 active:bg-zinc-100 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-100 dark:hover:bg-zinc-900"
            onClick={toggleTheme}
            aria-label="切换主题"
          >
            {theme === "dark" ? (
              <Sun className="h-5 w-5" aria-hidden="true" />
            ) : (
              <Moon className="h-5 w-5" aria-hidden="true" />
            )}
          </button>
          <button
            type="button"
            className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-zinc-200 bg-white text-zinc-900 hover:bg-zinc-50 active:bg-zinc-100 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-100 dark:hover:bg-zinc-900"
            onClick={handlePasteFromClipboard}
            aria-label="粘贴"
          >
            <ClipboardPaste className="h-5 w-5" aria-hidden="true" />
          </button>
          <button
            type="button"
            className="inline-flex h-10 shrink-0 items-center justify-center gap-1.5 rounded-full bg-zinc-900 px-4 text-sm font-medium text-white hover:bg-zinc-800 active:bg-zinc-700 disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-950 dark:hover:bg-white"
            onClick={handleFormat}
            disabled={!input.trim()}
          >
            格式化
          </button>
          <button
            type="button"
            className="relative inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-zinc-200 bg-white text-zinc-900 hover:bg-zinc-50 active:bg-zinc-100 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-100 dark:hover:bg-zinc-900"
            onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
            aria-label="更多操作"
            aria-expanded={mobileMenuOpen}
          >
            <EllipsisVertical className="h-5 w-5" aria-hidden="true" />
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

      {/* Mobile dropdown menu */}
      {mobileMenuOpen && (
        <div className="absolute right-2 top-14 z-50 min-w-[160px] rounded-xl border border-zinc-200 bg-white/95 p-1.5 shadow-lg backdrop-blur lg:hidden dark:border-zinc-700 dark:bg-zinc-900/95">
          <button
            type="button"
            className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-sm font-medium text-zinc-900 hover:bg-zinc-100 active:bg-zinc-200 dark:text-zinc-100 dark:hover:bg-zinc-800"
            onClick={() => {
              handlePickFile();
              setMobileMenuOpen(false);
            }}
          >
            <Upload className="h-4 w-4 text-zinc-500" aria-hidden="true" />
            上传文件
          </button>
          <button
            type="button"
            className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-sm font-medium text-zinc-900 hover:bg-zinc-100 active:bg-zinc-200 disabled:opacity-50 dark:text-zinc-100 dark:hover:bg-zinc-800"
            onClick={() => {
              handleMinify();
              setMobileMenuOpen(false);
            }}
            disabled={!input.trim()}
          >
            <Minimize2 className="h-4 w-4 text-zinc-500" aria-hidden="true" />
            压缩
          </button>
          <button
            type="button"
            className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-sm font-medium text-zinc-900 hover:bg-zinc-100 active:bg-zinc-200 disabled:opacity-50 dark:text-zinc-100 dark:hover:bg-zinc-800"
            onClick={() => {
              handleEscape();
              setMobileMenuOpen(false);
            }}
            disabled={!input.trim()}
          >
            <Code className="h-4 w-4 text-zinc-500" aria-hidden="true" />
            转义
          </button>
          <button
            type="button"
            className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-sm font-medium text-zinc-900 hover:bg-zinc-100 active:bg-zinc-200 disabled:opacity-50 dark:text-zinc-100 dark:hover:bg-zinc-800"
            onClick={() => {
              handleUnescape();
              setMobileMenuOpen(false);
            }}
            disabled={!input.trim()}
          >
            <Undo2 className="h-4 w-4 text-zinc-500" aria-hidden="true" />
            反转义
          </button>
          <button
            type="button"
            className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-sm font-medium text-zinc-900 hover:bg-zinc-100 active:bg-zinc-200 disabled:opacity-50 dark:text-zinc-100 dark:hover:bg-zinc-800"
            onClick={() => {
              handleValidate();
              setMobileMenuOpen(false);
            }}
            disabled={!input.trim()}
          >
            <CheckCircle2
              className="h-4 w-4 text-zinc-500"
              aria-hidden="true"
            />
            校验
          </button>
          <div className="my-1.5 border-t border-zinc-100 dark:border-zinc-800" />
          <button
            type="button"
            className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-sm font-medium text-red-600 hover:bg-red-50 active:bg-red-100 disabled:opacity-50 dark:text-red-400 dark:hover:bg-red-950/30"
            onClick={() => {
              handleClear();
              setMobileMenuOpen(false);
            }}
            disabled={!input && !output}
          >
            <Trash2 className="h-4 w-4" aria-hidden="true" />
            清空
          </button>
        </div>
      )}

      <div className="flex shrink-0 items-center gap-2 border-b border-zinc-200/70 bg-white/60 px-2 py-2 lg:hidden dark:border-zinc-800/70 dark:bg-zinc-950/40">
        <div className="inline-flex flex-1 items-center rounded-full border border-zinc-200 bg-white p-0.5 text-xs dark:border-zinc-800 dark:bg-zinc-950">
          <button
            type="button"
            className={`inline-flex h-9 flex-1 items-center justify-center rounded-full px-3 font-medium ${
              mobilePane === "input"
                ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-950"
                : "text-zinc-700 hover:bg-zinc-50 dark:text-zinc-300 dark:hover:bg-zinc-900"
            }`}
            onClick={switchToInput}
          >
            输入
          </button>
          <button
            type="button"
            className={`inline-flex h-9 flex-1 items-center justify-center rounded-full px-3 font-medium ${
              mobilePane === "canvas"
                ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-950"
                : "text-zinc-700 hover:bg-zinc-50 dark:text-zinc-300 dark:hover:bg-zinc-900"
            }`}
            onClick={switchToCanvas}
          >
            画布
          </button>
          <button
            type="button"
            className={`inline-flex h-9 flex-1 items-center justify-center rounded-full px-3 font-medium ${
              mobilePane === "output"
                ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-950"
                : "text-zinc-700 hover:bg-zinc-50 dark:text-zinc-300 dark:hover:bg-zinc-900"
            }`}
            onClick={switchToOutput}
          >
            输出
          </button>
        </div>
      </div>

      <main className="grid min-h-0 flex-1 grid-cols-1 lg:grid-cols-2">
        <section
          className={`min-h-0 flex-col lg:flex lg:border-r lg:border-zinc-200/70 lg:dark:border-zinc-800/70 ${
            mobilePane === "input" ? "flex" : "hidden"
          }`}
        >
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
                <span className="hidden truncate text-xs text-zinc-400 sm:inline dark:text-zinc-500">
                  粘贴或上传 JSON
                </span>
              )}
            </div>

            {/* Desktop-only options */}
            <label className="hidden items-center gap-2 text-xs text-zinc-600 sm:inline-flex dark:text-zinc-400">
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

            <label className="hidden items-center gap-2 text-xs text-zinc-600 sm:inline-flex dark:text-zinc-400">
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

          <div className="relative min-h-0 flex-1">
            <MonacoJsonEditor
              className="h-full w-full"
              value={input}
              onChange={(next) => {
                setInput(next);
                setParsedValue(undefined);
                setError(null);
                setMessage(null);
                setOutputKind(null);
              }}
              ariaLabel="JSON input"
              tabSize={tabSize}
              insertSpaces={insertSpaces}
              onMountEditor={(editor) => {
                inputEditorRef.current = editor;
              }}
            />
            {!input ? (
              <div className="pointer-events-none absolute left-3 top-3 select-none text-sm text-zinc-400 dark:text-zinc-500">
                在这里粘贴 JSON（支持很大的 JSON），或用“上传”导入文件。
              </div>
            ) : null}
          </div>
        </section>

        <section
          className={`min-h-0 flex-col lg:flex ${
            mobilePane === "input" ? "hidden" : "flex"
          }`}
        >
          <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-zinc-200/70 bg-white/60 p-2 dark:border-zinc-800/70 dark:bg-zinc-950/40">
            <div className="inline-flex items-center rounded-full border border-zinc-200 bg-white p-0.5 text-xs dark:border-zinc-800 dark:bg-zinc-950">
              <button
                type="button"
                className={`inline-flex h-8 items-center justify-center rounded-full px-3 font-medium ${
                  rightPane === "canvas"
                    ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-950"
                    : "text-zinc-700 hover:bg-zinc-50 dark:text-zinc-300 dark:hover:bg-zinc-900"
                }`}
                onClick={switchToCanvas}
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
                onClick={switchToOutput}
              >
                输出
              </button>
            </div>

            {rightPane === "canvas" ? (
              <>
                <label className="inline-flex items-center gap-2 text-xs text-zinc-600 dark:text-zinc-400">
                  <span>画布</span>
                  <select
                    className="h-8 rounded-full border border-zinc-200 bg-white px-3 text-xs text-zinc-900 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-100"
                    value={canvasMode}
                    onChange={(e) =>
                      setCanvasMode(e.target.value as CanvasMode)
                    }
                  >
                    <option value="flow">Flow</option>
                    <option value="native">Native</option>
                  </select>
                </label>
                <label className="inline-flex items-center gap-2 text-xs text-zinc-600 dark:text-zinc-400">
                  <span>范围</span>
                  <select
                    className="h-8 rounded-full border border-zinc-200 bg-white px-3 text-xs text-zinc-900 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-100"
                    value={graphPreset}
                    onChange={(e) =>
                      setGraphPreset(e.target.value as GraphPreset)
                    }
                  >
                    <option value="default">默认</option>
                    <option value="more">更多</option>
                    <option value="all">全部（谨慎）</option>
                  </select>
                </label>
              </>
            ) : (
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  className="inline-flex h-8 shrink-0 items-center justify-center rounded-full border border-zinc-200 bg-white px-3 text-xs font-medium text-zinc-900 hover:bg-zinc-50 disabled:opacity-50 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-100 dark:hover:bg-zinc-900"
                  onClick={() => runOutputAction("editor.foldAll")}
                  disabled={!output}
                >
                  折叠
                </button>
                <button
                  type="button"
                  className="inline-flex h-8 shrink-0 items-center justify-center rounded-full border border-zinc-200 bg-white px-3 text-xs font-medium text-zinc-900 hover:bg-zinc-50 disabled:opacity-50 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-100 dark:hover:bg-zinc-900"
                  onClick={() => runOutputAction("editor.unfoldAll")}
                  disabled={!output}
                >
                  展开
                </button>
              </div>
            )}

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
              <div className="relative h-full w-full">
                <MonacoJsonEditor
                  className="h-full w-full"
                  value={output}
                  readOnly
                  ariaLabel="JSON output"
                  tabSize={tabSize}
                  insertSpaces={insertSpaces}
                  onMountEditor={(editor) => {
                    outputEditorRef.current = editor;
                  }}
                />
                {!output ? (
                  <div className="pointer-events-none absolute left-3 top-3 select-none text-sm text-zinc-400 dark:text-zinc-500">
                    格式化/压缩/转义结果会显示在这里。
                  </div>
                ) : null}
              </div>
            ) : (
              <div className="h-full w-full">
                {canvasMode === "flow" ? (
                  <JsonFlowCanvas graph={graph} />
                ) : (
                  <JsonCanvas graph={graph} />
                )}
              </div>
            )}
          </div>
        </section>
      </main>

      <footer className="flex shrink-0 items-center gap-2 border-t border-zinc-200/70 bg-white/80 px-3 py-2 text-xs text-zinc-500 backdrop-blur sm:gap-3 dark:border-zinc-800/70 dark:bg-zinc-950/70 dark:text-zinc-400">
        <div className="flex min-w-0 shrink-0 items-center gap-2 sm:gap-3">
          <span className="whitespace-nowrap">
            {formatBytes(stats.inputBytes)} → {formatBytes(stats.outputBytes)}
          </span>
          {timingMs != null ? (
            <span className="hidden whitespace-nowrap sm:inline">
              {timingMs.toFixed(0)}ms
            </span>
          ) : null}
          {outputKind ? (
            <span className="hidden sm:inline">
              {OUTPUT_KIND_LABELS[outputKind]}
            </span>
          ) : null}
        </div>
        <div className="min-w-0 flex-1 text-right">
          {error ? (
            <span className="truncate text-red-600 dark:text-red-400">
              {error}
            </span>
          ) : message ? (
            <span className="truncate">{message}</span>
          ) : null}
        </div>
      </footer>
    </div>
  );
}
