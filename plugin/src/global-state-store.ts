import type { Agent } from "@opencode-ai/sdk/v2";

export interface StoredEvent {
  type: string;
  data: unknown;
  timestamp: number;
}

export interface TodoItem {
  content: string;
  status: "pending" | "completed" | "cancelled" | "in_progress";
  priority: "low" | "medium" | "high";
  id: string;
}

export class GlobalStateStore {
  private events: StoredEvent[] = [];
  private trackedEventTypes: Set<string>;
  private availableAgents: Agent[] = [];
  private currentAgent: string | null = null;
  private sessionStatus: string | null = null;
  private lastMessagePartUpdate: string | null = null;
  private lastResponse: string | null = null;
  private lastResponseSentContent: string | null = null;
  public lastSendFinalMessage: Map<string, string> = new Map();

  public lastUpdateMessage: Map<string, string> = new Map();
  public lastUpdateDeltaMessage: Map<string, string> = new Map();

  private todos: TodoItem[] = [];
  private currentSessionId: string | null = null;
  private activeChatId: number | null = null;
  private sessionTitles: Map<string, string> = new Map();

  constructor(config: { trackedEventTypes: string[] }) {
    this.trackedEventTypes = new Set(config.trackedEventTypes);
  }

  // Session tracking methods
  setCurrentSession(sessionId: string): void {
    this.currentSessionId = sessionId;
  }

  setSessionTitle(sessionId: string, title: string): void {
    this.sessionTitles.set(sessionId, title);
  }

  getSessionTitle(sessionId: string): string | null {
    return this.sessionTitles.get(sessionId) ?? null;
  }

  getCurrentSession(): string | null {
    return this.currentSessionId;
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

  clearCurrentSession(): void {
    this.currentSessionId = null;
  }

  addEvent(type: string, data: unknown): void {
    if (this.trackedEventTypes.has(type)) {
      this.events.push({
        type,
        data,
        timestamp: Date.now(),
      });
    }
  }

  getEvents(type?: string): StoredEvent[] {
    if (type) {
      return this.events.filter((e) => e.type === type);
    }
    return [...this.events];
  }

  clearEvents(type?: string): number {
    const initialCount = this.events.length;
    if (type) {
      this.events = this.events.filter((e) => e.type !== type);
    } else {
      this.events = [];
    }
    return initialCount - this.events.length;
  }

  setAgents(agents: Agent[]): void {
    this.availableAgents = agents;
  }

  getAgents(): Agent[] {
    return this.availableAgents;
  }

  setCurrentAgent(agent: string): void {
    this.currentAgent = agent;
  }

  getCurrentAgent(): string | null {
    return this.currentAgent;
  }

  getCurrentSessionTitle(): string {
    if (!this.currentSessionId) {
      return this.currentSessionId ?? "";
    }
    return this.sessionTitles.get(this.currentSessionId) ?? this.currentSessionId;
  }

  setSessionStatus(status: string): void {
    this.sessionStatus = status;
  }

  getSessionStatus(): string | null {
    return this.sessionStatus;
  }

  setLastMessagePartUpdate(text: string): void {
    this.lastMessagePartUpdate = text;
  }

  getLastMessagePartUpdate(): string | null {
    return this.lastMessagePartUpdate;
  }

  setLastResponse(text: string): void {
    this.lastResponse = text;
  }

  getLastResponse(): string | null {
    return this.lastResponse;
  }

  setLastResponseSentContent(text: string): void {
    this.lastResponseSentContent = text;
  }

  getLastResponseSentContent(): string | null {
    return this.lastResponseSentContent;
  }

  setLastSendFinalMessage(sessionId: string, text: string): void {
    if (!sessionId) return;
    this.lastSendFinalMessage.set(sessionId, text);
  }

  getLastSendFinalMessage(sessionId: string): string | null {
    return this.lastSendFinalMessage.get(sessionId) ?? null;
  }

  setLastUpdateMessage(sessionId: string, text: string): void {
    if (!sessionId) return;
    this.lastUpdateMessage.set(sessionId, text);
  }

  getLastUpdateMessage(sessionId: string): string | null {
    return this.lastUpdateMessage.get(sessionId) ?? null;
  }

  setLastUpdateDeltaMessage(sessionId: string, delta: string): void {
    if (!sessionId) return;
    this.lastUpdateDeltaMessage.set(sessionId, delta);
  }

  getLastUpdateDeltaMessage(sessionId: string): string | null {
    return this.lastUpdateDeltaMessage.get(sessionId) ?? null;
  }

  setTodos(todos: TodoItem[]): void {
    this.todos = [...todos];
  }

  getTodos(): TodoItem[] {
    return [...this.todos];
  }
}
