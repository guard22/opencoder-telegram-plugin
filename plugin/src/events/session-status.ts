import type { EventHandlerContext } from "./types.js";

export async function handleSessionStatus(event: any, context: EventHandlerContext): Promise<void> {
  // Safely access the status type from the nested property path
  const statusType = event?.properties?.status?.type;

  if (statusType) {
    console.log(`[TelegramRemote] Session status updated: ${statusType}`);

    // If the session becomes idle, tell the user the agent has finished
    if (statusType === "idle") {
      console.log(`[TelegramRemote] Session is idle. Sending finished notification.`);
      try {
        await context.bot.sendTemporaryMessage("Agent has finished.");
      } catch (error) {
        console.error("[TelegramRemote] Failed to send idle notification:", error);
      }
    }

  }
}
