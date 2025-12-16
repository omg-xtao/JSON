export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb.toFixed(1)} KB`;
  const mb = kb / 1024;
  return `${mb.toFixed(1)} MB`;
}

export function extractJsonErrorPosition(message: string): number | null {
  const match = message.match(/position\\s+(\\d+)/i);
  if (!match) return null;
  const position = Number(match[1]);
  return Number.isFinite(position) ? position : null;
}

export function indexToLineColumn(
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

export function normalizeJsonText(text: string): string {
  return text.replace(/^\\uFEFF/, "").trim();
}

export function isPlainObject(
  value: unknown,
): value is Record<string, unknown> {
  if (!value || typeof value !== "object") return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

export function sortKeysDeep(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeysDeep);
  if (!isPlainObject(value)) return value;

  const sorted: Record<string, unknown> = {};
  for (const key of Object.keys(value).sort((a, b) => a.localeCompare(b))) {
    sorted[key] = sortKeysDeep(value[key]);
  }
  return sorted;
}

export function escapeJsonString(text: string): string {
  return JSON.stringify(text).slice(1, -1);
}

export function unescapeJsonString(text: string): string {
  try {
    return JSON.parse(`"${text}"`);
  } catch (error) {
    if (error instanceof Error) {
      throw new Error(`反转义失败：${error.message}`);
    }
    throw new Error("反转义失败：未知错误。");
  }
}
