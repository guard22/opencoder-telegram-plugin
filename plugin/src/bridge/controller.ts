import { realpathSync } from "node:fs";
import { basename } from "node:path";
import type {
  FilePart,
  Session,
  SessionMessagesResponses,
  SessionPromptResponses,
  TextPart,
} from "@opencode-ai/sdk";
import type { TelegramBotManager } from "../bot.js";
import type { Config } from "../config.js";
import { AuthenticatedOpencodeClientFactory } from "./opencode-client.js";
import { TopicSessionStore } from "./store.js";
import type {
  InboundTelegramMessage,
  ModelRef,
  PendingPrompt,
  SessionRuntime,
  TopicSessionBinding,
} from "./types.js";
import {
  detectContextOverflow,
  ensureAbsolutePath,
  isPathWithinRoots,
  normalizeTextInput,
  parseOcCommand,
  safeErrorMessage,
  shortSessionId,
  splitMessage,
  workspaceLabel,
} from "./utils.js";

interface SessionProfile {
  model: ModelRef;
  reasoningEffort?: string;
  reasoningSummary?: string;
  textVerbosity?: string;
}

interface SessionListItem {
  id: string;
  title: string;
  directory: string;
  updatedAt: number;
}

type InlineKeyboard = Array<Array<{ text: string; callbackData: string }>>;
const EMPTY_ASSISTANT_OUTPUT = "Assistant finished without final text output.";
const LIVE_PROGRESS_TICK_MS = 3_000;
const LIVE_PROGRESS_MIN_EDIT_MS = 2_500;
const LIVE_PROGRESS_MIN_SEND_MS = 1_200;
const TOPIC_RENAME_MIN_MS = 5_000;
const FLOOD_JITTER_MS = 250;
const DEFAULT_REASONING_EFFORT = "high";
const PROMPT_COALESCE_MS = 1_500;

function truncateTopicName(value: string): string {
  if (value.length <= 120) {
    return value;
  }
  return `${value.slice(0, 117)}...`;
}

function truncateButtonText(value: string, maxLength = 52): string {
  if (value.length <= maxLength) {
    return value;
  }
  return `${value.slice(0, Math.max(0, maxLength - 3))}...`;
}

function parseErrorPayload(error: unknown): string {
  if (!error) {
    return "Unknown error";
  }

  if (typeof error === "string") {
    return error;
  }

  if (error instanceof Error) {
    return error.message;
  }

  const errorObj = error as { detail?: string; message?: string; error?: unknown };
  if (typeof errorObj.detail === "string" && errorObj.detail.trim() !== "") {
    return errorObj.detail;
  }
  if (typeof errorObj.message === "string" && errorObj.message.trim() !== "") {
    return errorObj.message;
  }

  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
}

function toDataUrl(mime: string, data: Buffer): string {
  return `data:${mime};base64,${data.toString("base64")}`;
}

function extractAssistantText(parts: unknown[]): string {
  const textParts = parts
    .filter((part): part is TextPart => {
      const candidate = part as TextPart;
      return candidate?.type === "text" && typeof candidate.text === "string";
    })
    .map((part) => part.text)
    .join("")
    .trim();

  if (textParts !== "") {
    return textParts;
  }

  const fileParts = parts
    .filter((part): part is FilePart => {
      const candidate = part as FilePart;
      return candidate?.type === "file";
    })
    .map((part) => part.filename || part.url)
    .filter(Boolean)
    .join("\n");

  if (fileParts !== "") {
    return `Assistant returned file output:\n${fileParts}`;
  }

  const reasoningText = parts
    .filter((part: any) => part?.type === "reasoning" && typeof part?.text === "string")
    .map((part: any) => String(part.text).trim())
    .filter(Boolean)
    .join("\n\n")
    .trim();
  if (reasoningText !== "") {
    return `Assistant reasoning:\n${reasoningText.slice(0, 2000)}`;
  }

  const toolStates = parts
    .filter((part: any) => part?.type === "tool")
    .map((part: any) => {
      const name = String(part?.tool || "tool");
      const status = String(part?.state?.status || "unknown");
      return `- ${name}: ${status}`;
    });
  if (toolStates.length > 0) {
    return `Assistant ran tools but returned no final text yet:\n${toolStates.join("\n")}`;
  }

  return EMPTY_ASSISTANT_OUTPUT;
}

function isTopicCreationPermissionError(errorText: string): boolean {
  const normalized = errorText.toLowerCase();
  return (
    normalized.includes("not enough rights to create a topic") ||
    normalized.includes("can_manage_topics")
  );
}

function formatSessionProfile(profile: SessionProfile): string[] {
  const modelId = profile.model.modelID;
  const modelName = modelDisplayName(profile.model);
  const effort = profile.reasoningEffort ?? DEFAULT_REASONING_EFFORT;
  const summary = profile.reasoningSummary ?? "auto";
  const verbosity = profile.textVerbosity ?? "medium";

  const effortHint = effort === "high"
    ? "max quality, slower"
    : effort === "xhigh"
      ? "highest quality, slowest"
    : effort === "low"
      ? "faster, less deep"
      : effort === "none"
        ? "minimal reasoning"
        : "balanced";
  const summaryHint = summary === "detailed"
    ? "long reasoning summary"
    : summary === "none"
      ? "hide reasoning summary"
      : "auto summary";
  const verbosityHint = verbosity === "high"
    ? "more detailed final answer"
    : verbosity === "low"
      ? "short final answer"
      : "balanced final answer";

  return [
    `Model: ${modelName} (${profile.model.providerID}/${modelId})`,
    `Reasoning effort: ${effort} (${effortHint})`,
    `Reasoning summary: ${summary} (${summaryHint})`,
    `Verbosity: ${verbosity} (${verbosityHint})`,
  ];
}

function modelDisplayName(model: ModelRef): string {
  const modelId = model.modelID;
  if (modelId === "gpt-5.3-codex") return "ChatGPT Codex 5.3";
  if (modelId === "gpt-5.2-codex") return "ChatGPT Codex 5.2";
  return modelId;
}

function markSelected(label: string, isSelected: boolean): string {
  return isSelected ? `${label} *` : label;
}

function profileLegendLines(): string[] {
  return [
    "Parameters:",
    "- Model: Codex model used in this topic.",
    "- Effort: how deep the model reasons (quality vs speed).",
    "- Summary: how much reasoning summary is shown.",
    "- Verbosity: detail level of the final answer.",
    "- Plain ChatGPT mode is not enabled in this bridge yet; this topic uses Codex profile.",
  ];
}

function formatDurationSeconds(ms: number): string {
  const sec = Math.max(0, Math.round(ms / 1000));
  if (sec < 60) return `${sec}s`;
  const min = Math.floor(sec / 60);
  const rem = sec % 60;
  return `${min}m ${rem}s`;
}

function formatDateTime(ms: number): string {
  const value = new Date(ms);
  const date = value.toISOString().replace("T", " ").slice(0, 19);
  return `${date} UTC`;
}

function shortPreferences(binding: TopicSessionBinding): string {
  return `Reasoning: effort=${binding.reasoningEffort || DEFAULT_REASONING_EFFORT}, summary=${binding.reasoningSummary || "auto"}, verbosity=${binding.textVerbosity || "medium"}`;
}

function collapseLine(value: string, max = 120): string {
  const single = value.replace(/\s+/g, " ").trim();
  if (single.length <= max) {
    return single;
  }
  return `${single.slice(0, Math.max(0, max - 3))}...`;
}

function trimWithEllipsis(value: string, max = 1200): string {
  const trimmed = value.trim();
  if (trimmed.length <= max) {
    return trimmed;
  }
  return `${trimmed.slice(0, Math.max(0, max - 3))}...`;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function escapeHtmlAttr(value: string): string {
  return escapeHtml(value)
    .replaceAll("\"", "&quot;")
    .replaceAll("'", "&#39;");
}

function renderInlineMarkdownToHtml(input: string): string {
  let rendered = escapeHtml(input);
  const placeholders: string[] = [];

  rendered = rendered.replace(/`([^`\n]+)`/g, (_full, code) => {
    const id = placeholders.length;
    placeholders.push(`<code>${code}</code>`);
    return `\u0000CODE_${id}\u0000`;
  });

  rendered = rendered.replace(
    /\[([^\]\n]{1,1000})\]\((https?:\/\/[^\s)]+)\)/gi,
    (_full, label, url) => `<a href="${escapeHtmlAttr(url)}">${label}</a>`,
  );
  rendered = rendered.replace(/\*\*([^\n*][^*\n]*?)\*\*/g, "<b>$1</b>");
  rendered = rendered.replace(/__([^\n_][^_\n]*?)__/g, "<b>$1</b>");
  rendered = rendered.replace(/~~([^\n~][^~\n]*?)~~/g, "<s>$1</s>");
  rendered = rendered.replace(/(^|[\s(])\*([^*\n]+)\*(?=$|[\s).,!?:;])/g, "$1<i>$2</i>");
  rendered = rendered.replace(/(^|[\s(])_([^_\n]+)_(?=$|[\s).,!?:;])/g, "$1<i>$2</i>");

  rendered = rendered.replace(/\u0000CODE_(\d+)\u0000/g, (_full, idx) => {
    const index = Number.parseInt(String(idx), 10);
    return placeholders[index] ?? "";
  });

  return rendered;
}

function renderMarkdownLinesToHtml(input: string): string {
  if (input === "") {
    return "";
  }

  return input
    .split("\n")
    .map((line) => {
      const heading = line.match(/^\s{0,3}#{1,6}\s+(.+)$/);
      if (heading) {
        return `<b>${renderInlineMarkdownToHtml(heading[1].trim())}</b>`;
      }

      const bullet = line.match(/^(\s*)[-*]\s+(.+)$/);
      if (bullet) {
        return `${bullet[1]}• ${renderInlineMarkdownToHtml(bullet[2])}`;
      }

      const numbered = line.match(/^(\s*)(\d+)\.\s+(.+)$/);
      if (numbered) {
        return `${numbered[1]}${numbered[2]}. ${renderInlineMarkdownToHtml(numbered[3])}`;
      }

      const quote = line.match(/^>\s?(.*)$/);
      if (quote) {
        const body = quote[1] ? renderInlineMarkdownToHtml(quote[1]) : "";
        return body ? `&gt; ${body}` : "&gt;";
      }

      return renderInlineMarkdownToHtml(line);
    })
    .join("\n");
}

function renderMarkdownToTelegramHtml(input: string): string {
  if (!input || input.trim() === "") {
    return input;
  }

  let result = "";
  let cursor = 0;
  const codeBlockPattern = /```([a-zA-Z0-9_+-]+)?\n?([\s\S]*?)```/g;

  const renderTextFenceAsQuote = (body: string): string => {
    const normalized = body.replace(/\r\n/g, "\n").trimEnd();
    if (normalized === "") {
      return "<blockquote> </blockquote>";
    }
    const quoted = normalized
      .split("\n")
      .map((line) => renderInlineMarkdownToHtml(line))
      .join("\n");
    return `<blockquote>${quoted}</blockquote>`;
  };

  for (const match of input.matchAll(codeBlockPattern)) {
    if (typeof match.index !== "number") {
      continue;
    }
    const start = match.index;
    const end = start + match[0].length;
    const before = input.slice(cursor, start);
    result += renderMarkdownLinesToHtml(before);

    const language = match[1] ? String(match[1]).trim() : "";
    const codeBody = String(match[2] ?? "");
    const languageLower = language.toLowerCase();
    if (
      languageLower === "text" ||
      languageLower === "quote" ||
      languageLower === "blockquote"
    ) {
      result += renderTextFenceAsQuote(codeBody);
    } else {
      const escapedCode = escapeHtml(codeBody);
      result += language
        ? `<pre><code class="language-${escapeHtmlAttr(language)}">${escapedCode}</code></pre>`
        : `<pre><code>${escapedCode}</code></pre>`;
    }

    cursor = end;
  }

  result += renderMarkdownLinesToHtml(input.slice(cursor));
  return result;
}

function composeReplyContextText(message: InboundTelegramMessage): string | undefined {
  const reply = message.replyContext;
  if (!reply) {
    return undefined;
  }

  const lines: string[] = [];
  if (reply.fromName) {
    lines.push(`From: ${reply.fromName}`);
  }
  lines.push(`Message ID: ${reply.messageId}`);

  const replyText = normalizeTextInput(reply.text, reply.caption);
  if (replyText !== "") {
    lines.push(`Quoted text: ${trimWithEllipsis(replyText, 1500)}`);
  }
  if (reply.hasPhoto) {
    lines.push("Quoted media: photo");
  }
  if (reply.documentName || reply.documentMime) {
    lines.push(
      `Quoted document: ${reply.documentName || "unnamed"}${reply.documentMime ? ` (${reply.documentMime})` : ""}`,
    );
  }

  return lines.join("\n");
}

interface TelegramErrorMeta {
  message: string;
  description: string;
  errorCode?: number;
  retryAfterMs?: number;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function parseTelegramErrorMeta(error: unknown): TelegramErrorMeta {
  const anyError = error as any;
  const message = safeErrorMessage(error);
  const description = typeof anyError?.description === "string"
    ? anyError.description
    : "";
  const errorCode = typeof anyError?.error_code === "number"
    ? anyError.error_code
    : undefined;
  const retryAfterRaw = anyError?.parameters?.retry_after;
  const retryAfterFromParams = typeof retryAfterRaw === "number" && Number.isFinite(retryAfterRaw)
    ? Math.max(0, Math.round(retryAfterRaw * 1000))
    : undefined;

  let retryAfterMs = retryAfterFromParams;
  if (typeof retryAfterMs === "undefined") {
    const combined = `${description} ${message}`.toLowerCase();
    const match = combined.match(/retry after\s+(\d+)/i);
    if (match) {
      const sec = Number.parseInt(match[1], 10);
      if (!Number.isNaN(sec)) {
        retryAfterMs = Math.max(0, sec * 1000);
      }
    }
  }

  return {
    message,
    description,
    errorCode,
    retryAfterMs,
  };
}

function isTopicNotModifiedMeta(meta: TelegramErrorMeta): boolean {
  const combined = `${meta.message} ${meta.description}`.toLowerCase();
  return combined.includes("topic_not_modified") || combined.includes("topic not modified");
}

function isMessageNotModifiedMeta(meta: TelegramErrorMeta): boolean {
  const combined = `${meta.message} ${meta.description}`.toLowerCase();
  return combined.includes("message is not modified");
}

function isFloodMeta(meta: TelegramErrorMeta): boolean {
  if (meta.errorCode === 429) {
    return true;
  }
  if (typeof meta.retryAfterMs === "number") {
    return true;
  }
  const combined = `${meta.message} ${meta.description}`.toLowerCase();
  return combined.includes("too many requests") || combined.includes("flood");
}

function isParseEntitiesMeta(meta: TelegramErrorMeta): boolean {
  const combined = `${meta.message} ${meta.description}`.toLowerCase();
  return (
    combined.includes("can't parse entities") ||
    combined.includes("can't find end tag")
  );
}

function formatPermissionPattern(pattern: unknown): string | undefined {
  if (typeof pattern === "string" && pattern.trim() !== "") {
    return pattern.trim();
  }
  if (Array.isArray(pattern)) {
    const values = pattern
      .map((item) => String(item ?? "").trim())
      .filter(Boolean);
    if (values.length > 0) {
      return values.join(", ");
    }
  }
  return undefined;
}

function formatPermissionMessage(permission: any): string {
  const type = String(permission?.type ?? "unknown");
  const title = String(permission?.title ?? "Permission required");
  const pattern = formatPermissionPattern(permission?.pattern);
  const created = Number(permission?.time?.created ?? 0);
  const lines = [
    `Permission required: ${type}`,
    `Title: ${title}`,
    permission?.id ? `Permission ID: ${String(permission.id)}` : "",
    pattern ? `Pattern: ${pattern}` : "",
    Number.isFinite(created) && created > 0 ? `Created: ${formatDateTime(created)}` : "",
    "Choose action:",
  ];
  return lines.filter(Boolean).join("\n");
}

function flattenPromptParts(parts: PendingPrompt["parts"]): {
  text: string;
  files: PendingPrompt["parts"];
} {
  const textChunks: string[] = [];
  const files: PendingPrompt["parts"] = [];

  for (const part of parts) {
    if (part.type === "text") {
      const value = String(part.text ?? "").trim();
      if (value !== "") {
        textChunks.push(value);
      }
      continue;
    }
    files.push(part);
  }

  return {
    text: textChunks.join("\n\n").trim(),
    files,
  };
}

function mergePrompts(left: PendingPrompt, right: PendingPrompt): PendingPrompt {
  const leftFlat = flattenPromptParts(left.parts);
  const rightFlat = flattenPromptParts(right.parts);
  const mergedText = [leftFlat.text, rightFlat.text].filter(Boolean).join("\n\n---\n\n").trim();
  const mergedParts: PendingPrompt["parts"] = [];
  if (mergedText !== "") {
    mergedParts.push({
      type: "text",
      text: mergedText,
    });
  }
  mergedParts.push(...leftFlat.files, ...rightFlat.files);

  return {
    sourceMessageId: left.sourceMessageId,
    replyToMessageId: left.replyToMessageId,
    userId: left.userId,
    createdAt: right.createdAt,
    mediaGroupId: left.mediaGroupId || right.mediaGroupId,
    parts: mergedParts,
  };
}

export class TelegramForumBridge {
  private readonly config: Config;
  private readonly clientFactory: AuthenticatedOpencodeClientFactory;
  private readonly bot: TelegramBotManager;
  private readonly store: TopicSessionStore;
  private readonly runtime = new Map<string, SessionRuntime>();
  private readonly threadLocks = new Map<string, Promise<void>>();
  private readonly topicNameState = new Map<string, { lastName?: string; nextAllowedAt?: number }>();
  private readonly permissionMessages = new Map<string, { chatId: number; messageId: number; threadId?: number }>();
  private profileCache?: SessionProfile;

  constructor(config: Config, bot: TelegramBotManager) {
    this.config = config;
    this.clientFactory = new AuthenticatedOpencodeClientFactory(config);
    this.bot = bot;
    this.store = new TopicSessionStore(config.stateFilePath);
  }

  async handleInboundMessage(message: InboundTelegramMessage): Promise<void> {
    const key = `${message.chatId}:${message.threadId ?? 0}`;
    await this.runThreadLock(key, async () => {
      const command = parseOcCommand(message.text ?? "");
      if (command) {
        await this.handleCommand(message, command.name, command.args);
        return;
      }

      if (typeof message.threadId !== "number") {
        await this.bot.sendMessage({
          chatId: message.chatId,
          text: "Use /oc new <absolute_workspace_path> in this chat to create a session topic.",
          replyToMessageId: message.messageId,
        });
        return;
      }

      const binding = this.store.getByThread(message.chatId, message.threadId);
      if (!binding || binding.state === "closed") {
        await this.bot.sendMessage({
          chatId: message.chatId,
          threadId: message.threadId,
          text: "Topic is not bound to an OpenCode session. Use /oc new <path>.",
          replyToMessageId: message.messageId,
        });
        return;
      }

      const prompt = await this.buildPrompt(message);
      if (!prompt) {
        await this.bot.sendMessage({
          chatId: message.chatId,
          threadId: message.threadId,
          text: "Message ignored: empty content and no supported attachments.",
          replyToMessageId: message.messageId,
        });
        return;
      }

      await this.enqueuePrompt(binding, prompt);
    });
  }

  async handleEvent(event: unknown): Promise<void> {
    const eventType = String((event as any)?.type ?? "");

    if (eventType === "session.updated") {
      const sessionId = String((event as any)?.properties?.info?.id ?? "");
      if (!sessionId) {
        return;
      }
      const binding = this.store.patchBySession(sessionId, {
        sessionTitle: (event as any)?.properties?.info?.title,
      });
      if (binding) {
        await this.updateTopicName(binding);
      }
      return;
    }

    if (eventType === "message.updated") {
      const info = (event as any)?.properties?.info;
      if (!info) {
        return;
      }

      if (info.role === "assistant" && typeof info.sessionID === "string") {
        const state = this.getRuntime(info.sessionID);
        state.lastAssistantMessageId = info.id;
      }

      if (info.role === "assistant" && info.error && typeof info.sessionID === "string") {
        const binding = this.store.getBySession(info.sessionID);
        if (binding) {
          await this.sendToSessionThread(
            binding,
            `Error: ${parseErrorPayload(info.error?.data?.message ?? info.error)}`,
          );
        }
      }
      return;
    }

    if (eventType === "message.part.updated") {
      const part = (event as any)?.properties?.part;
      const delta = String((event as any)?.properties?.delta ?? "");
      const sessionId = String(part?.sessionID ?? "");
      if (!sessionId) {
        return;
      }
      const binding = this.store.getBySession(sessionId);
      if (!binding) {
        return;
      }
      const runtime = this.getRuntime(sessionId);
      if (!runtime.inFlight) {
        return;
      }

      this.captureLivePart(runtime, part, delta);
      await this.refreshLiveProgress(binding);
      return;
    }

    if (eventType === "permission.updated") {
      const permission = (event as any)?.properties ?? {};
      const sessionId = String(permission?.sessionID ?? "");
      const permissionId = String(permission?.id ?? "");
      if (!sessionId || !permissionId) {
        return;
      }
      const binding = this.store.getBySession(sessionId);
      if (!binding) {
        return;
      }

      const tracked = this.permissionMessages.get(permissionId);
      if (tracked) {
        try {
          await this.bot.editMessage({
            chatId: tracked.chatId,
            messageId: tracked.messageId,
            text: formatPermissionMessage(permission),
            inlineKeyboard: this.buildPermissionKeyboard(permissionId),
          });
          return;
        } catch {
          this.permissionMessages.delete(permissionId);
        }
      }

      const sent = await this.bot.sendMessage({
        chatId: binding.chatId,
        threadId: binding.threadId,
        text: formatPermissionMessage(permission),
        inlineKeyboard: this.buildPermissionKeyboard(permissionId),
      });
      this.permissionMessages.set(permissionId, {
        chatId: binding.chatId,
        threadId: binding.threadId,
        messageId: sent.message_id,
      });
      return;
    }

    if (eventType === "permission.replied") {
      const props = (event as any)?.properties ?? {};
      const sessionId = String(props?.sessionID ?? "");
      const permissionId = String(props?.permissionID ?? "");
      const response = String(props?.response ?? "");
      if (!sessionId || !permissionId) {
        return;
      }
      const binding = this.store.getBySession(sessionId);
      if (!binding) {
        return;
      }

      const tracked = this.permissionMessages.get(permissionId);
      if (tracked) {
        try {
          await this.bot.editMessage({
            chatId: tracked.chatId,
            messageId: tracked.messageId,
            text: `Permission handled: ${permissionId}\nResponse: ${response || "unknown"}`,
          });
          this.permissionMessages.delete(permissionId);
          return;
        } catch (error) {
          console.error("[Bridge] Failed to edit permission message:", error);
          this.permissionMessages.delete(permissionId);
        }
      }

      await this.sendToSessionThread(
        binding,
        `Permission handled: ${permissionId} -> ${response || "unknown"}`,
      );
      return;
    }

    if (eventType === "question.asked") {
      const sessionId = String((event as any)?.properties?.sessionID ?? "");
      const binding = this.store.getBySession(sessionId);
      const questions = Array.isArray((event as any)?.properties?.questions)
        ? (event as any).properties.questions
        : [];
      if (!binding || questions.length === 0) {
        return;
      }

      const formatted = questions
        .map((question: any, index: number) => {
          const header = question?.header ? `${question.header}: ` : "";
          return `${index + 1}. ${header}${String(question?.question ?? "")}`;
        })
        .join("\n");

      await this.sendToSessionThread(binding, `Question from OpenCode:\n${formatted}`);
      return;
    }

    if (eventType === "session.status") {
      const sessionId = String((event as any)?.properties?.sessionID ?? "");
      const binding = this.store.getBySession(sessionId);
      if (!binding) {
        return;
      }
      const runtime = this.getRuntime(sessionId);
      if (!runtime.inFlight) {
        return;
      }
      const statusType = String((event as any)?.properties?.status?.type ?? "");
      if (statusType === "busy") {
        runtime.liveStage = "busy";
      } else if (statusType === "retry") {
        const attempt = Number((event as any)?.properties?.status?.attempt ?? 0);
        runtime.liveStage = attempt > 0 ? `retry #${attempt}` : "retry";
      } else if (statusType === "idle") {
        runtime.liveStage = "finalizing";
      }
      await this.refreshLiveProgress(binding);
      return;
    }

    if (eventType === "session.idle") {
      // Completion is handled in dispatchPrompt via session.prompt.
      return;
    }

    if (eventType === "session.error") {
      const sessionId = String((event as any)?.properties?.sessionID ?? "");
      const binding = this.store.getBySession(sessionId);
      if (!binding) {
        return;
      }
      const runtime = this.getRuntime(sessionId);
      if (!runtime.inFlight) {
        return;
      }

      const rawError = parseErrorPayload(
        (event as any)?.properties?.error?.data?.message ?? (event as any)?.properties?.error,
      );
      await this.onSessionError(binding, rawError);
    }
  }

  private async handleCommand(
    message: InboundTelegramMessage,
    commandName: string,
    args: string,
  ): Promise<void> {
    const threadId = message.threadId;

    if (commandName === "new") {
      await this.commandNew(message, args);
      return;
    }

    if (commandName === "import") {
      await this.commandImport(message, args);
      return;
    }

    if (commandName === "status") {
      if (typeof threadId !== "number") {
        await this.bot.sendMessage({
          chatId: message.chatId,
          text: "Use /oc status inside a session topic.",
          replyToMessageId: message.messageId,
        });
        return;
      }

      const binding = this.store.getByThread(message.chatId, threadId);
      if (!binding) {
        await this.bot.sendMessage({
          chatId: message.chatId,
          threadId,
          text: "No mapped session in this topic.",
        });
        return;
      }

      const runtime = this.getRuntime(binding.sessionId);
      await this.sendToSessionThread(
        binding,
        [
          `Status: ${binding.state}`,
          `Workspace: ${binding.workspacePath}`,
          `Session: ${binding.sessionId}`,
          ...formatSessionProfile({
            model: binding.model,
            reasoningEffort: binding.reasoningEffort,
            reasoningSummary: binding.reasoningSummary,
            textVerbosity: binding.textVerbosity,
          }),
          "",
          ...profileLegendLines(),
          `Pending queue: ${runtime.pending.length}`,
          binding.lastError ? `Last error: ${binding.lastError}` : "",
        ]
          .filter(Boolean)
          .join("\n"),
        this.buildSettingsKeyboard(binding),
      );
      return;
    }

    if (commandName === "set") {
      await this.commandSet(message, args);
      return;
    }

    if (commandName === "rename") {
      await this.commandRename(message, args);
      return;
    }

    if (commandName === "undo") {
      await this.commandRevert(message, "undo");
      return;
    }

    if (commandName === "redo") {
      await this.commandRevert(message, "redo");
      return;
    }

    if (commandName === "sessions") {
      await this.commandImportList(message, 12, 0);
      return;
    }

    if (commandName === "perm" || commandName === "permission") {
      await this.commandPermission(message, args);
      return;
    }

    if (commandName === "stop") {
      if (typeof threadId !== "number") {
        return;
      }
      const binding = this.store.getByThread(message.chatId, threadId);
      if (!binding) {
        return;
      }

      await this.expectOk(
        this.getClient(binding.workspacePath).session.abort({
          path: { id: binding.sessionId },
        }),
      );
      const runtime = this.getRuntime(binding.sessionId);
      runtime.inFlight = false;
      await this.upsertProgress(
        binding,
        [
          "Status: aborted",
          `Session: ${binding.sessionId}`,
          `Model: ${modelDisplayName(binding.model)}`,
          shortPreferences(binding),
        ].join("\n"),
      );
      return;
    }

    if (commandName === "close") {
      if (typeof threadId !== "number") {
        return;
      }
      const binding = this.store.closeByThread(message.chatId, threadId);
      if (!binding) {
        return;
      }
      await this.updateTopicName(binding);
      await this.sendToSessionThread(binding, "Session mapping closed for this topic.");
      return;
    }

    await this.bot.sendMessage({
      chatId: message.chatId,
      threadId,
      text:
        "Commands:\n/oc new <absolute_workspace_path>\n/oc import list\n/oc import <session_id>\n/oc sessions\n/oc status\n/oc set <model|effort|summary|verbosity> <value>\n/oc perm <permission_id> <once|always|reject>\n/oc rename <title>\n/oc undo\n/oc redo\n/oc stop\n/oc close",
      replyToMessageId: message.messageId,
    });
  }

  private async commandImport(
    message: InboundTelegramMessage,
    args: string,
  ): Promise<void> {
    const normalized = args.trim();
    // Support paging: `list [limit] [offset]`
    const listMatch = normalized.match(/^list(?:\s+(\d+))?(?:\s+(\d+))?$/i);

    if (normalized === "" || listMatch) {
      const limitRaw = listMatch?.[1] ? Number.parseInt(listMatch[1], 10) : 12;
      const offsetRaw = listMatch?.[2] ? Number.parseInt(listMatch[2], 10) : 0;
      const limit = Number.isNaN(limitRaw) ? 12 : limitRaw;
      const offset = Number.isNaN(offsetRaw) ? 0 : offsetRaw;
      await this.commandImportList(message, limit, offset);
      return;
    }

    await this.commandImportById(message, normalized);
  }

  private async commandSet(
    message: InboundTelegramMessage,
    args: string,
  ): Promise<void> {
    if (typeof message.threadId !== "number") {
      await this.bot.sendMessage({
        chatId: message.chatId,
        text: "Use /oc set inside a session topic.",
        replyToMessageId: message.messageId,
      });
      return;
    }

    const binding = this.store.getByThread(message.chatId, message.threadId);
    if (!binding || binding.state === "closed") {
      await this.bot.sendMessage({
        chatId: message.chatId,
        threadId: message.threadId,
        text: "No mapped session in this topic.",
      });
      return;
    }

    const [rawKey, rawValue] = args.trim().split(/\s+/, 2);
    const key = (rawKey || "").toLowerCase();
    const value = (rawValue || "").toLowerCase();

    if (!key || !value) {
      await this.sendToSessionThread(
        binding,
        "Usage: /oc set <model|effort|summary|verbosity> <value>",
      );
      return;
    }

    const patch: Partial<TopicSessionBinding> = {};
    if (key === "model") {
      if (!["gpt-5.3-codex", "gpt-5.2-codex"].includes(value)) {
        await this.sendToSessionThread(
          binding,
          "Allowed model values in this bridge: gpt-5.3-codex, gpt-5.2-codex",
        );
        return;
      }
      patch.model = { ...binding.model, modelID: value };
    } else if (key === "effort" || key === "reasoning_effort") {
      const normalizedEffort = this.normalizeEffortValue(value);
      if (!normalizedEffort) {
        await this.sendToSessionThread(
          binding,
          "Allowed effort values: low, medium, high, xhigh, none (aliases: extra_high, extra-high, x-high)",
        );
        return;
      }
      patch.reasoningEffort = normalizedEffort;
    } else if (key === "summary" || key === "reasoning_summary") {
      if (!["auto", "none", "detailed"].includes(value)) {
        await this.sendToSessionThread(
          binding,
          "Allowed summary values: auto, none, detailed",
        );
        return;
      }
      patch.reasoningSummary = value;
    } else if (key === "verbosity" || key === "text_verbosity") {
      if (!["low", "medium", "high"].includes(value)) {
        await this.sendToSessionThread(
          binding,
          "Allowed verbosity values: low, medium, high",
        );
        return;
      }
      patch.textVerbosity = value;
    } else {
      await this.sendToSessionThread(
        binding,
        "Unknown key. Use: model, effort, summary, verbosity",
      );
      return;
    }

    const updated = this.store.patchBySession(binding.sessionId, patch);
    if (!updated) {
      await this.sendToSessionThread(binding, "Failed to update settings.");
      return;
    }

    await this.sendToSessionThread(
      updated,
      [
        "Session settings updated.",
        ...formatSessionProfile({
          model: updated.model,
          reasoningEffort: updated.reasoningEffort,
          reasoningSummary: updated.reasoningSummary,
          textVerbosity: updated.textVerbosity,
        }),
        "",
        ...profileLegendLines(),
      ].join("\n"),
      this.buildSettingsKeyboard(updated),
    );
  }

  private async commandPermission(
    message: InboundTelegramMessage,
    args: string,
  ): Promise<void> {
    if (typeof message.threadId !== "number") {
      await this.bot.sendMessage({
        chatId: message.chatId,
        text: "Use /oc perm inside a session topic.",
        replyToMessageId: message.messageId,
      });
      return;
    }

    const binding = this.store.getByThread(message.chatId, message.threadId);
    if (!binding || binding.state === "closed") {
      await this.bot.sendMessage({
        chatId: message.chatId,
        threadId: message.threadId,
        text: "No mapped session in this topic.",
      });
      return;
    }

    const parts = args.trim().split(/\s+/).filter(Boolean);
    const permissionId = parts[0] ?? "";
    const rawResponse = (parts[1] ?? "").toLowerCase();
    const response = rawResponse === "deny" ? "reject" : rawResponse;

    if (!permissionId || !["once", "always", "reject"].includes(response)) {
      await this.sendToSessionThread(
        binding,
        "Usage: /oc perm <permission_id> <once|always|reject>",
      );
      return;
    }

    try {
      await this.expectData<boolean>(
        this.getClient(binding.workspacePath).postSessionIdPermissionsPermissionId({
          path: {
            id: binding.sessionId,
            permissionID: permissionId,
          },
          body: {
            response: response as "once" | "always" | "reject",
          },
        }),
      );

      const tracked = this.permissionMessages.get(permissionId);
      if (tracked) {
        try {
          await this.bot.editMessage({
            chatId: tracked.chatId,
            messageId: tracked.messageId,
            text: `Permission handled: ${permissionId}\nResponse: ${response}`,
          });
          this.permissionMessages.delete(permissionId);
        } catch {
          // Keep best-effort behavior; ack in thread below.
        }
      }

      await this.sendToSessionThread(
        binding,
        `Permission response sent: ${permissionId} -> ${response}`,
      );
    } catch (error) {
      await this.sendToSessionThread(
        binding,
        `Failed to respond to permission: ${safeErrorMessage(error)}`,
      );
    }
  }

  private async commandRename(
    message: InboundTelegramMessage,
    args: string,
  ): Promise<void> {
    if (typeof message.threadId !== "number") {
      await this.bot.sendMessage({
        chatId: message.chatId,
        text: "Use /oc rename inside a session topic.",
        replyToMessageId: message.messageId,
      });
      return;
    }

    const binding = this.store.getByThread(message.chatId, message.threadId);
    if (!binding || binding.state === "closed") {
      await this.bot.sendMessage({
        chatId: message.chatId,
        threadId: message.threadId,
        text: "No mapped session in this topic.",
      });
      return;
    }

    const title = args.trim();
    if (!title) {
      await this.sendToSessionThread(binding, "Usage: /oc rename <title>");
      return;
    }

    try {
      const updatedSession = await this.expectData<Session>(
        this.getClient(binding.workspacePath).session.update({
          path: { id: binding.sessionId },
          body: { title },
        }),
      );

      const updated = this.store.patchBySession(binding.sessionId, {
        sessionTitle: updatedSession.title || title,
      });
      await this.updateTopicName(updated ?? binding);

      await this.sendToSessionThread(
        updated ?? binding,
        `Session renamed to: ${updatedSession.title || title}`,
      );
    } catch (error) {
      await this.sendToSessionThread(
        binding,
        `Failed to rename session: ${safeErrorMessage(error)}`,
      );
    }
  }

  private async commandRevert(
    message: InboundTelegramMessage,
    mode: "undo" | "redo",
  ): Promise<void> {
    if (typeof message.threadId !== "number") {
      await this.bot.sendMessage({
        chatId: message.chatId,
        text: `Use /oc ${mode} inside a session topic.`,
        replyToMessageId: message.messageId,
      });
      return;
    }

    const binding = this.store.getByThread(message.chatId, message.threadId);
    if (!binding || binding.state === "closed") {
      await this.bot.sendMessage({
        chatId: message.chatId,
        threadId: message.threadId,
        text: "No mapped session in this topic.",
      });
      return;
    }

    try {
      if (mode === "undo") {
        await this.expectOk(
          this.getClient(binding.workspacePath).session.revert({
            path: { id: binding.sessionId },
          }),
        );
      } else {
        await this.expectOk(
          this.getClient(binding.workspacePath).session.unrevert({
            path: { id: binding.sessionId },
          }),
        );
      }

      await this.sendToSessionThread(
        binding,
        mode === "undo" ? "Undo applied." : "Redo applied.",
      );
    } catch (error) {
      await this.sendToSessionThread(
        binding,
        `Failed to ${mode}: ${safeErrorMessage(error)}`,
      );
    }
  }

  private async commandImportList(
    message: InboundTelegramMessage,
    limit: number,
    offset: number,
  ): Promise<void> {
    const sessions = await this.collectSessions();

    if (sessions.length === 0) {
      await this.bot.sendMessage({
        chatId: message.chatId,
        threadId: message.threadId,
        text: "No sessions found in allowed workspace roots.",
      });
      return;
    }

    const pageSize = Math.max(1, Math.min(limit, 20));
    const safeOffset = Math.max(
      0,
      Math.min(offset, Math.max(0, sessions.length - 1)),
    );
    const selected = sessions.slice(safeOffset, safeOffset + pageSize);
    const rows = selected
      .map((session, index) => {
        const mapped = this.store.getBySession(session.id);
        const mapFlag = mapped ? "mapped" : "free";
        const updated = new Date(session.updatedAt).toISOString().replace("T", " ").slice(0, 16);
        return `${safeOffset + index + 1}. ${session.id} | ${workspaceLabel(session.directory)} | ${mapFlag} | ${updated}\n   ${session.title}`;
      })
      .join("\n\n");

    const inlineKeyboard = selected.map((session, index) => {
      const title = session.title?.trim() || workspaceLabel(session.directory);
      const label = truncateButtonText(`${safeOffset + index + 1}. ${title}`);
      return [{ text: label, callbackData: `ocimp:${session.id}` }];
    });

    const navRow: { text: string; callbackData: string }[] = [];
    if (safeOffset > 0) {
      navRow.push({
        text: "Prev",
        callbackData: `ocimp:list:${pageSize}:${Math.max(0, safeOffset - pageSize)}`,
      });
    }
    if (safeOffset + pageSize < sessions.length) {
      navRow.push({
        text: "Next",
        callbackData: `ocimp:list:${pageSize}:${safeOffset + pageSize}`,
      });
    }
    if (navRow.length > 0) {
      inlineKeyboard.push(navRow);
    }
    inlineKeyboard.push([
      { text: "Refresh", callbackData: `ocimp:list:${pageSize}:${safeOffset}` },
    ]);

    await this.bot.sendMessage({
      chatId: message.chatId,
      threadId: message.threadId,
      text:
        `Sessions available for import (${safeOffset + 1}-${Math.min(safeOffset + pageSize, sessions.length)} of ${sessions.length}):\n\n${rows}\n\nTap a button to import that session into this topic, or use /oc import <session_id>.`,
      inlineKeyboard,
    });
  }

  private async commandImportById(
    message: InboundTelegramMessage,
    sessionId: string,
  ): Promise<void> {
    const found = await this.findSessionById(sessionId);
    if (!found) {
      await this.bot.sendMessage({
        chatId: message.chatId,
        threadId: message.threadId,
        text: `Session not found in allowed roots: ${sessionId}`,
      });
      return;
    }

    const resolvedPath = realpathSync(found.directory);
    if (!isPathWithinRoots(resolvedPath, this.config.allowedWorkspaceRoots)) {
      await this.bot.sendMessage({
        chatId: message.chatId,
        threadId: message.threadId,
        text: `Session directory is outside allowed roots: ${resolvedPath}`,
      });
      return;
    }

    const target = typeof message.threadId === "number"
      ? {
        threadId: message.threadId,
        usedCurrentThreadFallback: true,
      }
      : await this.resolveTargetThread(message, resolvedPath, found.title);
    if (!target) {
      return;
    }

    const existing = this.store.getByThread(message.chatId, target.threadId);
    if (existing && existing.state !== "closed") {
      await this.bot.sendMessage({
        chatId: message.chatId,
        threadId: target.threadId,
        text:
          "This topic is already bound to an active session. Use /oc status or /oc close first.",
      });
      return;
    }

    const profile = await this.resolveSessionProfile(resolvedPath, found.id);
    const binding: TopicSessionBinding = {
      chatId: message.chatId,
      threadId: target.threadId,
      workspacePath: resolvedPath,
      sessionId: found.id,
      state: "idle",
      model: profile.model,
      reasoningEffort: profile.reasoningEffort,
      reasoningSummary: profile.reasoningSummary,
      textVerbosity: profile.textVerbosity,
      createdBy: message.userId,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      sessionTitle: found.title,
    };

    this.store.upsert(binding);
    this.getRuntime(binding.sessionId);
    await this.updateTopicName(binding);

    await this.sendToSessionThread(
      binding,
      [
        target.usedCurrentThreadFallback
          ? "Imported existing OpenCode session into current topic."
          : "Imported existing OpenCode session.",
        `Workspace: ${binding.workspacePath}`,
        `Session: ${binding.sessionId}`,
        ...formatSessionProfile(profile),
        "",
        ...profileLegendLines(),
        "Send your prompt in this topic.",
      ].join("\n"),
      this.buildSettingsKeyboard(binding),
    );
  }

  private async commandNew(message: InboundTelegramMessage, args: string): Promise<void> {
    if (!args) {
      await this.bot.sendMessage({
        chatId: message.chatId,
        threadId: message.threadId,
        text: "Usage: /oc new <absolute_workspace_path>",
        replyToMessageId: message.messageId,
      });
      return;
    }

    const requestedPath = ensureAbsolutePath(args);
    const resolvedPath = realpathSync(requestedPath);
    if (!isPathWithinRoots(resolvedPath, this.config.allowedWorkspaceRoots)) {
      await this.bot.sendMessage({
        chatId: message.chatId,
        threadId: message.threadId,
        text: `Path is outside allowed roots: ${resolvedPath}`,
      });
      return;
    }

    const target = await this.resolveTargetThread(message, resolvedPath, "creating");
    if (!target) {
      return;
    }

    const existing = this.store.getByThread(message.chatId, target.threadId);
    if (existing && existing.state !== "closed") {
      await this.bot.sendMessage({
        chatId: message.chatId,
        threadId: target.threadId,
        text:
          "This topic is already bound to an active session. Use /oc status or /oc close first.",
      });
      return;
    }

    try {
      const created = await this.expectData<Session>(
        this.getClient(resolvedPath).session.create({
          body: {
            title: `Telegram ${workspaceLabel(resolvedPath)} ${new Date().toISOString()}`,
          },
        }),
      );

      const profile = await this.getDefaultProfile(resolvedPath);
      const binding: TopicSessionBinding = {
        chatId: message.chatId,
        threadId: target.threadId,
        workspacePath: resolvedPath,
        sessionId: created.id,
        state: "idle",
        model: profile.model,
        reasoningEffort: profile.reasoningEffort,
        reasoningSummary: profile.reasoningSummary,
        textVerbosity: profile.textVerbosity,
        createdBy: message.userId,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        sessionTitle: created.title,
      };

      this.store.upsert(binding);
      this.getRuntime(binding.sessionId);
      await this.updateTopicName(binding);

      await this.sendToSessionThread(
        binding,
        [
          target.usedCurrentThreadFallback
            ? "OpenCode session created in current topic."
            : "OpenCode session created.",
          `Workspace: ${binding.workspacePath}`,
          `Session: ${binding.sessionId}`,
          ...formatSessionProfile(profile),
          "",
          ...profileLegendLines(),
          "Send your prompt in this topic.",
        ].join("\n"),
        this.buildSettingsKeyboard(binding),
      );
    } catch (error) {
      const errorText = safeErrorMessage(error);
      await this.bot.sendMessage({
        chatId: message.chatId,
        threadId: target.threadId,
        text: `Failed to create OpenCode session: ${errorText}`,
      });
    }
  }

  private async resolveTargetThread(
    message: InboundTelegramMessage,
    workspacePath: string,
    titleLabel: string,
  ): Promise<{ threadId: number; usedCurrentThreadFallback: boolean } | undefined> {
    try {
      const topic = await this.bot.createForumTopic(
        message.chatId,
        truncateTopicName(`${workspaceLabel(workspacePath)} | ${titleLabel}`),
      );
      return {
        threadId: topic.message_thread_id,
        usedCurrentThreadFallback: false,
      };
    } catch (error) {
      const errorText = safeErrorMessage(error);
      if (
        typeof message.threadId === "number" &&
        isTopicCreationPermissionError(errorText)
      ) {
        await this.bot.sendMessage({
          chatId: message.chatId,
          threadId: message.threadId,
          text:
            "Bot has no rights to create new topics, using current topic for this session.",
        });
        return {
          threadId: message.threadId,
          usedCurrentThreadFallback: true,
        };
      }

      await this.bot.sendMessage({
        chatId: message.chatId,
        threadId: message.threadId,
        text: `Failed to create forum topic: ${errorText}`,
      });
      return undefined;
    }
  }

  private async collectSessions(): Promise<SessionListItem[]> {
    const all: SessionListItem[] = [];

    for (const root of this.config.allowedWorkspaceRoots) {
      try {
        const list = await this.expectData<Session[]>(this.getClient(root).session.list());
        for (const item of list) {
          all.push({
            id: item.id,
            title: item.title,
            directory: item.directory,
            updatedAt: Number(item.time?.updated ?? item.time?.created ?? 0),
          });
        }
      } catch (error) {
        console.error(`[Bridge] Failed to list sessions for ${root}:`, error);
      }
    }

    const uniq = new Map<string, SessionListItem>();
    for (const item of all) {
      const prev = uniq.get(item.id);
      if (!prev || item.updatedAt > prev.updatedAt) {
        uniq.set(item.id, item);
      }
    }

    return Array.from(uniq.values()).sort((a, b) => b.updatedAt - a.updatedAt);
  }

  private async findSessionById(
    sessionId: string,
  ): Promise<SessionListItem | undefined> {
    const sessions = await this.collectSessions();
    return sessions.find((session) => session.id === sessionId);
  }

  private async resolveSessionProfile(
    directory: string,
    sessionId: string,
  ): Promise<SessionProfile> {
    const profile = { ...(await this.getDefaultProfile(directory)) };

    try {
      const messages = await this.expectData<SessionMessagesResponses[200]>(
        this.getClient(directory).session.messages({
          path: { id: sessionId },
          query: { limit: 200 },
        }),
      );

      for (const entry of messages) {
        const info = (entry as any)?.info;
        if (
          info?.role === "user" &&
          typeof info?.model?.providerID === "string" &&
          typeof info?.model?.modelID === "string"
        ) {
          profile.model = {
            providerID: info.model.providerID,
            modelID: info.model.modelID,
          };
          break;
        }
      }
    } catch (error) {
      console.error("[Bridge] Failed to resolve session profile:", error);
    }

    return profile;
  }

  private async getDefaultProfile(directory: string): Promise<SessionProfile> {
    if (this.profileCache) {
      return this.profileCache;
    }

    const fallback: SessionProfile = {
      model: this.config.defaultModel,
      reasoningEffort: DEFAULT_REASONING_EFFORT,
    };

    try {
      const configData = await this.expectData<any>(
        this.getClient(directory).config.get(),
      );
      const options = configData?.provider?.openai?.options;
      this.profileCache = {
        model: this.config.defaultModel,
        reasoningEffort: DEFAULT_REASONING_EFFORT,
        reasoningSummary:
          typeof options?.reasoningSummary === "string"
            ? options.reasoningSummary
            : undefined,
        textVerbosity:
          typeof options?.textVerbosity === "string"
            ? options.textVerbosity
            : undefined,
      };
      return this.profileCache;
    } catch (error) {
      console.error("[Bridge] Failed to fetch default profile:", error);
      this.profileCache = fallback;
      return fallback;
    }
  }

  private async buildPrompt(
    message: InboundTelegramMessage,
  ): Promise<PendingPrompt | undefined> {
    const userText = normalizeTextInput(message.text, message.caption);
    const replyContextText = composeReplyContextText(message);
    const text = [
      replyContextText ? `Reply context:\n${replyContextText}` : "",
      userText !== "" ? `User message:\n${userText}` : "",
    ]
      .filter(Boolean)
      .join("\n\n")
      .trim();
    const parts: PendingPrompt["parts"] = [];

    if (text !== "") {
      parts.push({
        type: "text",
        text,
      });
    }

    if (message.photoFileId) {
      const downloaded = await this.bot.downloadFile(message.photoFileId);
      if (downloaded.buffer.byteLength > this.config.maxAttachmentBytes) {
        throw new Error(
          `Photo exceeds TELEGRAM_MAX_ATTACHMENT_BYTES (${this.config.maxAttachmentBytes}).`,
        );
      }

      const imageMime = downloaded.mime.startsWith("image/")
        ? downloaded.mime
        : "image/jpeg";
      parts.push({
        type: "file",
        mime: imageMime,
        filename: basename(downloaded.filePath) || "telegram-photo.jpg",
        url: toDataUrl(imageMime, downloaded.buffer),
      });
    }

    if (message.document) {
      const downloaded = await this.bot.downloadFile(message.document.fileId);
      if (downloaded.buffer.byteLength > this.config.maxAttachmentBytes) {
        throw new Error(
          `Document exceeds TELEGRAM_MAX_ATTACHMENT_BYTES (${this.config.maxAttachmentBytes}).`,
        );
      }

      const mime = message.document.mime || downloaded.mime || "application/octet-stream";
      parts.push({
        type: "file",
        mime,
        filename:
          message.document.filename || basename(downloaded.filePath) || "telegram-document",
        url: toDataUrl(mime, downloaded.buffer),
      });
    }

    if (parts.length === 0) {
      return undefined;
    }

    return {
      sourceMessageId: message.messageId,
      replyToMessageId: message.replyContext?.messageId,
      userId: message.userId,
      createdAt: Date.now(),
      mediaGroupId: message.mediaGroupId,
      parts,
    };
  }

  private async enqueuePrompt(
    binding: TopicSessionBinding,
    prompt: PendingPrompt,
  ): Promise<void> {
    const runtime = this.getRuntime(binding.sessionId);
    if (runtime.inFlight) {
      const tail = runtime.pending.at(-1);
      if (tail && this.shouldCoalescePrompts(tail, prompt)) {
        runtime.pending[runtime.pending.length - 1] = mergePrompts(tail, prompt);
      } else {
        runtime.pending.push(prompt);
      }
      await this.refreshLiveProgress(binding);
      return;
    }

    if (runtime.stagedPrompt) {
      if (this.shouldCoalescePrompts(runtime.stagedPrompt, prompt)) {
        runtime.stagedPrompt = mergePrompts(runtime.stagedPrompt, prompt);
      } else {
        const previous = runtime.stagedPrompt;
        runtime.stagedPrompt = prompt;
        if (runtime.stagedTimer) {
          clearTimeout(runtime.stagedTimer);
          runtime.stagedTimer = undefined;
        }
        // Flush older staged message immediately, keep latest staged in debounce window.
        void this.dispatchPrompt(binding, previous);
      }
    } else {
      runtime.stagedPrompt = prompt;
    }

    if (!runtime.stagedTimer) {
      runtime.stagedTimer = setTimeout(() => {
        void this.flushStagedPrompt(binding).catch((error) => {
          console.error("[Bridge] Failed to flush staged prompt:", error);
        });
      }, PROMPT_COALESCE_MS);
    }
  }

  private shouldCoalescePrompts(left: PendingPrompt, right: PendingPrompt): boolean {
    if (left.userId !== right.userId) {
      return false;
    }

    if (left.mediaGroupId && right.mediaGroupId) {
      return left.mediaGroupId === right.mediaGroupId;
    }

    const delta = Math.abs(right.createdAt - left.createdAt);
    if (right.replyToMessageId === left.sourceMessageId) {
      return delta <= 30_000;
    }
    return delta <= PROMPT_COALESCE_MS;
  }

  private async flushStagedPrompt(binding: TopicSessionBinding): Promise<void> {
    const runtime = this.getRuntime(binding.sessionId);
    if (runtime.stagedTimer) {
      clearTimeout(runtime.stagedTimer);
      runtime.stagedTimer = undefined;
    }

    const staged = runtime.stagedPrompt;
    runtime.stagedPrompt = undefined;
    if (!staged) {
      return;
    }

    if (runtime.inFlight) {
      const tail = runtime.pending.at(-1);
      if (tail && this.shouldCoalescePrompts(tail, staged)) {
        runtime.pending[runtime.pending.length - 1] = mergePrompts(tail, staged);
      } else {
        runtime.pending.push(staged);
      }
      return;
    }

    // Do not block thread lock on long model runs.
    void this.dispatchPrompt(binding, staged);
  }

  private async dispatchPrompt(
    binding: TopicSessionBinding,
    prompt: PendingPrompt,
  ): Promise<void> {
    const runtime = this.getRuntime(binding.sessionId);
    const effectiveModel = this.getEffectiveModel(binding);
    const systemPreferences = this.buildSystemPreferences(binding);

    const bodyParts = prompt.parts.map((part) => {
      if (part.type === "text") {
        return {
          type: "text" as const,
          text: part.text ?? "",
        };
      }

      return {
        type: "file" as const,
        mime: part.mime ?? "application/octet-stream",
        filename: part.filename,
        url: part.url ?? "",
      };
    });

    const retryingSamePrompt = runtime.lastPrompt?.sourceMessageId === prompt.sourceMessageId;
    runtime.inFlight = true;
    runtime.lastPrompt = prompt;
    if (!retryingSamePrompt) {
      runtime.retriedAfterCompaction = false;
    }
    runtime.lastDeliveredAssistantMessageId = "";
    runtime.liveStage = "starting";
    runtime.liveDetail = undefined;
    runtime.runStartedAt = Date.now();

    this.store.patchBySession(binding.sessionId, {
      state: "active",
      lastError: undefined,
    });
    await this.updateTopicName(binding);
    this.startLiveProgress(binding);
    await this.refreshLiveProgress(binding);

    try {
      const response = await this.expectData<SessionPromptResponses[200]>(
        this.getClient(binding.workspacePath).session.prompt({
          path: { id: binding.sessionId },
          body: {
            model: effectiveModel,
            system: systemPreferences,
            parts: bodyParts,
          },
        }),
      );
      const responseError = (response as any)?.info?.error;
      if (responseError) {
        throw new Error(parseErrorPayload((responseError as any)?.data?.message ?? responseError));
      }

      this.stopLiveProgress(binding.sessionId);
      runtime.inFlight = false;
      this.store.patchBySession(binding.sessionId, {
        state: "idle",
        lastError: undefined,
      });
      await this.updateTopicName(binding);

      const duration = runtime.runStartedAt
        ? formatDurationSeconds(Date.now() - runtime.runStartedAt)
        : "n/a";
      await this.upsertProgress(
        binding,
        [
          "Status: done",
          `Session: ${binding.sessionId}`,
          `Model: ${modelDisplayName(binding.model)}`,
          shortPreferences(binding),
          `Duration: ${duration}`,
          `Finished: ${formatDateTime(Date.now())}`,
          `Queue: ${runtime.pending.length}`,
        ].join("\n"),
      );

      let assistantText = extractAssistantText(response.parts ?? []);
      if (
        assistantText === EMPTY_ASSISTANT_OUTPUT ||
        assistantText.startsWith("Assistant ran tools but returned no final text yet:")
      ) {
        const assistantFromList = await this.resolveLatestAssistantOutput(binding, runtime);
        if (
          assistantFromList &&
          assistantFromList.text !== EMPTY_ASSISTANT_OUTPUT
        ) {
          assistantText = assistantFromList.text;
          runtime.lastDeliveredAssistantMessageId = assistantFromList.messageId;
        } else {
          const finishReason = String((response as any)?.info?.finish ?? "").trim();
          if (finishReason !== "") {
            assistantText = `Assistant finished (${finishReason}) without text output.`;
          }
        }
      }

      const chunks = splitMessage(assistantText);
      for (const chunk of chunks) {
        await this.sendToSessionThread(binding, chunk, undefined, "markdown");
      }
      if (!runtime.lastDeliveredAssistantMessageId) {
        runtime.lastDeliveredAssistantMessageId = String((response as any)?.info?.id ?? "");
      }
      runtime.runStartedAt = undefined;

      const next = runtime.pending.shift();
      if (next) {
        void this.dispatchPrompt(binding, next);
      }
    } catch (error) {
      const errorText = safeErrorMessage(error);

      if (
        runtime.lastPrompt &&
        !runtime.retriedAfterCompaction &&
        detectContextOverflow(errorText)
      ) {
        runtime.retriedAfterCompaction = true;
        runtime.liveStage = "context overflow";
        runtime.liveDetail = "summarize + retry";
        await this.refreshLiveProgress(binding);

        try {
          await this.expectData<boolean>(
            this.getClient(binding.workspacePath).session.summarize({
              path: { id: binding.sessionId },
              body: binding.model,
            }),
          );
          await this.dispatchPrompt(binding, runtime.lastPrompt);
          return;
        } catch (summaryError) {
          this.stopLiveProgress(binding.sessionId);
          runtime.inFlight = false;
          this.store.patchBySession(binding.sessionId, {
            state: "error",
            lastError: safeErrorMessage(summaryError),
          });
          await this.updateTopicName(binding);
          await this.upsertProgress(
            binding,
            [
              "Status: error",
              `Session: ${binding.sessionId}`,
              `Model: ${modelDisplayName(binding.model)}`,
              shortPreferences(binding),
              `Compaction retry failed: ${safeErrorMessage(summaryError)}`,
            ].join("\n"),
          );

          const next = runtime.pending.shift();
          if (next) {
            void this.dispatchPrompt(binding, next);
          }
          return;
        }
      }

      this.stopLiveProgress(binding.sessionId);
      runtime.inFlight = false;
      this.store.patchBySession(binding.sessionId, {
        state: "error",
        lastError: errorText,
      });
      await this.updateTopicName(binding);
      await this.upsertProgress(
        binding,
        [
          "Status: error",
          `Session: ${binding.sessionId}`,
          `Model: ${modelDisplayName(binding.model)}`,
          shortPreferences(binding),
          `Error: ${errorText}`,
        ].join("\n"),
      );

      const next = runtime.pending.shift();
      if (next) {
        void this.dispatchPrompt(binding, next);
      }
    }
  }

  private async onSessionIdle(binding: TopicSessionBinding): Promise<void> {
    const runtime = this.getRuntime(binding.sessionId);
    this.stopLiveProgress(binding.sessionId);
    if (!runtime.inFlight) {
      const nextIfAny = runtime.pending.shift();
      if (nextIfAny) {
        await this.dispatchPrompt(binding, nextIfAny);
      }
      return;
    }

    runtime.inFlight = false;

    this.store.patchBySession(binding.sessionId, {
      state: "idle",
      lastError: undefined,
    });
    await this.updateTopicName(binding);

    const duration = runtime.runStartedAt
      ? formatDurationSeconds(Date.now() - runtime.runStartedAt)
      : "n/a";
    await this.upsertProgress(
      binding,
      [
        "Status: done",
        `Session: ${binding.sessionId}`,
        `Model: ${modelDisplayName(binding.model)}`,
        shortPreferences(binding),
        `Duration: ${duration}`,
        `Finished: ${formatDateTime(Date.now())}`,
        `Queue: ${runtime.pending.length}`,
      ].join("\n"),
    );

    const assistant = await this.resolveLatestAssistantOutput(binding, runtime);
    if (assistant) {
      const chunks = splitMessage(assistant.text);
      for (const chunk of chunks) {
        await this.sendToSessionThread(binding, chunk, undefined, "markdown");
      }
      runtime.lastDeliveredAssistantMessageId = assistant.messageId;
    } else {
      await this.sendToSessionThread(
        binding,
        "No assistant output was returned for this run.",
      );
    }

    runtime.runStartedAt = undefined;

    const next = runtime.pending.shift();
    if (next) {
      await this.dispatchPrompt(binding, next);
    }
  }

  private async onSessionError(
    binding: TopicSessionBinding,
    errorText: string,
  ): Promise<void> {
    const runtime = this.getRuntime(binding.sessionId);
    this.stopLiveProgress(binding.sessionId);
    this.store.patchBySession(binding.sessionId, {
      state: "error",
      lastError: errorText,
    });
    await this.updateTopicName(binding);
    await this.upsertProgress(
      binding,
      [
        "Status: error",
        `Session: ${binding.sessionId}`,
        `Model: ${modelDisplayName(binding.model)}`,
        shortPreferences(binding),
        `Error: ${errorText}`,
      ].join("\n"),
    );

    if (
      runtime.lastPrompt &&
      !runtime.retriedAfterCompaction &&
      detectContextOverflow(errorText)
    ) {
      runtime.retriedAfterCompaction = true;
      await this.upsertProgress(
        binding,
        [
          "Status: context overflow",
          `Session: ${binding.sessionId}`,
          shortPreferences(binding),
          "Action: summarize + single retry",
        ].join("\n"),
      );

      try {
        await this.expectData<boolean>(
          this.getClient(binding.workspacePath).session.summarize({
            path: { id: binding.sessionId },
            body: binding.model,
          }),
        );
        await this.dispatchPrompt(binding, runtime.lastPrompt);
        return;
      } catch (error) {
        runtime.inFlight = false;
        await this.upsertProgress(
          binding,
          [
            "Status: error",
            `Session: ${binding.sessionId}`,
            shortPreferences(binding),
            `Compaction retry failed: ${safeErrorMessage(error)}`,
          ].join("\n"),
        );
        return;
      }
    }

    runtime.inFlight = false;

    const next = runtime.pending.shift();
    if (next) {
      await this.dispatchPrompt(binding, next);
    }
  }

  private async resolveLatestAssistantOutput(
    binding: TopicSessionBinding,
    runtime: SessionRuntime,
  ): Promise<{ messageId: string; text: string } | undefined> {
    try {
      const messages = await this.expectData<SessionMessagesResponses[200]>(
        this.getClient(binding.workspacePath).session.messages({
          path: { id: binding.sessionId },
          query: { limit: 200 },
        }),
      );

      const assistantMessages = messages.filter(
        (entry) => (entry as any)?.info?.role === "assistant",
      );
      const runStartedAt = Number(runtime.runStartedAt ?? 0);
      const scopedMessages = runStartedAt > 0
        ? assistantMessages.filter(
          (entry) => Number((entry as any)?.info?.time?.created ?? 0) >= runStartedAt - 5_000,
        )
        : assistantMessages;
      const messagePool = scopedMessages.length > 0 ? scopedMessages : assistantMessages;

      const scoreEntry = (entry: any): number => {
        const info = entry?.info ?? {};
        const parts = Array.isArray(entry?.parts) ? entry.parts : [];
        const textLen = parts
          .filter((part: any) => part?.type === "text")
          .map((part: any) => String(part?.text || "").trim().length)
          .reduce((sum: number, value: number) => sum + value, 0);
        const fileCount = parts.filter((part: any) => part?.type === "file").length;
        const reasoningLen = parts
          .filter((part: any) => part?.type === "reasoning")
          .map((part: any) => String(part?.text || "").trim().length)
          .reduce((sum: number, value: number) => sum + value, 0);
        const hasRunningTool = parts.some(
          (part: any) =>
            part?.type === "tool" &&
            ["pending", "running"].includes(String(part?.state?.status || "")),
        );
        const completedAt = Number(info?.time?.completed ?? 0);
        const createdAt = Number(info?.time?.created ?? 0);
        const baseTime = completedAt || createdAt;

        let score = baseTime;
        if (textLen > 0) score += 3_000_000_000_000;
        else if (fileCount > 0) score += 2_000_000_000_000;
        else if (reasoningLen > 0) score += 1_000_000_000_000;
        else score += 100_000_000_000;
        if (hasRunningTool) score -= 500_000_000_000;

        return score;
      };

      const candidate = messagePool
        .filter(
          (entry) =>
            String((entry as any)?.info?.id ?? "") !== runtime.lastDeliveredAssistantMessageId,
        )
        .sort((a, b) => scoreEntry(b as any) - scoreEntry(a as any))[0];
      if (!candidate) {
        return undefined;
      }

      const messageId = String((candidate as any)?.info?.id ?? "");
      return {
        messageId,
        text: extractAssistantText((candidate as any)?.parts ?? []),
      };
    } catch (error) {
      console.error("[Bridge] Failed to resolve assistant output from message list:", error);
      return undefined;
    }
  }

  private async updateTopicName(binding: TopicSessionBinding): Promise<void> {
    const suffix = binding.state;
    const name = truncateTopicName(
      `${workspaceLabel(binding.workspacePath)} | ${shortSessionId(binding.sessionId)} | ${suffix}`,
    );
    const key = `${binding.chatId}:${binding.threadId}`;
    const state = this.topicNameState.get(key) ?? {};
    if (state.lastName === name) {
      return;
    }
    const now = Date.now();
    if (state.nextAllowedAt && now < state.nextAllowedAt) {
      return;
    }
    try {
      await this.bot.editForumTopic(binding.chatId, binding.threadId, name);
      this.topicNameState.set(key, {
        lastName: name,
        nextAllowedAt: Date.now() + TOPIC_RENAME_MIN_MS,
      });
    } catch (error) {
      const meta = parseTelegramErrorMeta(error);
      if (isTopicNotModifiedMeta(meta)) {
        this.topicNameState.set(key, {
          lastName: name,
          nextAllowedAt: Date.now() + TOPIC_RENAME_MIN_MS,
        });
        return;
      }
      if (isFloodMeta(meta)) {
        const retryAfterMs = meta.retryAfterMs ?? TOPIC_RENAME_MIN_MS;
        this.topicNameState.set(key, {
          ...state,
          nextAllowedAt: Date.now() + retryAfterMs + FLOOD_JITTER_MS,
        });
        console.warn(
          `[Bridge] Topic rename rate-limited for ${Math.max(
            1,
            Math.ceil((retryAfterMs + FLOOD_JITTER_MS) / 1000),
          )}s`,
        );
        return;
      }
      console.error("[Bridge] Failed to update topic name:", error);
    }
  }

  private getEffectiveModel(binding: TopicSessionBinding): ModelRef {
    // Keep a stable model identifier; "effort" is conveyed via system preferences.
    // Suffixing model IDs (e.g. "-medium") can yield ProviderModelNotFoundError.
    const normalizedId = binding.model.modelID.replace(/-(none|low|medium|high|xhigh)$/, "");
    return {
      providerID: binding.model.providerID,
      modelID: normalizedId,
    };
  }

  private buildSystemPreferences(binding: TopicSessionBinding): string | undefined {
    const hints: string[] = [];
    if (binding.reasoningEffort) {
      hints.push(`reasoning_effort=${binding.reasoningEffort}`);
    }
    if (binding.reasoningSummary) {
      hints.push(`reasoning_summary=${binding.reasoningSummary}`);
    }
    if (binding.textVerbosity) {
      hints.push(`text_verbosity=${binding.textVerbosity}`);
    }
    if (hints.length === 0) {
      return undefined;
    }
    return `Preference hints for this session: ${hints.join(", ")}.`;
  }

  private buildSettingsKeyboard(binding: TopicSessionBinding): InlineKeyboard {
    const model = (binding.model.modelID || "").trim().toLowerCase();
    const effort = this.normalizeEffortValue(
      (binding.reasoningEffort || DEFAULT_REASONING_EFFORT).trim().toLowerCase(),
    ) || DEFAULT_REASONING_EFFORT;
    const summary = (binding.reasoningSummary || "auto").trim().toLowerCase();
    const verbosity = (binding.textVerbosity || "medium").trim().toLowerCase();

    return [
      [
        {
          text: markSelected("ChatGPT Codex 5.3", model === "gpt-5.3-codex"),
          callbackData: "ocset:model:gpt-5.3-codex",
        },
        {
          text: markSelected("ChatGPT Codex 5.2", model === "gpt-5.2-codex"),
          callbackData: "ocset:model:gpt-5.2-codex",
        },
      ],
      [
        {
          text: markSelected("Effort low", effort === "low"),
          callbackData: "ocset:effort:low",
        },
        {
          text: markSelected("Effort medium", effort === "medium"),
          callbackData: "ocset:effort:medium",
        },
        {
          text: markSelected("Effort high", effort === "high"),
          callbackData: "ocset:effort:high",
        },
        {
          text: markSelected("Effort extra high", effort === "xhigh"),
          callbackData: "ocset:effort:xhigh",
        },
      ],
      [
        {
          text: markSelected("Summary auto", summary === "auto"),
          callbackData: "ocset:summary:auto",
        },
        {
          text: markSelected("Summary none", summary === "none"),
          callbackData: "ocset:summary:none",
        },
        {
          text: markSelected("Summary detailed", summary === "detailed"),
          callbackData: "ocset:summary:detailed",
        },
      ],
      [
        {
          text: markSelected("Verbosity low", verbosity === "low"),
          callbackData: "ocset:verbosity:low",
        },
        {
          text: markSelected("Verbosity medium", verbosity === "medium"),
          callbackData: "ocset:verbosity:medium",
        },
        {
          text: markSelected("Verbosity high", verbosity === "high"),
          callbackData: "ocset:verbosity:high",
        },
      ],
      [{ text: "Refresh status", callbackData: "ocset:status" }],
    ];
  }

  private buildPermissionKeyboard(permissionId: string): InlineKeyboard {
    return [[
      {
        text: "Deny",
        callbackData: `ocperm:${permissionId}:reject`,
      },
      {
        text: "Allow always",
        callbackData: `ocperm:${permissionId}:always`,
      },
      {
        text: "Allow once",
        callbackData: `ocperm:${permissionId}:once`,
      },
    ]];
  }

  private normalizeEffortValue(input: string): string | undefined {
    const value = input.trim().toLowerCase();
    if (["none", "low", "medium", "high", "xhigh"].includes(value)) {
      return value;
    }
    if (["extra_high", "extra-high", "x-high", "extra high", "extra"].includes(value)) {
      return "xhigh";
    }
    return undefined;
  }

  private startLiveProgress(binding: TopicSessionBinding): void {
    const runtime = this.getRuntime(binding.sessionId);
    if (runtime.progressTicker) {
      clearInterval(runtime.progressTicker);
    }
    runtime.progressTicker = setInterval(() => {
      void this.refreshLiveProgress(binding).catch((error) => {
        console.error("[Bridge] Failed to refresh live progress:", error);
      });
    }, LIVE_PROGRESS_TICK_MS);
  }

  private stopLiveProgress(sessionId: string): void {
    const runtime = this.getRuntime(sessionId);
    if (runtime.progressTicker) {
      clearInterval(runtime.progressTicker);
      runtime.progressTicker = undefined;
    }
    runtime.liveStage = undefined;
    runtime.liveDetail = undefined;
    runtime.pendingProgressText = undefined;
  }

  private async refreshLiveProgress(binding: TopicSessionBinding): Promise<void> {
    const runtime = this.getRuntime(binding.sessionId);
    if (!runtime.inFlight) {
      return;
    }

    const elapsedMs = runtime.runStartedAt ? Date.now() - runtime.runStartedAt : 0;
    const stage = runtime.liveStage || "working";
    const liveDetail = runtime.liveDetail;

    await this.upsertProgress(
      binding,
      [
        "Status: working",
        `Session: ${binding.sessionId}`,
        `Model: ${modelDisplayName(binding.model)}`,
        shortPreferences(binding),
        runtime.runStartedAt ? `Started: ${formatDateTime(runtime.runStartedAt)}` : "",
        `Elapsed: ${formatDurationSeconds(elapsedMs)}`,
        `Stage: ${stage}`,
        liveDetail ? `Last: ${liveDetail}` : "",
        `Queue: ${runtime.pending.length}`,
      ]
        .filter(Boolean)
        .join("\n"),
    );
  }

  private captureLivePart(runtime: SessionRuntime, part: any, delta: string): void {
    const type = String(part?.type ?? "");

    if (type === "reasoning") {
      runtime.liveStage = "reasoning";
      const text = String(part?.text || delta || "");
      if (text.trim() !== "") {
        runtime.liveDetail = collapseLine(text);
      }
      return;
    }

    if (type === "text") {
      runtime.liveStage = "writing";
      const text = String(part?.text || delta || "");
      if (text.trim() !== "") {
        runtime.liveDetail = collapseLine(text);
      }
      return;
    }

    if (type === "tool") {
      const toolName = String(part?.tool || "tool");
      const toolStatus = String(part?.state?.status || "running");
      runtime.liveStage = `tool ${toolName} (${toolStatus})`;
      const title = String(part?.state?.title || "");
      const output = String(part?.state?.output || "");
      const detail = title || output;
      if (detail.trim() !== "") {
        runtime.liveDetail = collapseLine(detail);
      }
      return;
    }

    if (type === "step-start") {
      runtime.liveStage = "step started";
      return;
    }

    if (type === "step-finish") {
      runtime.liveStage = `step finished (${String(part?.reason || "ok")})`;
      return;
    }

    if (type === "patch") {
      runtime.liveStage = "applying patch";
      const files = Array.isArray(part?.files) ? part.files.map(String).slice(0, 3) : [];
      if (files.length > 0) {
        runtime.liveDetail = collapseLine(files.join(", "));
      }
      return;
    }

    if (type === "file") {
      runtime.liveStage = "file output";
      const fileName = String(part?.filename || "");
      if (fileName) {
        runtime.liveDetail = collapseLine(fileName);
      }
    }
  }

  private async upsertProgress(
    binding: TopicSessionBinding,
    text: string,
  ): Promise<void> {
    const runtime = this.getRuntime(binding.sessionId);
    const normalized = text.trim();
    if (normalized === "") {
      return;
    }
    if (normalized === runtime.lastProgressText) {
      runtime.pendingProgressText = undefined;
      return;
    }
    runtime.pendingProgressText = normalized;
    const now = Date.now();
    if (runtime.progressBlockedUntil && now < runtime.progressBlockedUntil) {
      return;
    }
    const progressText = runtime.pendingProgressText;
    if (!progressText) {
      return;
    }

    if (runtime.progressMessageId) {
      if (runtime.nextProgressEditAt && now < runtime.nextProgressEditAt) {
        return;
      }
      try {
        await this.bot.editMessage({
          chatId: binding.chatId,
          messageId: runtime.progressMessageId,
          text: progressText,
        });
        runtime.lastProgressText = progressText;
        runtime.pendingProgressText = undefined;
        runtime.nextProgressEditAt = Date.now() + LIVE_PROGRESS_MIN_EDIT_MS;
        runtime.progressBlockedUntil = undefined;
        return;
      } catch (error) {
        const meta = parseTelegramErrorMeta(error);
        if (isMessageNotModifiedMeta(meta)) {
          runtime.lastProgressText = progressText;
          runtime.pendingProgressText = undefined;
          runtime.nextProgressEditAt = Date.now() + LIVE_PROGRESS_MIN_EDIT_MS;
          return;
        }
        if (isFloodMeta(meta)) {
          const retryAfterMs = meta.retryAfterMs ?? LIVE_PROGRESS_MIN_EDIT_MS;
          const until = Date.now() + retryAfterMs + FLOOD_JITTER_MS;
          runtime.progressBlockedUntil = until;
          runtime.nextProgressEditAt = until;
          console.warn(
            `[Bridge] Progress edit rate-limited for ${Math.max(
              1,
              Math.ceil((until - Date.now()) / 1000),
            )}s`,
          );
          return;
        }
        runtime.progressMessageId = undefined;
      }
    }

    if (runtime.nextProgressSendAt && now < runtime.nextProgressSendAt) {
      return;
    }
    try {
      const sent = await this.bot.sendMessage({
        chatId: binding.chatId,
        threadId: binding.threadId,
        text: progressText,
      });
      runtime.progressMessageId = sent.message_id;
      runtime.lastProgressText = progressText;
      runtime.pendingProgressText = undefined;
      runtime.nextProgressSendAt = Date.now() + LIVE_PROGRESS_MIN_SEND_MS;
      runtime.progressBlockedUntil = undefined;
    } catch (error) {
      const meta = parseTelegramErrorMeta(error);
      if (isFloodMeta(meta)) {
        const retryAfterMs = meta.retryAfterMs ?? LIVE_PROGRESS_MIN_SEND_MS;
        const until = Date.now() + retryAfterMs + FLOOD_JITTER_MS;
        runtime.progressBlockedUntil = until;
        runtime.nextProgressSendAt = until;
        console.warn(
          `[Bridge] Progress send rate-limited for ${Math.max(
            1,
            Math.ceil((until - Date.now()) / 1000),
          )}s`,
        );
        return;
      }
      console.error("[Bridge] Failed to send progress message:", error);
    }
  }

  private async sendToSessionThread(
    binding: TopicSessionBinding,
    text: string,
    inlineKeyboard?: InlineKeyboard,
    format: "plain" | "markdown" = "plain",
  ): Promise<void> {
    let payloadText = text;
    let parseMode: "HTML" | "MarkdownV2" | undefined;
    if (format === "markdown") {
      payloadText = renderMarkdownToTelegramHtml(text);
      parseMode = "HTML";
    }

    let attemptsLeft = 2;
    // Telegram can return 429 on chat-level flood control; retry using retry_after.
    while (true) {
      try {
        await this.bot.sendMessage({
          chatId: binding.chatId,
          threadId: binding.threadId,
          text: payloadText,
          parseMode,
          inlineKeyboard,
        });
        return;
      } catch (error) {
        const meta = parseTelegramErrorMeta(error);
        if (parseMode && isParseEntitiesMeta(meta)) {
          // Fallback to plain text if Telegram rejects formatted entities.
          payloadText = text;
          parseMode = undefined;
          continue;
        }
        if (!isFloodMeta(meta) || attemptsLeft <= 0) {
          throw error;
        }
        attemptsLeft -= 1;
        const waitMs = (meta.retryAfterMs ?? 1_000) + FLOOD_JITTER_MS;
        console.warn(
          `[Bridge] sendMessage rate-limited, retry in ${Math.max(
            1,
            Math.ceil(waitMs / 1000),
          )}s`,
        );
        await sleep(waitMs);
      }
    }
  }

  private getRuntime(sessionId: string): SessionRuntime {
    const existing = this.runtime.get(sessionId);
    if (existing) {
      return existing;
    }

    const created: SessionRuntime = {
      inFlight: false,
      pending: [],
      retriedAfterCompaction: false,
    };
    this.runtime.set(sessionId, created);
    return created;
  }

  private getClient(directory: string) {
    return this.clientFactory.getForDirectory(directory);
  }

  private async runThreadLock(key: string, task: () => Promise<void>): Promise<void> {
    const previous = this.threadLocks.get(key) ?? Promise.resolve();

    const current = previous
      .catch(() => undefined)
      .then(task)
      .finally(() => {
        if (this.threadLocks.get(key) === current) {
          this.threadLocks.delete(key);
        }
      });

    this.threadLocks.set(key, current);
    await current;
  }

  private async expectData<T>(resultPromise: Promise<any>): Promise<T> {
    const result = await resultPromise;
    if (result?.error) {
      throw new Error(parseErrorPayload(result.error));
    }
    if (typeof result?.data === "undefined") {
      throw new Error("OpenCode API returned empty response data.");
    }
    return result.data as T;
  }

  private async expectOk(resultPromise: Promise<any>): Promise<void> {
    const result = await resultPromise;
    if (result?.error) {
      throw new Error(parseErrorPayload(result.error));
    }
  }
}
