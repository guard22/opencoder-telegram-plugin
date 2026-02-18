import type { Plugin } from "@opencode-ai/plugin";
import { createTelegramBot } from "./bot.js";
import { TelegramForumBridge } from "./bridge/controller.js";
import { loadConfig } from "./config.js";

export const TelegramRemote: Plugin = async () => {
  let config;
  try {
    config = loadConfig();
  } catch (error) {
    console.error("[TelegramRemote] Config load failed:", error);
    return {
      event: async () => { },
    };
  }

  let bridge: TelegramForumBridge | undefined;
  const bot = createTelegramBot(config, async (message) => {
    if (!bridge) {
      return;
    }
    await bridge.handleInboundMessage(message);
  });
  bridge = new TelegramForumBridge(config, bot);

  bot.start().catch((error) => {
    console.error("[TelegramRemote] Failed to start Telegram bot:", error);
  });

  let isShuttingDown = false;
  async function shutdown(): Promise<void> {
    if (isShuttingDown) {
      return;
    }
    isShuttingDown = true;
    try {
      await bot.stop();
    } catch (error) {
      console.error("[TelegramRemote] Error while stopping bot:", error);
    }
  }

  process.on("SIGINT", () => {
    void shutdown();
  });

  process.on("SIGTERM", () => {
    void shutdown();
  });

  return {
    event: async ({ event }) => {
      await bridge?.handleEvent(event);
    },
  };
};
