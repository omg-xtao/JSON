"use client";

import type { editor as MonacoEditorNamespace } from "monaco-editor";
import dynamic from "next/dynamic";
import { useEffect, useMemo, useState } from "react";
import { useTheme } from "@/components/ui/ThemeProvider";

type MonacoEditor = MonacoEditorNamespace.IStandaloneCodeEditor;

const Editor = dynamic(() => import("@monaco-editor/react"), { ssr: false });

export type MonacoJsonEditorProps = {
  value: string;
  onChange?: (next: string) => void;
  readOnly?: boolean;
  ariaLabel?: string;
  className?: string;
  onMountEditor?: (editor: MonacoEditor) => void;
  tabSize?: number;
  insertSpaces?: boolean;
  wordWrap?: "on" | "off";
};

export function MonacoJsonEditor({
  value,
  onChange,
  readOnly = false,
  ariaLabel,
  className,
  onMountEditor,
  tabSize = 2,
  insertSpaces = true,
  wordWrap = "off",
}: MonacoJsonEditorProps) {
  const { theme } = useTheme();
  const monacoTheme = theme === "dark" ? "vs-dark" : "vs";
  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    const checkMobile = () => {
      setIsMobile(window.innerWidth < 1024);
    };
    checkMobile();
    window.addEventListener("resize", checkMobile);
    return () => window.removeEventListener("resize", checkMobile);
  }, []);

  const options = useMemo(() => {
    return {
      readOnly,
      minimap: { enabled: false },
      automaticLayout: true,
      scrollBeyondLastLine: false,
      lineNumbers: isMobile ? "off" : "on",
      wordWrap,
      tabSize,
      insertSpaces,
      folding: true,
      foldingHighlight: true,
      renderWhitespace: "none",
      renderLineHighlight: "none",
      scrollbar: {
        verticalScrollbarSize: isMobile ? 6 : 10,
        horizontalScrollbarSize: isMobile ? 6 : 10,
      },
      fontFamily:
        'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace',
      fontSize: isMobile ? 15 : 13,
      lineHeight: isMobile ? 22 : undefined,
      padding: isMobile ? { top: 12, bottom: 12 } : undefined,
    } as const;
  }, [insertSpaces, isMobile, readOnly, tabSize, wordWrap]);

  return (
    <div className={className}>
      <Editor
        height="100%"
        width="100%"
        defaultLanguage="json"
        theme={monacoTheme}
        value={value}
        onChange={onChange ? (v) => onChange(v ?? "") : undefined}
        options={options}
        onMount={(editor) => {
          onMountEditor?.(editor as MonacoEditor);
        }}
        aria-label={ariaLabel}
      />
    </div>
  );
}
