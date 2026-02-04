import type { EventHandlerContext } from "./types.js";

export async function handleQuestionAsked(event: any, context: EventHandlerContext): Promise<void> {
    // Extract the question from the event properties
    const question = event?.properties?.question;

    if (question && context.bot) {
        console.log(`[TelegramRemote] Question asked: ${question}`);

        try {
            await context.bot.sendTemporaryMessage(`❓ Question: ${question}`);
        } catch (error) {
            console.error("[TelegramRemote] Failed to send question notification:", error);
        }
    }
}
