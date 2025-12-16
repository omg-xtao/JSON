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
import { type ChangeEvent, useRef, useState } from "react";
import { useTheme } from "@/components/ui/ThemeProvider";
import { OUTPUT_KIND_LABELS } from "@/features/json-formatter/constants";
import { useJsonFormatterState } from "@/features/json-formatter/hooks/useJsonFormatterState";
import type {
  CanvasMode,
  GraphPreset,
  IndentOption,
} from "@/features/json-formatter/types";
import { JsonFlowCanvas } from "./flow/JsonFlowCanvas";
import { JsonCanvas } from "./JsonCanvas";
import { formatBytes } from "./lib/jsonUtils";
import { MonacoJsonEditor } from "./MonacoJsonEditor";

type MonacoEditor = MonacoEditorNamespace.IStandaloneCodeEditor;

export function JsonFormatter() {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [wordWrap, setWordWrap] = useState(false);
  const [lineNumberMode, setLineNumberMode] = useState<
    "off" | "focus" | "full"
  >("focus");
  const { theme, toggleTheme } = useTheme();

  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const inputEditorRef = useRef<MonacoEditor | null>(null);
  const outputEditorRef = useRef<MonacoEditor | null>(null);

  const { state, actions } = useJsonFormatterState({
    onFocusInput: () => {
      inputEditorRef.current?.focus();
    },
    onRevealInputPosition: ({ line, column }) => {
      const editor = inputEditorRef.current;
      if (editor) {
        editor.focus();
        editor.setPosition({ lineNumber: line, column });
        editor.revealPositionInCenter({ lineNumber: line, column });
      }
    },
  });

  const {
    input,
    output,
    outputKind,
    rightPane,
    mobilePane,
    indent,
    sortKeys,
    graphPreset,
    canvasMode,
    error,
    message,
    timingMs,
    inputFileName,
    inputFileBytes,
    stats,
    graph,
    tabSize,
    insertSpaces,
  } = state;

  function handlePickFile() {
    fileInputRef.current?.click();
  }

  function handleFileChange(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    void actions.handleFileLoaded(file);
  }

  function switchToInput() {
    actions.setMobilePane("input");
  }

  function switchToCanvas() {
    actions.setRightPane("canvas");
    actions.setMobilePane("canvas");
  }

  function switchToOutput() {
    actions.setRightPane("output");
    actions.setMobilePane("output");
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
            onClick={() => actions.pasteFromClipboard()}
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
            onClick={() => actions.format()}
            disabled={!input.trim()}
          >
            格式化
          </button>
          <button
            type="button"
            className="inline-flex h-8 shrink-0 items-center justify-center rounded-full border border-zinc-200 bg-white px-3 text-xs font-medium text-zinc-900 hover:bg-zinc-50 disabled:opacity-50 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-100 dark:hover:bg-zinc-900"
            onClick={() => actions.minify()}
            disabled={!input.trim()}
          >
            压缩
          </button>
          <button
            type="button"
            className="inline-flex h-8 shrink-0 items-center justify-center rounded-full border border-zinc-200 bg-white px-3 text-xs font-medium text-zinc-900 hover:bg-zinc-50 disabled:opacity-50 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-100 dark:hover:bg-zinc-900"
            onClick={() => actions.escapeText()}
            disabled={!input.trim()}
          >
            转义
          </button>
          <button
            type="button"
            className="inline-flex h-8 shrink-0 items-center justify-center rounded-full border border-zinc-200 bg-white px-3 text-xs font-medium text-zinc-900 hover:bg-zinc-50 disabled:opacity-50 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-100 dark:hover:bg-zinc-900"
            onClick={() => actions.unescapeText()}
            disabled={!input.trim()}
          >
            反转义
          </button>
          <button
            type="button"
            className="inline-flex h-8 shrink-0 items-center justify-center rounded-full border border-zinc-200 bg-white px-3 text-xs font-medium text-zinc-900 hover:bg-zinc-50 disabled:opacity-50 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-100 dark:hover:bg-zinc-900"
            onClick={() => actions.validate()}
            disabled={!input.trim()}
          >
            校验
          </button>
          <button
            type="button"
            className="inline-flex h-8 shrink-0 items-center justify-center rounded-full border border-zinc-200 bg-white px-3 text-xs font-medium text-zinc-900 hover:bg-zinc-50 disabled:opacity-50 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-100 dark:hover:bg-zinc-900"
            onClick={() => actions.clear()}
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
            onClick={() => actions.pasteFromClipboard()}
            aria-label="粘贴"
          >
            <ClipboardPaste className="h-5 w-5" aria-hidden="true" />
          </button>
          <button
            type="button"
            className="inline-flex h-10 shrink-0 items-center justify-center gap-1.5 rounded-full bg-zinc-900 px-4 text-sm font-medium text-white hover:bg-zinc-800 active:bg-zinc-700 disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-950 dark:hover:bg-white"
            onClick={() => actions.format()}
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
              actions.minify();
              setMobileMenuOpen(false);
            }}
            disabled={!input.trim()}
          >
            <Minimize2 className="h-4 w-4 text-zinc-500" aria-hidden="true" />
            压缩
          </button>
          <div className="flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm text-zinc-900 dark:text-zinc-100">
            <input
              type="checkbox"
              className="h-4 w-4 accent-zinc-900 dark:accent-zinc-100"
              checked={wordWrap}
              onChange={(e) => setWordWrap(e.target.checked)}
              id="mobile-word-wrap"
            />
            <label
              className="flex-1 cursor-pointer select-none"
              htmlFor="mobile-word-wrap"
            >
              自动换行
            </label>
          </div>
          <div className="flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm text-zinc-900 dark:text-zinc-100">
            <span className="w-16 text-left text-xs text-zinc-500 dark:text-zinc-400">
              行号
            </span>
            <select
              className="flex-1 rounded-lg border border-zinc-200 bg-white px-3 py-1.5 text-xs text-zinc-900 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100"
              value={lineNumberMode}
              onChange={(e) =>
                setLineNumberMode(e.target.value as "off" | "focus" | "full")
              }
            >
              <option value="off">关闭</option>
              <option value="focus">聚焦</option>
              <option value="full">全部</option>
            </select>
          </div>
          <button
            type="button"
            className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-sm font-medium text-zinc-900 hover:bg-zinc-100 active:bg-zinc-200 disabled:opacity-50 dark:text-zinc-100 dark:hover:bg-zinc-800"
            onClick={() => {
              actions.escapeText();
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
              actions.unescapeText();
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
              actions.validate();
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
              actions.clear();
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
                onChange={(e) =>
                  actions.setIndent(e.target.value as IndentOption)
                }
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
                onChange={(e) => actions.setSortKeys(e.target.checked)}
              />
              <span>排序 key</span>
            </label>
            <label className="hidden items-center gap-2 text-xs text-zinc-600 sm:inline-flex dark:text-zinc-400">
              <input
                type="checkbox"
                className="h-4 w-4 accent-zinc-900 dark:accent-zinc-100"
                checked={wordWrap}
                onChange={(e) => setWordWrap(e.target.checked)}
              />
              <span>自动换行</span>
            </label>
            <label className="hidden items-center gap-2 text-xs text-zinc-600 sm:inline-flex dark:text-zinc-400">
              <span>行号</span>
              <select
                className="h-8 rounded-full border border-zinc-200 bg-white px-3 text-xs text-zinc-900 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-100"
                value={lineNumberMode}
                onChange={(e) =>
                  setLineNumberMode(e.target.value as "off" | "focus" | "full")
                }
              >
                <option value="off">关闭</option>
                <option value="focus">聚焦</option>
                <option value="full">全部</option>
              </select>
            </label>

            <button
              type="button"
              className="inline-flex h-8 shrink-0 items-center justify-center rounded-full border border-zinc-200 bg-white px-3 text-xs font-medium text-zinc-900 hover:bg-zinc-50 disabled:opacity-50 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-100 dark:hover:bg-zinc-900"
              onClick={() => actions.copyInput()}
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
                actions.updateInput(next);
              }}
              ariaLabel="JSON input"
              tabSize={tabSize}
              insertSpaces={insertSpaces}
              wordWrap={wordWrap ? "on" : "off"}
              lineNumberMode={lineNumberMode}
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
                      actions.setCanvasMode(e.target.value as CanvasMode)
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
                      actions.setGraphPreset(e.target.value as GraphPreset)
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
                onClick={() => actions.copyOutput()}
                disabled={!output}
              >
                复制
              </button>
              <button
                type="button"
                className="inline-flex h-8 shrink-0 items-center justify-center rounded-full border border-zinc-200 bg-white px-3 text-xs font-medium text-zinc-900 hover:bg-zinc-50 disabled:opacity-50 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-100 dark:hover:bg-zinc-900"
                onClick={() => actions.downloadOutput()}
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
                  wordWrap={wordWrap ? "on" : "off"}
                  lineNumberMode={lineNumberMode}
                  onMountEditor={(editor) => {
                    outputEditorRef.current = editor;
                  }}
                />
                {!output ? (
                  <div className="pointer-events-none absolute left-3 top-3 select-none text-sm text-zinc-400 dark:text-zinc-500">
                    格式化/压缩/转义/反转义结果会显示在这里。
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
