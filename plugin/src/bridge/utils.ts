import { basename, isAbsolute, resolve } from "node:path";

export function splitMessage(text: string, maxLength = 3500): string[] {
  if (text.length <= maxLength) {
    return [text];
  }
  const chunks: string[] = [];
  let cursor = 0;
  while (cursor < text.length) {
    chunks.push(text.slice(cursor, cursor + maxLength));
    cursor += maxLength;
  }
  return chunks;
}

export function normalizeTextInput(text?: string, caption?: string): string {
  const merged = [text ?? "", caption ?? ""].filter(Boolean).join("\n").trim();
  return merged;
}

export function parseOcCommand(input: string):
  | { name: string; args: string }
  | undefined {
  const text = input.trim();
  const match = text.match(/^\/oc(?:@\w+)?(?:\s+(\w+))?(?:\s+([\s\S]+))?$/i);
  if (!match) {
    return undefined;
  }
  const name = (match[1] ?? "help").toLowerCase();
  const args = (match[2] ?? "").trim();
  return { name, args };
}

export function ensureAbsolutePath(value: string): string {
  if (!isAbsolute(value)) {
    throw new Error("Workspace path must be absolute.");
  }
  return resolve(value);
}

export function isPathWithinRoots(pathValue: string, roots: string[]): boolean {
  if (roots.length === 0) {
    return true;
  }
  return roots.some((root) => pathValue === root || pathValue.startsWith(`${root}/`));
}

export function shortSessionId(sessionId: string): string {
  if (sessionId.length <= 12) {
    return sessionId;
  }
  return sessionId.slice(0, 12);
}

export function workspaceLabel(pathValue: string): string {
  return basename(pathValue) || pathValue;
}

export function detectContextOverflow(errorText: string): boolean {
  const normalized = errorText.toLowerCase();
  return (
    normalized.includes("context_length_exceeded") ||
    normalized.includes("input exceeds the context window")
  );
}

export function safeErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}
