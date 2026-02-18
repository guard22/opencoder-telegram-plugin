import { Bot, type Context } from "grammy";
import type { InboundTelegramMessage } from "./bridge/types.js";
import type { Config } from "./config.js";

export interface SendMessageParams {
  chatId: number;
  text: string;
  threadId?: number;
  replyToMessageId?: number;
  disableNotification?: boolean;
  parseMode?: "HTML" | "MarkdownV2";
  inlineKeyboard?: Array<Array<{ text: string; callbackData: string }>>;
}

export interface EditMessageParams {
  chatId: number;
  messageId: number;
  text: string;
  parseMode?: "HTML" | "MarkdownV2";
  inlineKeyboard?: Array<Array<{ text: string; callbackData: string }>>;
}

export interface DownloadedTelegramFile {
  buffer: Buffer;
  mime: string;
  filePath: string;
}

export interface TelegramBotManager {
  start(): Promise<void>;
  stop(): Promise<void>;
  sendMessage(params: SendMessageParams): Promise<{ message_id: number }>;
  editMessage(params: EditMessageParams): Promise<void>;
  sendLegacyMessage(text: string): Promise<{ message_id: number }>;
  createForumTopic(chatId: number, name: string): Promise<{ message_thread_id: number }>;
  editForumTopic(chatId: number, threadId: number, name: string): Promise<void>;
  downloadFile(fileId: string): Promise<DownloadedTelegramFile>;
  getActivePrivateChatId(): number | null;
}

let botInstance: Bot | null = null;
let activePrivateChatId: number | null = null;

function isUserAllowed(ctx: Context, allowedUserIds: number[]): boolean {
  const userId = ctx.from?.id;
  if (!userId) {
    return false;
  }
  return allowedUserIds.includes(userId);
}

function isChatAllowed(ctx: Context, config: Config): boolean {
  const chatId = ctx.chat?.id;
  if (!chatId) {
    return false;
  }

  if (typeof config.forumChatId === "number" && chatId !== config.forumChatId) {
    return false;
  }

  if (config.allowedChatIds.length > 0 && !config.allowedChatIds.includes(chatId)) {
    return false;
  }

  return true;
}

function formatTelegramUserName(user: any): string | undefined {
  if (!user || typeof user !== "object") {
    return undefined;
  }
  const first = typeof user.first_name === "string" ? user.first_name.trim() : "";
  const last = typeof user.last_name === "string" ? user.last_name.trim() : "";
  const full = [first, last].filter(Boolean).join(" ").trim();
  if (full) {
    return full;
  }
  const username = typeof user.username === "string" ? user.username.trim() : "";
  if (username) {
    return `@${username}`;
  }
  return undefined;
}

function extractReplyContext(replyMessage: any): InboundTelegramMessage["replyContext"] {
  if (!replyMessage || typeof replyMessage.message_id !== "number") {
    return undefined;
  }
  const photos = Array.isArray(replyMessage.photo) ? replyMessage.photo : [];
  const hasPhoto = photos.length > 0;
  const documentName = typeof replyMessage.document?.file_name === "string"
    ? replyMessage.document.file_name
    : undefined;
  const documentMime = typeof replyMessage.document?.mime_type === "string"
    ? replyMessage.document.mime_type
    : undefined;

  return {
    messageId: Number(replyMessage.message_id),
    fromName: formatTelegramUserName(replyMessage.from),
    text: typeof replyMessage.text === "string" ? replyMessage.text : undefined,
    caption: typeof replyMessage.caption === "string" ? replyMessage.caption : undefined,
    hasPhoto,
    documentName,
    documentMime,
  };
}

function buildInboundMessage(ctx: Context): InboundTelegramMessage | undefined {
  const message = (ctx.message ?? undefined) as any;
  if (!message || !ctx.chat || !ctx.from) {
    return undefined;
  }

  const photos = Array.isArray(message.photo) ? message.photo : [];
  const bestPhoto = photos.length > 0 ? photos[photos.length - 1] : undefined;
  const document = message.document
    ? {
      fileId: String(message.document.file_id),
      filename: typeof message.document.file_name === "string"
        ? message.document.file_name
        : undefined,
      mime: typeof message.document.mime_type === "string"
        ? message.document.mime_type
        : undefined,
    }
    : undefined;

  return {
    chatId: ctx.chat.id,
    chatType: String(ctx.chat.type),
    threadId: typeof message.message_thread_id === "number"
      ? message.message_thread_id
      : undefined,
    messageId: Number(message.message_id),
    userId: ctx.from.id,
    mediaGroupId: typeof message.media_group_id === "string"
      ? message.media_group_id
      : undefined,
    text: typeof message.text === "string" ? message.text : undefined,
    caption: typeof message.caption === "string" ? message.caption : undefined,
    photoFileId: bestPhoto?.file_id ? String(bestPhoto.file_id) : undefined,
    document,
    replyContext: extractReplyContext(message.reply_to_message),
  };
}

export function createTelegramBot(
  config: Config,
  onMessage: (message: InboundTelegramMessage) => Promise<void>,
): TelegramBotManager {
  if (botInstance) {
    return createBotManager(botInstance, config);
  }

  const bot = new Bot(config.botToken);
  botInstance = bot;

  bot.use(async (ctx, next) => {
    if (!isUserAllowed(ctx, config.allowedUserIds)) {
      return;
    }

    if (!isChatAllowed(ctx, config)) {
      return;
    }

    if (ctx.chat?.type === "private" && typeof ctx.chat.id === "number") {
      activePrivateChatId = ctx.chat.id;
    }

    const inbound = buildInboundMessage(ctx);
    if (inbound) {
      try {
        await onMessage(inbound);
      } catch (error) {
        console.error("[Bot] Failed to process inbound message:", error);
      }
    }

    await next();
  });

  bot.on("callback_query:data", async (ctx) => {
    if (!isUserAllowed(ctx, config.allowedUserIds)) {
      await ctx.answerCallbackQuery();
      return;
    }

    if (!isChatAllowed(ctx, config)) {
      await ctx.answerCallbackQuery();
      return;
    }

    const data = String(ctx.callbackQuery.data ?? "");
    if (!data.startsWith("ocimp:") && !data.startsWith("ocset:") && !data.startsWith("ocperm:")) {
      await ctx.answerCallbackQuery();
      return;
    }

    const message = (ctx.callbackQuery.message ?? undefined) as any;
    if (!message || !ctx.chat || !ctx.from) {
      await ctx.answerCallbackQuery({
        text: "Cannot process this callback.",
        show_alert: false,
      });
      return;
    }

    let command = "";
    if (data.startsWith("ocimp:")) {
      const payload = data.slice("ocimp:".length).trim();
      // Support paging callbacks like: ocimp:list:<limit>:<offset>
      if (payload === "list") {
        command = "/oc import list";
      } else if (payload.startsWith("list:")) {
        command = `/oc import ${payload.replaceAll(":", " ")}`;
      } else {
        command = `/oc import ${payload}`;
      }
    } else if (data.startsWith("ocset:")) {
      const payload = data.slice("ocset:".length).trim();
      if (payload === "status") {
        command = "/oc status";
      } else {
        const [key, value] = payload.split(":", 2);
        if (!key || !value) {
          await ctx.answerCallbackQuery({
            text: "Bad settings payload",
            show_alert: false,
          });
          return;
        }
        command = `/oc set ${key} ${value}`;
      }
    } else {
      const payload = data.slice("ocperm:".length);
      const cut = payload.lastIndexOf(":");
      if (cut <= 0 || cut >= payload.length - 1) {
        await ctx.answerCallbackQuery({
          text: "Bad permission payload",
          show_alert: false,
        });
        return;
      }
      const permissionId = payload.slice(0, cut).trim();
      const response = payload.slice(cut + 1).trim().toLowerCase();
      if (!permissionId || !["once", "always", "reject"].includes(response)) {
        await ctx.answerCallbackQuery({
          text: "Bad permission payload",
          show_alert: false,
        });
        return;
      }
      command = `/oc perm ${permissionId} ${response}`;
    }

    const inbound: InboundTelegramMessage = {
      chatId: ctx.chat.id,
      chatType: String(ctx.chat.type),
      threadId: typeof message.message_thread_id === "number"
        ? message.message_thread_id
        : undefined,
      messageId: Number(message.message_id),
      userId: ctx.from.id,
      text: command,
    };

    try {
      await onMessage(inbound);
      await ctx.answerCallbackQuery({
        text: command === "/oc import list"
          ? "List refreshed"
          : command.startsWith("/oc import ")
            ? "Import started"
            : command.startsWith("/oc perm ")
              ? "Permission response sent"
            : "Settings updated",
        show_alert: false,
      });
    } catch (error) {
      console.error("[Bot] Callback import failed:", error);
      await ctx.answerCallbackQuery({
        text: "Import failed",
        show_alert: false,
      });
    }
  });

  bot.catch((error) => {
    console.error("[Bot] Bot error:", error);
  });

  return createBotManager(bot, config);
}

function createBotManager(bot: Bot, config: Config): TelegramBotManager {
  return {
    async start() {
      await bot.start({
        drop_pending_updates: true,
      });
    },

    async stop() {
      await bot.stop();
      botInstance = null;
    },

    async sendMessage(params: SendMessageParams) {
      const result = await bot.api.sendMessage(params.chatId, params.text, {
        message_thread_id: params.threadId,
        reply_parameters: params.replyToMessageId
          ? { message_id: params.replyToMessageId }
          : undefined,
        disable_notification: params.disableNotification,
        parse_mode: params.parseMode,
        reply_markup: params.inlineKeyboard
          ? {
            inline_keyboard: params.inlineKeyboard.map((row) =>
              row.map((button) => ({
                text: button.text,
                callback_data: button.callbackData,
              }))
            ),
          }
          : undefined,
      });
      return { message_id: result.message_id };
    },

    async editMessage(params: EditMessageParams) {
      await bot.api.editMessageText(params.chatId, params.messageId, params.text, {
        parse_mode: params.parseMode,
        reply_markup: params.inlineKeyboard
          ? {
            inline_keyboard: params.inlineKeyboard.map((row) =>
              row.map((button) => ({
                text: button.text,
                callback_data: button.callbackData,
              }))
            ),
          }
          : undefined,
      });
    },

    async sendLegacyMessage(text: string) {
      const chatId = config.chatId ?? activePrivateChatId;
      if (!chatId) {
        throw new Error("No active private chat configured for legacy messaging.");
      }
      const result = await bot.api.sendMessage(chatId, text);
      return { message_id: result.message_id };
    },

    async createForumTopic(chatId: number, name: string) {
      const result = await bot.api.createForumTopic(chatId, name);
      return { message_thread_id: result.message_thread_id };
    },

    async editForumTopic(chatId: number, threadId: number, name: string) {
      await bot.api.editForumTopic(chatId, threadId, { name });
    },

    async downloadFile(fileId: string) {
      const file = await bot.api.getFile(fileId);
      if (!file.file_path) {
        throw new Error("Telegram file has no file_path.");
      }

      const url = `https://api.telegram.org/file/bot${config.botToken}/${file.file_path}`;
      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(
          `Failed to download Telegram file: ${response.status} ${response.statusText}`,
        );
      }

      const contentType = response.headers.get("content-type");
      const buffer = Buffer.from(await response.arrayBuffer());
      return {
        buffer,
        mime: contentType && contentType.trim() !== ""
          ? contentType
          : "application/octet-stream",
        filePath: file.file_path,
      };
    },

    getActivePrivateChatId() {
      return activePrivateChatId;
    },
  };
}
