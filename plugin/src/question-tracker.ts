import { Question, QuestionSessionState } from "./lib/types.js";

export class QuestionTracker {
  private sessions: Map<string, QuestionSessionState> = new Map();

  createQuestionSession(questionId: string, sessionId: string, questions: Question[]): void {
    const sessionState: QuestionSessionState = {
      questionId,
      sessionId,
      questions,
      currentQuestionIndex: 0,
      answers: [],
      telegramMessageIds: [],
      createdAt: new Date(),
    };
    this.sessions.set(questionId, sessionState);
  }

  getActiveQuestionSession(questionId: string): QuestionSessionState | undefined {
    return this.sessions.get(questionId);
  }

  updateQuestionSession(questionId: string, state: QuestionSessionState): void {
    this.sessions.set(questionId, state);
  }

  clearQuestionSession(questionId: string): void {
    this.sessions.delete(questionId);
  }

  // Helper method to get tracking key from question ID
  // Telegram callback data has size limits, so we might need short IDs
  // For now assuming question ID fits or we use a mapping if needed
}
