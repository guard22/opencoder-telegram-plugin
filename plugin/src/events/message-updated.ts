import { createLogger } from "../lib/logger.js";
import type { EventHandlerContext } from "./types.js";

export async function handleMessageUpdated(
  event: any,
  context: EventHandlerContext,
): Promise<void> {
  const logger = createLogger(context.client);
  const message = event.properties.info;
  console.log(`[TelegramRemote] Message updated: ${message.id}, role: ${message.role}`);

  // Check if there's a summary body to send as a temporary message
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

  if (message.role === "assistant" && message.time?.completed) {
    // Check if we have content to store/send
    if (message.content) {
      // Store last response in global state
      context.globalStateStore.setLastResponse(message.content);

      const lines = message.content.split("\n");
      if (lines.length > 100) {
        console.log(
          `[TelegramRemote] Message ${message.id} completed with ${lines.length} lines. Sending as Markdown file.`,
        );
        try {
          await context.bot.sendDocument(message.content, "response.md");
        } catch (error) {
          console.error("[TelegramRemote] Failed to send document:", error);
          logger.error("Failed to send document", { error: String(error) });
        }
      } else {
        console.log(
          `[TelegramRemote] Message ${message.id} completed with ${lines.length} lines. Sending as text.`,
        );
        try {
          await context.bot.sendMessage(message.content);
        } catch (error) {
          console.error("[TelegramRemote] Failed to send message:", error);
          logger.error("Failed to send message", { error: String(error) });
        }
      }
    }
  }
}
