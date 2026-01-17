import type { Question, QuestionSessionState } from "./lib/types.js";

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

  recordAnswer(questionId: string, questionIndex: number, answer: string[]): void {
    const session = this.sessions.get(questionId);
    if (session) {
      // Ensure array exists up to this index
      while (session.answers.length <= questionIndex) {
        session.answers.push([]);
      }
      session.answers[questionIndex] = answer;
      this.updateQuestionSession(questionId, session);
    }
  }

  getCurrentQuestionIndex(questionId: string): number | undefined {
    return this.sessions.get(questionId)?.currentQuestionIndex;
  }
}
