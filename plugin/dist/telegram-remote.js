/**
 * OpenCoder Telegram Remote Plugin
 * https://github.com/YOUR_USERNAME/opencoder-telegram-remote-plugin
 */

// src/bot.ts
import { Bot, InputFile } from "grammy";

// src/commands/deletesessions.ts
function createDeleteSessionsCommandHandler({
  config,
  client,
  logger,
  sessionStore
}) {
  return async (ctx) => {
    console.log("[Bot] /deletesessions command received");
    if (ctx.chat?.id !== config.groupId) return;
    let deletedSessions = 0;
    let failedSessions = 0;
    try {
      const sessionsResponse = await client.session.list();
      if (sessionsResponse.error) {
        logger.error("Failed to list sessions", { error: sessionsResponse.error });
        await ctx.reply("\u274C Failed to list sessions");
        return;
      }
      const sessions = sessionsResponse.data || [];
      for (const session of sessions) {
        try {
          const deleteResponse = await client.session.delete({
            path: { id: session.id }
          });
          if (deleteResponse.error) {
            failedSessions += 1;
            logger.error("Failed to delete session", {
              sessionId: session.id,
              error: deleteResponse.error
            });
            continue;
          }
          deletedSessions += 1;
        } catch (error) {
          failedSessions += 1;
          logger.error("Failed to delete session", {
            sessionId: session.id,
            error: String(error)
          });
        }
      }
    } catch (error) {
      logger.error("Failed to delete sessions", { error: String(error) });
      await ctx.reply("\u274C Failed to delete sessions");
      return;
    }
    sessionStore.clearActiveSession();
    await ctx.reply(`Deleted ${deletedSessions} sessions (${failedSessions} failed).`);
  };
}

// src/commands/help.ts
function createHelpCommandHandler({ config }) {
  return async (ctx) => {
    console.log("[Bot] /help command received");
    if (ctx.chat?.id !== config.groupId) return;
    const userId = ctx.from?.id;
    if (!userId || !config.allowedUserIds.includes(userId)) {
      console.log(`[Bot] /help attempt by unauthorized user ${userId}`);
      await ctx.reply("You are not authorized to use this bot.");
      return;
    }
    const helpMessage = "Available commands:\n\n/new - Create a new OpenCode session.\n/deletesessions - Delete all OpenCode sessions.\n/help - Show this help message.\n\nUsage:\n- Use /new to create a new session.\n- Send messages in this chat to interact with the active session.\n- Admin-only commands (like /deletesessions) are restricted to configured users.\n\nNote: All commands require you to be a configured allowed user. The bot enforces this via its middleware and command-level checks.";
    await ctx.reply(helpMessage);
  };
}

// src/commands/message-text.command.ts
function createMessageTextHandler({ config, client, logger, sessionStore }) {
  return async (ctx) => {
    console.log(`[Bot] Text message received: "${ctx.message?.text?.slice(0, 50)}..."`);
    if (ctx.chat?.id !== config.groupId) return;
    if (ctx.message?.text?.startsWith("/")) return;
    let sessionId = sessionStore.getActiveSession();
    if (!sessionId) {
      try {
        const createSessionResponse = await client.session.create({ body: {} });
        if (createSessionResponse.error) {
          logger.error("Failed to create session", { error: createSessionResponse.error });
          await ctx.reply("\u274C Failed to initialize session");
          return;
        }
        sessionId = createSessionResponse.data.id;
        sessionStore.setActiveSession(sessionId);
        logger.info("Auto-created session", {
          sessionId
        });
      } catch (error) {
        logger.error("Failed to create session", { error: String(error) });
        await ctx.reply("\u274C Failed to initialize session");
        return;
      }
    }
    const userMessage = ctx.message?.text;
    try {
      const response = await client.session.prompt({
        path: { id: sessionId },
        body: {
          parts: [{ type: "text", text: userMessage || "" }]
        }
      });
      if (response.error) {
        logger.error("Failed to send message to OpenCode", {
          error: response.error,
          sessionId
        });
        await ctx.reply("\u274C Failed to process message");
        return;
      }
      logger.debug("Forwarded message to OpenCode", {
        sessionId
      });
    } catch (error) {
      logger.error("Failed to send message to OpenCode", {
        error: String(error),
        sessionId
      });
      await ctx.reply("\u274C Failed to process message");
    }
  };
}

// src/commands/new.ts
function createNewCommandHandler({
  bot,
  config,
  client,
  logger,
  sessionStore
}) {
  return async (ctx) => {
    console.log("[Bot] /new command received");
    if (ctx.chat?.id !== config.groupId) return;
    try {
      const createSessionResponse = await client.session.create({ body: {} });
      if (createSessionResponse.error) {
        logger.error("Failed to create session", { error: createSessionResponse.error });
        await ctx.reply("\u274C Failed to create session");
        return;
      }
      const sessionId = createSessionResponse.data.id;
      sessionStore.setActiveSession(sessionId);
      logger.info("Created new session", {
        sessionId
      });
      await bot.sendMessage(`\u2705 Session created: ${sessionId}`);
    } catch (error) {
      logger.error("Failed to create new session", { error: String(error) });
      await ctx.reply("\u274C Failed to create session");
    }
  };
}

// src/lib/telegram-queue.ts
var TelegramQueue = class {
  queue = [];
  processing = false;
  intervalId = null;
  intervalMs;
  constructor(intervalMs = 500) {
    this.intervalMs = intervalMs;
  }
  /**
   * Add a Telegram API call to the queue
   * @param fn - Async function that makes the Telegram API call
   * @returns Promise that resolves when the call completes
   */
  enqueue(fn) {
    return new Promise((resolve2, reject) => {
      this.queue.push(async () => {
        try {
          const result = await fn();
          resolve2(result);
        } catch (error) {
          reject(error);
        }
      });
      if (!this.processing) {
        this.start();
      }
    });
  }
  /**
   * Start processing the queue
   */
  start() {
    if (this.processing) {
      return;
    }
    this.processing = true;
    this.intervalId = setInterval(() => {
      this.processNext();
    }, this.intervalMs);
    this.processNext();
  }
  /**
   * Process the next item in the queue
   */
  async processNext() {
    if (this.queue.length === 0) {
      this.stop();
      return;
    }
    const fn = this.queue.shift();
    if (fn) {
      try {
        await fn();
      } catch (error) {
        console.error("[TelegramQueue] Error processing queue item:", error);
      }
    }
  }
  /**
   * Stop processing the queue
   */
  stop() {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
    this.processing = false;
  }
  /**
   * Get the current queue size
   */
  get size() {
    return this.queue.length;
  }
  /**
   * Check if the queue is currently processing
   */
  get isProcessing() {
    return this.processing;
  }
  /**
   * Clear all pending items in the queue
   */
  clear() {
    this.queue = [];
    this.stop();
  }
};

// src/lib/utils.ts
import { mkdirSync, writeFileSync } from "fs";
import { join } from "path";
function writeEventToDebugFile(event) {
  try {
    const debugDir = join(process.cwd(), "debug");
    mkdirSync(debugDir, { recursive: true });
    const filename = `${event.type}.json`;
    const filepath = join(debugDir, filename);
    writeFileSync(filepath, JSON.stringify(event, null, 2), { flag: "w" });
  } catch (error) {
    console.error(`[TelegramRemote] Failed to write event to file:`, error);
  }
}
async function sendTemporaryMessage(bot, chatId, text, durationMs = 1e3, queue) {
  try {
    const sendFn = () => bot.api.sendMessage(chatId, text);
    const sentMessage = queue ? await queue.enqueue(sendFn) : await sendFn();
    const messageId = sentMessage.message_id;
    setTimeout(async () => {
      try {
        const deleteFn = () => bot.api.deleteMessage(chatId, messageId);
        if (queue) {
          await queue.enqueue(deleteFn);
        } else {
          await deleteFn();
        }
      } catch (error) {
        console.warn("Failed to delete temporary message", { error: String(error), messageId });
      }
    }, durationMs);
  } catch (error) {
    console.error("Failed to send temporary message", { error: String(error) });
  }
}

// src/bot.ts
var botInstance = null;
function isUserAllowed(ctx, allowedUserIds) {
  const userId = ctx.from?.id;
  if (!userId) return false;
  return allowedUserIds.includes(userId);
}
function createTelegramBot(config, client, logger, sessionStore) {
  console.log("[Bot] createTelegramBot called");
  const queue = new TelegramQueue(500);
  if (botInstance) {
    console.log("[Bot] Reusing existing bot instance");
    logger.warn("Bot already initialized, reusing existing instance");
    return createBotManager(botInstance, config, queue);
  }
  console.log("[Bot] Creating new Bot instance with token");
  const bot = new Bot(config.botToken);
  botInstance = bot;
  console.log("[Bot] Bot instance created");
  console.log("[Bot] Setting up middleware and handlers...");
  bot.use(async (ctx, next) => {
    if (!isUserAllowed(ctx, config.allowedUserIds)) {
      console.log(`[Bot] Unauthorized access attempt from user ${ctx.from?.id}`);
      logger.warn("Unauthorized user attempted access", { userId: ctx.from?.id });
      return;
    }
    await next();
  });
  const manager = createBotManager(bot, config, queue);
  const commandDeps = {
    bot: manager,
    config,
    client,
    logger,
    sessionStore,
    queue
  };
  bot.command("new", createNewCommandHandler(commandDeps));
  bot.command("deletesessions", createDeleteSessionsCommandHandler(commandDeps));
  bot.command("help", createHelpCommandHandler(commandDeps));
  bot.on("message:text", createMessageTextHandler(commandDeps));
  bot.catch((error) => {
    console.error("[Bot] Bot error caught:", error);
    logger.error("Bot error", { error: String(error) });
  });
  console.log("[Bot] All handlers registered, returning bot manager");
  return manager;
}
function createBotManager(bot, config, queue) {
  return {
    async start() {
      console.log("[Bot] start() called - beginning long polling...");
      await bot.start({
        drop_pending_updates: true,
        onStart: async () => {
          console.log("[Bot] Telegram bot polling started successfully");
          try {
            await sendTemporaryMessage(bot, config.groupId, "Messaging enabled", 1e3, queue);
            console.log("[Bot] Startup message sent to group");
          } catch (error) {
            console.error("[Bot] Failed to send startup message:", error);
          }
        }
      });
    },
    async stop() {
      console.log("[Bot] stop() called");
      await bot.stop();
      botInstance = null;
      console.log("[Bot] Bot stopped and instance cleared");
    },
    async sendMessage(text) {
      console.log(`[Bot] sendMessage: "${text.slice(0, 50)}..."`);
      await queue.enqueue(() => bot.api.sendMessage(config.groupId, text));
    },
    async editMessage(messageId, text) {
      console.log(`[Bot] editMessage ${messageId}: "${text.slice(0, 50)}..."`);
      await queue.enqueue(() => bot.api.editMessageText(config.groupId, messageId, text));
    },
    async sendDocument(document, filename) {
      console.log(`[Bot] sendDocument: filename="${filename}"`);
      await queue.enqueue(
        () => bot.api.sendDocument(
          config.groupId,
          new InputFile(typeof document === "string" ? Buffer.from(document) : document, filename)
        )
      );
    },
    async sendTemporaryMessage(text, durationMs = 1e4) {
      console.log(
        `[Bot] sendTemporaryMessage: "${text.slice(0, 50)}..." (duration: ${durationMs}ms)`
      );
      await sendTemporaryMessage(bot, config.groupId, text, durationMs, queue);
    },
    queue
  };
}

// src/config.ts
import { resolve } from "path";
import { config as loadEnv } from "dotenv";
loadEnv({ path: resolve(process.cwd(), ".env") });
function parseAllowedUserIds(value) {
  if (!value || value.trim() === "") {
    return [];
  }
  return value.split(",").map((id) => id.trim()).filter((id) => id !== "").map((id) => Number.parseInt(id, 10)).filter((id) => !Number.isNaN(id));
}
function loadConfig() {
  console.log("[Config] Loading environment configuration...");
  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  const groupId = process.env.TELEGRAM_GROUP_ID;
  const allowedUserIdsStr = process.env.TELEGRAM_ALLOWED_USER_IDS;
  if (!botToken || botToken.trim() === "") {
    console.error("[Config] Missing TELEGRAM_BOT_TOKEN");
    throw new Error("Missing required environment variable: TELEGRAM_BOT_TOKEN");
  }
  if (!groupId || groupId.trim() === "") {
    console.error("[Config] Missing TELEGRAM_GROUP_ID");
    throw new Error("Missing required environment variable: TELEGRAM_GROUP_ID");
  }
  const parsedGroupId = Number.parseInt(groupId, 10);
  if (Number.isNaN(parsedGroupId)) {
    console.error("[Config] Invalid TELEGRAM_GROUP_ID (not a number)");
    throw new Error("TELEGRAM_GROUP_ID must be a valid number");
  }
  const allowedUserIds = parseAllowedUserIds(allowedUserIdsStr);
  if (allowedUserIds.length === 0) {
    console.error("[Config] Missing or invalid TELEGRAM_ALLOWED_USER_IDS");
    throw new Error(
      "Missing or invalid TELEGRAM_ALLOWED_USER_IDS (must be comma-separated numeric user IDs)"
    );
  }
  console.log(
    `[Config] Configuration loaded: groupId=${parsedGroupId}, allowedUsers=${allowedUserIds.length}`
  );
  return {
    botToken,
    groupId: parsedGroupId,
    allowedUserIds
  };
}

// src/lib/config.ts
var SERVICE_NAME = "TelegramRemote";

// src/lib/logger.ts
function log(client, level, message, extra) {
  client.app.log({
    body: {
      service: SERVICE_NAME,
      level,
      message,
      extra
    }
  }).catch(() => {
  });
}
function createLogger(client) {
  return {
    debug: (message, extra) => log(client, "debug", message, extra),
    info: (message, extra) => log(client, "info", message, extra),
    warn: (message, extra) => log(client, "warn", message, extra),
    error: (message, extra) => log(client, "error", message, extra)
  };
}

// src/events/message-updated.ts
async function handleMessageUpdated(event, context) {
  const logger = createLogger(context.client);
  const message = event.properties.info;
  console.log(`[TelegramRemote] Message updated: ${message.id}, role: ${message.role}`);
  if (message.summary?.body) {
    console.log(`[TelegramRemote] Sending summary body for message ${message.id}`);
    try {
      await context.bot.sendTemporaryMessage(message.summary.body);
      console.log(`[TelegramRemote] Summary body sent and will be deleted after timeout`);
    } catch (error) {
      console.error("[TelegramRemote] Failed to send summary body:", error);
      logger.error("Failed to send summary body", { error: String(error) });
    }
  }
  if (message.role === "user") {
    context.messageTracker.markAsUser(message.id);
  } else if (message.role === "assistant") {
    context.messageTracker.markAsAssistant(message.id);
    const promptMessageId = context.sessionStore.getPromptMessageId();
    if (promptMessageId) {
      context.messageTracker.setStatusMessageId(message.id, promptMessageId);
      context.messageTracker.setProcessingPrompt(message.id, true);
      context.sessionStore.clearPromptMessageId();
      console.log(
        `[TelegramRemote] Linked prompt message ${promptMessageId} to assistant message ${message.id}`
      );
    }
    if (message.time?.completed) {
      context.messageTracker.setProcessingPrompt(message.id, false);
      context.messageTracker.clearUpdateInterval(message.id);
      const content = context.messageTracker.getContent(message.id);
      if (content) {
        const lines = content.split("\n");
        if (lines.length > 100) {
          console.log(
            `[TelegramRemote] Message ${message.id} completed with ${lines.length} lines. Sending as Markdown file.`
          );
          try {
            await context.bot.sendDocument(content, "response.md");
          } catch (error) {
            console.error("[TelegramRemote] Failed to send document:", error);
            logger.error("Failed to send document", { error: String(error) });
          }
        }
        context.messageTracker.clearAllTracking(message.id);
      }
    }
  }
}

// src/events/session-created.ts
async function handleSessionCreated(event, context) {
  const sessionId = event.properties.info.id;
  console.log(`[TelegramRemote] Session created: ${sessionId.slice(0, 8)}`);
  await context.bot.sendMessage(`\u2705 Session initialized: ${sessionId.slice(0, 8)}`);
}

// src/message-tracker.ts
var MessageTracker = class {
  userMessages = /* @__PURE__ */ new Set();
  assistantMessages = /* @__PURE__ */ new Set();
  messageContent = /* @__PURE__ */ new Map();
  statusMessageIds = /* @__PURE__ */ new Map();
  // messageId -> telegram message ID
  processingPrompts = /* @__PURE__ */ new Map();
  // messageId -> processing flag
  latestUpdates = /* @__PURE__ */ new Map();
  // messageId -> latest update text
  updateIntervals = /* @__PURE__ */ new Map();
  // messageId -> interval handle
  markAsUser(messageId) {
    this.userMessages.add(messageId);
    this.assistantMessages.delete(messageId);
    this.messageContent.delete(messageId);
  }
  markAsAssistant(messageId) {
    this.assistantMessages.add(messageId);
    this.userMessages.delete(messageId);
  }
  isAssistant(messageId) {
    return this.assistantMessages.has(messageId);
  }
  isUser(messageId) {
    return this.userMessages.has(messageId);
  }
  updateContent(messageId, content) {
    this.messageContent.set(messageId, content);
  }
  getContent(messageId) {
    return this.messageContent.get(messageId);
  }
  clearContent(messageId) {
    this.messageContent.delete(messageId);
  }
  setStatusMessageId(messageId, telegramMessageId) {
    this.statusMessageIds.set(messageId, telegramMessageId);
  }
  getStatusMessageId(messageId) {
    return this.statusMessageIds.get(messageId);
  }
  setProcessingPrompt(messageId, processing) {
    this.processingPrompts.set(messageId, processing);
  }
  isProcessingPrompt(messageId) {
    return this.processingPrompts.get(messageId) || false;
  }
  setLatestUpdate(messageId, text) {
    this.latestUpdates.set(messageId, text);
  }
  getLatestUpdate(messageId) {
    return this.latestUpdates.get(messageId);
  }
  setUpdateInterval(messageId, interval) {
    this.updateIntervals.set(messageId, interval);
  }
  clearUpdateInterval(messageId) {
    const interval = this.updateIntervals.get(messageId);
    if (interval) {
      clearInterval(interval);
      this.updateIntervals.delete(messageId);
    }
  }
  clearAllTracking(messageId) {
    this.clearUpdateInterval(messageId);
    this.statusMessageIds.delete(messageId);
    this.processingPrompts.delete(messageId);
    this.latestUpdates.delete(messageId);
    this.clearContent(messageId);
  }
};

// src/session-store.ts
var SessionStore = class {
  activeSessionId = null;
  promptMessageId = void 0;
  // Telegram message ID for active prompt
  setActiveSession(sessionId) {
    this.activeSessionId = sessionId;
  }
  getActiveSession() {
    return this.activeSessionId;
  }
  clearActiveSession() {
    this.activeSessionId = null;
  }
  setPromptMessageId(messageId) {
    this.promptMessageId = messageId;
  }
  getPromptMessageId() {
    return this.promptMessageId;
  }
  clearPromptMessageId() {
    this.promptMessageId = void 0;
  }
};

// src/telegram-remote.ts
var TelegramRemote = async ({ client }) => {
  console.log("[TelegramRemote] Plugin initialization started");
  const logger = createLogger(client);
  let config;
  try {
    console.log("[TelegramRemote] Loading configuration...");
    config = loadConfig();
    console.log("[TelegramRemote] Configuration loaded successfully");
  } catch (error) {
    console.error("[TelegramRemote] Configuration error:", error);
    logger.error(`Configuration error: ${error}`);
    return {
      event: async () => {
      }
    };
  }
  console.log("[TelegramRemote] Creating session store and message tracker...");
  const sessionStore = new SessionStore();
  const messageTracker = new MessageTracker();
  console.log("[TelegramRemote] Creating Telegram bot...");
  const bot = createTelegramBot(config, client, logger, sessionStore);
  console.log("[TelegramRemote] Bot created successfully");
  console.log("[TelegramRemote] Starting Telegram bot polling...");
  bot.start().catch((error) => {
    console.error("[TelegramRemote] Failed to start bot:", error);
    logger.error("Failed to start bot", { error: String(error) });
  });
  let isShuttingDown = false;
  process.on("SIGINT", async () => {
    if (isShuttingDown) {
      console.log("[TelegramRemote] Force exit...");
      process.exit(1);
    }
    isShuttingDown = true;
    console.log("[TelegramRemote] Received SIGINT, stopping bot...");
    try {
      await bot.stop();
      console.log("[TelegramRemote] Bot stopped successfully, exiting...");
      process.exit(0);
    } catch (error) {
      console.error("[TelegramRemote] Error stopping bot:", error);
      process.exit(1);
    }
  });
  process.on("SIGTERM", async () => {
    if (isShuttingDown) {
      console.log("[TelegramRemote] Force exit...");
      process.exit(1);
    }
    isShuttingDown = true;
    console.log("[TelegramRemote] Received SIGTERM, stopping bot...");
    try {
      await bot.stop();
      console.log("[TelegramRemote] Bot stopped successfully, exiting...");
      process.exit(0);
    } catch (error) {
      console.error("[TelegramRemote] Error stopping bot:", error);
      process.exit(1);
    }
  });
  console.log("[TelegramRemote] Plugin initialization complete, returning event handler");
  const eventContext = {
    client,
    bot,
    sessionStore,
    messageTracker
  };
  const eventHandlers = {
    "session.created": handleSessionCreated,
    "message.updated": handleMessageUpdated
  };
  return {
    event: async ({ event }) => {
      console.log(`[TelegramRemote] Event received: ${event.type}`);
      writeEventToDebugFile(event);
      const handler = eventHandlers[event.type];
      if (handler) {
        await handler(event, eventContext);
      }
    }
  };
};
export {
  TelegramRemote
};
