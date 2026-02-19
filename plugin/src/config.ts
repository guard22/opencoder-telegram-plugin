import { resolve } from "node:path";
import { config as loadEnv } from "dotenv";
import type { ModelRef } from "./bridge/types.js";

loadEnv({ path: resolve(process.cwd(), ".env") });

export const SERVICE_NAME = "TelegramRemote";

export interface Config {
  botToken: string;
  allowedUserIds: number[];
  allowedChatIds: number[];
  chatId?: number;
  forumChatId?: number;
  allowedWorkspaceRoots: string[];
  defaultModel: ModelRef;
  maxAttachmentBytes: number;
  stateFilePath: string;
  autoContinueAfterRestart: boolean;
  opencodeBaseUrl: string;
  opencodeUsername?: string;
  opencodePassword?: string;
}

function parseNumberList(value: string | undefined): number[] {
  if (!value || value.trim() === "") {
    return [];
  }

  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean)
    .map((item) => Number.parseInt(item, 10))
    .filter((item) => !Number.isNaN(item));
}

function parsePathList(value: string | undefined): string[] {
  if (!value || value.trim() === "") {
    return [];
  }

  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean)
    .map((item) => resolve(item));
}

function parseModel(value: string | undefined): ModelRef {
  const fallback: ModelRef = {
    providerID: "openai",
    modelID: "gpt-5.3-codex",
  };

  if (!value || value.trim() === "") {
    return fallback;
  }

  const normalized = value.trim();
  const [providerID, modelID] = normalized.split("/");
  if (!providerID || !modelID) {
    return fallback;
  }

  return { providerID, modelID };
}

function parseBoolean(value: string | undefined, fallback: boolean): boolean {
  if (!value || value.trim() === "") {
    return fallback;
  }
  const normalized = value.trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) {
    return true;
  }
  if (["0", "false", "no", "off"].includes(normalized)) {
    return false;
  }
  return fallback;
}

export function loadConfig(): Config {
  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  if (!botToken || botToken.trim() === "") {
    throw new Error("Missing required environment variable: TELEGRAM_BOT_TOKEN");
  }

  const allowedUserIds = parseNumberList(process.env.TELEGRAM_ALLOWED_USER_IDS);
  if (allowedUserIds.length === 0) {
    throw new Error(
      "Missing or invalid TELEGRAM_ALLOWED_USER_IDS (comma-separated numeric IDs)",
    );
  }

  const allowedChatIds = parseNumberList(process.env.TELEGRAM_ALLOWED_CHAT_IDS);

  const chatIdRaw = process.env.TELEGRAM_CHAT_ID;
  const parsedChatId = chatIdRaw ? Number.parseInt(chatIdRaw, 10) : Number.NaN;
  const chatId = Number.isNaN(parsedChatId) ? undefined : parsedChatId;

  const forumChatIdRaw = process.env.TELEGRAM_FORUM_CHAT_ID;
  const parsedForumChatId = forumChatIdRaw
    ? Number.parseInt(forumChatIdRaw, 10)
    : Number.NaN;
  const forumChatId = Number.isNaN(parsedForumChatId)
    ? undefined
    : parsedForumChatId;

  const allowedWorkspaceRoots = parsePathList(
    process.env.TELEGRAM_ALLOWED_WORKSPACE_ROOTS ??
      "/home/opencode/Projects/EdgeRolls,/home/opencode/Projects/BoosterVpn,/home/opencode/Projects/TGtoMax",
  );

  const maxAttachmentBytesRaw = process.env.TELEGRAM_MAX_ATTACHMENT_BYTES ?? "6291456";
  const maxAttachmentBytes = Number.parseInt(maxAttachmentBytesRaw, 10);
  if (Number.isNaN(maxAttachmentBytes) || maxAttachmentBytes <= 0) {
    throw new Error("Invalid TELEGRAM_MAX_ATTACHMENT_BYTES value.");
  }

  const stateFilePath = process.env.TELEGRAM_BRIDGE_STATE_PATH
    ? resolve(process.env.TELEGRAM_BRIDGE_STATE_PATH)
    : resolve(
      process.env.HOME ?? process.cwd(),
      ".config/opencode/local-plugins/opencoder-telegram-plugin/state/topic-session-map.json",
    );

  const opencodeBaseUrl =
    process.env.TELEGRAM_OPENCODE_BASE_URL?.trim() ||
    process.env.OPENCODE_BASE_URL?.trim() ||
    process.env.OPENCODE_SERVER_URL?.trim() ||
    "http://127.0.0.1:4097";
  const opencodeUsername =
    process.env.TELEGRAM_OPENCODE_USERNAME?.trim() ||
    process.env.OPENCODE_SERVER_USERNAME?.trim() ||
    "";
  const opencodePassword =
    process.env.TELEGRAM_OPENCODE_PASSWORD?.trim() ||
    process.env.OPENCODE_SERVER_PASSWORD?.trim() ||
    "";

  const hasUsername = opencodeUsername !== "";
  const hasPassword = opencodePassword !== "";
  if (hasUsername !== hasPassword) {
    throw new Error(
      "Incomplete OpenCode credentials. Set both username and password, or leave both empty.",
    );
  }

  return {
    botToken,
    allowedUserIds,
    allowedChatIds,
    chatId,
    forumChatId,
    allowedWorkspaceRoots,
    defaultModel: parseModel(process.env.TELEGRAM_OPENCODE_MODEL),
    maxAttachmentBytes,
    stateFilePath,
    autoContinueAfterRestart: parseBoolean(
      process.env.TELEGRAM_AUTOCONTINUE_ON_RESTART,
      true,
    ),
    opencodeBaseUrl,
    opencodeUsername: hasUsername ? opencodeUsername : undefined,
    opencodePassword: hasPassword ? opencodePassword : undefined,
  };
}
