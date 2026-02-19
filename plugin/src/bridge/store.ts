import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type { TopicSessionBinding, TopicSessionStateFile } from "./types.js";

function nowMs(): number {
  return Date.now();
}

function createEmptyState(): TopicSessionStateFile {
  return {
    version: 1,
    topics: [],
  };
}

export class TopicSessionStore {
  private readonly statePath: string;
  private state: TopicSessionStateFile;

  constructor(statePath: string) {
    this.statePath = statePath;
    this.state = this.load();
  }

  private load(): TopicSessionStateFile {
    try {
      const raw = readFileSync(this.statePath, "utf8");
      const parsed = JSON.parse(raw) as TopicSessionStateFile;
      if (parsed?.version !== 1 || !Array.isArray(parsed.topics)) {
        return createEmptyState();
      }
      return parsed;
    } catch {
      return createEmptyState();
    }
  }

  private persist(): void {
    mkdirSync(dirname(this.statePath), { recursive: true });
    const tmpPath = `${this.statePath}.tmp-${nowMs()}`;
    writeFileSync(tmpPath, JSON.stringify(this.state, null, 2));
    renameSync(tmpPath, this.statePath);
  }

  getByThread(chatId: number, threadId: number): TopicSessionBinding | undefined {
    return this.state.topics.find(
      (item) => item.chatId === chatId && item.threadId === threadId,
    );
  }

  getBySession(sessionId: string): TopicSessionBinding | undefined {
    return this.state.topics.find((item) => item.sessionId === sessionId);
  }

  listAll(): TopicSessionBinding[] {
    return [...this.state.topics];
  }

  listByChat(chatId: number): TopicSessionBinding[] {
    return this.state.topics.filter((item) => item.chatId === chatId);
  }

  upsert(binding: TopicSessionBinding): void {
    const index = this.state.topics.findIndex(
      (item) =>
        item.chatId === binding.chatId && item.threadId === binding.threadId,
    );
    if (index === -1) {
      this.state.topics.push(binding);
    } else {
      this.state.topics[index] = binding;
    }
    this.persist();
  }

  patchBySession(
    sessionId: string,
    patch: Partial<Omit<TopicSessionBinding, "chatId" | "threadId" | "sessionId" | "createdBy" | "createdAt">>,
  ): TopicSessionBinding | undefined {
    const index = this.state.topics.findIndex((item) => item.sessionId === sessionId);
    if (index === -1) {
      return undefined;
    }
    const next: TopicSessionBinding = {
      ...this.state.topics[index],
      ...patch,
      updatedAt: nowMs(),
    };
    this.state.topics[index] = next;
    this.persist();
    return next;
  }

  closeByThread(chatId: number, threadId: number): TopicSessionBinding | undefined {
    const current = this.getByThread(chatId, threadId);
    if (!current) {
      return undefined;
    }
    const next: TopicSessionBinding = {
      ...current,
      state: "closed",
      updatedAt: nowMs(),
    };
    this.upsert(next);
    return next;
  }
}
