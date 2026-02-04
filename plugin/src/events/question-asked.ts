import type { EventHandlerContext } from "./types.js";

export async function handleQuestionAsked(event: any, context: EventHandlerContext): Promise<void> {
    // Extract session ID and questions from the event
    const sessionID = event?.properties?.sessionID;
    const questions = event?.properties?.questions;

    if (sessionID && questions && Array.isArray(questions) && questions.length > 0 && context.bot) {
        // Get the session title
        const sessionTitle = context.sessionTitleService.getSessionTitle(sessionID);
        const titleText = sessionTitle ? `📋 ${sessionTitle}` : `Session: ${sessionID}`;

        // Format the questions
        const questionTexts = questions
            .map((q: any, index: number) => {
                const header = q.header ? `${q.header}: ` : '';
                return `${index + 1}. ${header}${q.question}`;
            })
            .join('\n');

        const message = `${titleText}\n\n❓ Questions:\n${questionTexts}`;

        try {
            await context.bot.sendMessage(message);
        } catch (error) {
            console.error("[TelegramRemote] Failed to send question notification:", error);
        }
    }
}
