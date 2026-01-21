import type { createTelegramBot } from "../bot.js";
import type { Config } from "../config.js";
import type { GlobalStateStore } from "../global-state-store.js";
import type { OpencodeClient } from "../lib/types.js";

export type TelegramBot = ReturnType<typeof createTelegramBot>;

export interface EventHandlerContext {
  client: OpencodeClient;
  bot: TelegramBot;
  globalStateStore: GlobalStateStore;
  config: Config;
}
