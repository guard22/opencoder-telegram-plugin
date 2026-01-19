import type { createTelegramBot } from "../bot.js";
import type { GlobalStateStore } from "../global-state-store.js";
import type { OpencodeClient } from "../lib/types.js";
import type { QuestionTracker } from "../question-tracker.js";
import type { StepUpdateService } from "../services/step-update-service.js";

export type TelegramBot = ReturnType<typeof createTelegramBot>;

export interface EventHandlerContext {
  client: OpencodeClient;
  bot: TelegramBot;
  globalStateStore: GlobalStateStore;
  questionTracker: QuestionTracker;
  stepUpdateService: StepUpdateService;
}
