export type SessionState = "active" | "idle" | "error" | "closed";

export interface ModelRef {
  providerID: string;
  modelID: string;
}

export interface TopicSessionBinding {
  chatId: number;
  threadId: number;
  workspacePath: string;
  sessionId: string;
  state: SessionState;
  model: ModelRef;
  reasoningEffort?: string;
  reasoningSummary?: string;
  textVerbosity?: string;
  createdBy: number;
  createdAt: number;
  updatedAt: number;
  lastError?: string;
  sessionTitle?: string;
}

export interface TopicSessionStateFile {
  version: 1;
  topics: TopicSessionBinding[];
}

export interface TelegramAttachment {
  filename: string;
  mime: string;
  dataUrl: string;
}

export interface InboundTelegramMessage {
  chatId: number;
  chatType: string;
  threadId?: number;
  messageId: number;
  userId: number;
  mediaGroupId?: string;
  text?: string;
  caption?: string;
  photoFileId?: string;
  document?: {
    fileId: string;
    filename?: string;
    mime?: string;
  };
  replyContext?: {
    messageId: number;
    fromName?: string;
    text?: string;
    caption?: string;
    hasPhoto?: boolean;
    documentName?: string;
    documentMime?: string;
  };
}

export interface PendingPrompt {
  sourceMessageId: number;
  replyToMessageId?: number;
  userId: number;
  createdAt: number;
  mediaGroupId?: string;
  parts: Array<{
    type: "text" | "file";
    text?: string;
    mime?: string;
    filename?: string;
    url?: string;
  }>;
}

export interface SessionRuntime {
  inFlight: boolean;
  pending: PendingPrompt[];
  lastPrompt?: PendingPrompt;
  retriedAfterCompaction: boolean;
  lastAssistantMessageId?: string;
  lastDeliveredAssistantMessageId?: string;
  progressMessageId?: number;
  lastProgressText?: string;
  pendingProgressText?: string;
  runStartedAt?: number;
  progressTicker?: ReturnType<typeof setInterval>;
  nextProgressEditAt?: number;
  nextProgressSendAt?: number;
  progressBlockedUntil?: number;
  liveStage?: string;
  liveDetail?: string;
  stagedPrompt?: PendingPrompt;
  stagedTimer?: ReturnType<typeof setTimeout>;
}
