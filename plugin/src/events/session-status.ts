import type { EventHandlerContext } from "./types.js";

export async function handleSessionStatus(event: any, context: EventHandlerContext): Promise<void> {
  const statusType = event?.properties?.status?.type;
  if (statusType) {

    // If the session becomes idle, tell the user the agent has finished
    if (statusType === "idle") {
      try {
        // Get the session ID and title
        const sessionId = event?.properties?.info?.id ?? event?.properties?.sessionID ?? event?.properties?.id;
        let message = "Agent has finished.";

        if (sessionId && context.sessionTitleService) {
          const title = context.sessionTitleService.getSessionTitle(sessionId);
          if (title) {
            message = `Agent has finished: ${title}`;
          }
        }

        await context.bot.sendLegacyMessage(message);
      } catch (error) {
        console.error("[TelegramRemote] Failed to send idle notification:");
      }
    }

  }
}
