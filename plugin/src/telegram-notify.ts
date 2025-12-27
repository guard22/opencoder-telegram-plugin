import type { Plugin } from "@opencode-ai/plugin";
import { sendNotification } from "./features/notify/service";
import { isConfigured } from "./lib/config";
import { createLogger } from "./lib/logger";
import { extractProjectName } from "./lib/utils";

export const TelegramNotify: Plugin = async ({ client, directory }) => {
  const logger = createLogger(client);

  if (!isConfigured()) {
    logger.error("Plugin not configured. Please replace INSTALL_KEY and WORKER_URL placeholders.");
    return {
      event: async () => {},
    };
  }

  const projectName = extractProjectName(directory);

  return {
    event: async ({ event }) => {
      if (event.type === "session.idle") {
        await sendNotification(client, logger, projectName, event.properties.sessionID);
      }
    },
  };
};
