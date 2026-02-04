import type { PluginInput } from "@opencode-ai/plugin";
import type { createTelegramBot } from "../bot.js";
import type { Config } from "../config.js";
import type { SessionTitleService } from "../services/session-title-service.js";

export type OpencodeClient = PluginInput["client"];
export type TelegramBot = ReturnType<typeof createTelegramBot>;

export interface EventHandlerContext {
  client: OpencodeClient;
  bot: TelegramBot;
  sessionTitleService: SessionTitleService;
  config: Config;
}
