import type { EventHandlerContext } from "./types.js";

export async function handleSessionStatus(event: any, context: EventHandlerContext): Promise<void> {
  // Safely access the status type from the nested property path
  const statusType = event?.properties?.status?.type;

  if (statusType && context.globalStateStore) {
    context.globalStateStore.setSessionStatus(statusType);
    console.log(`[TelegramRemote] Session status updated: ${statusType}`);
  }
}
