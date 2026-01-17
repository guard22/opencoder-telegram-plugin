export class SessionStore {
  private activeSessionId: string | null = null;
  private promptMessageId: number | undefined = undefined; // Telegram message ID for active prompt
  private sessionInitializedMessageId: number | undefined = undefined; // Telegram message ID for "Session initialized"

  setActiveSession(sessionId: string): void {
    this.activeSessionId = sessionId;
  }

  getActiveSession(): string | null {
    return this.activeSessionId;
  }

  clearActiveSession(): void {
    this.activeSessionId = null;
  }

  setPromptMessageId(messageId: number): void {
    this.promptMessageId = messageId;
  }

  getPromptMessageId(): number | undefined {
    return this.promptMessageId;
  }

  clearPromptMessageId(): void {
    this.promptMessageId = undefined;
  }

  setSessionInitializedMessageId(messageId: number): void {
    this.sessionInitializedMessageId = messageId;
  }

  getSessionInitializedMessageId(): number | undefined {
    return this.sessionInitializedMessageId;
  }
}
