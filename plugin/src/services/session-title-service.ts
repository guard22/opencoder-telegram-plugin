export class SessionTitleService {
    private sessionTitles: Map<string, string> = new Map();
    private activeChatId: number | null = null;

    setSessionTitle(sessionId: string, title: string): void {
        this.sessionTitles.set(sessionId, title);
    }

    getSessionTitle(sessionId: string): string | null {
        return this.sessionTitles.get(sessionId) ?? null;
    }

    setActiveChatId(chatId: number): void {
        this.activeChatId = chatId;
    }

    getActiveChatId(): number | null {
        return this.activeChatId;
    }

    clearActiveChatId(): void {
        this.activeChatId = null;
    }
}
