import type { createOpencodeClient } from "@opencode-ai/sdk";

export type OpencodeClient = ReturnType<typeof createOpencodeClient>;

export interface QuestionOption {
  label: string;
  description: string;
}

export interface Question {
  header: string;
  question: string;
  options: QuestionOption[];
  multiple?: boolean;
}

export interface QuestionAskedEvent {
  type: "question.asked";
  properties: {
    id: string;
    sessionID: string;
    questions: Question[];
    tool?: {
      messageID: string;
      callID: string;

export interface QuestionSessionState {
  questionId: string;
  sessionId: string;
  questions: Question[];
  currentQuestionIndex: number;
  answers: string[][];
  telegramMessageIds: number[];
  createdAt: Date;
}
