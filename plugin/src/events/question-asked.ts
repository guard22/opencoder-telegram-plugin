import { InlineKeyboard } from "grammy";
import type { QuestionAskedEvent } from "../lib/types.js";
import type { EventHandlerContext } from "./types.js";

export async function handleQuestionAsked(
  event: QuestionAskedEvent,
  context: EventHandlerContext,
): Promise<void> {
  const { id: questionId, sessionID, questions } = event.properties;

  console.log(`[TelegramRemote] Question asked: ${questionId} (${questions.length} questions)`);

  // Create question tracking session
  context.questionTracker.createQuestionSession(questionId, sessionID, questions);

  // Display the first question
  await sendQuestion(context, questionId, 0);
}

export async function sendQuestion(
  context: EventHandlerContext,
  questionId: string,
  index: number,
): Promise<void> {
  const session = context.questionTracker.getActiveQuestionSession(questionId);
  if (!session || index >= session.questions.length) {
    return;
  }

  const question = session.questions[index];
  const isMultiple = question.multiple ?? false;

  // Get current temporary answers if any (for redrawing checks)
  const currentAnswers = session.answers[index] || [];

  const keyboard = new InlineKeyboard();

  question.options.forEach((option, optionIndex) => {
    const isSelected = currentAnswers.includes(option.label);
    const icon = isMultiple ? (isSelected ? "☑ " : "☐ ") : "";
    // Callback data: q:{questionId}:{questionIndex}:{optionIndex}
    // Using minimal ID length to avoid 64-byte limit
    // q:ShortID:0:1
    keyboard.text(`${icon}${option.label}`, `q:${questionId}:${index}:${optionIndex}`).row();
  });

  if (isMultiple) {
    keyboard.text("Done", `q:${questionId}:${index}:done`);
  }

  const messageText = `❓ *${question.header}*\n\n${question.question}\n\n${question.options
    .map((o) => `• *${o.label}*: ${o.description}`)
    .join("\n")}`;

  // Send using the enhanced sendMessage with options
  const result = await context.bot.sendMessage(messageText, {
    parse_mode: "Markdown",
    reply_markup: keyboard,
  });

  if (session) {
    session.telegramMessageIds.push(result.message_id);
    context.questionTracker.updateQuestionSession(questionId, session);
  }
}
