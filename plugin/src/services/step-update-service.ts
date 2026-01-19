import type { TelegramBotManager } from "../bot.js";
import type { GlobalStateStore } from "../global-state-store.js";
import type { Logger } from "../lib/logger.js";

interface SessionState {
  intervalId: NodeJS.Timeout;
  messageId?: number;
  lastSentText?: string;
  inFlightText?: string;
  isSending: boolean;
  finalSent: boolean;
  sendingPromise: Promise<void>;
}

export class StepUpdateService {
  private sessions: Map<string, SessionState> = new Map();

  constructor(
    private bot: TelegramBotManager,
    private globalStateStore: GlobalStateStore,
    private logger: Logger,
    private intervalMs: number,
  ) {}

  start(sessionId: string): void {
    if (!sessionId || this.sessions.has(sessionId)) {
      return;
    }

    const intervalId = setInterval(() => {
      void this.sendUpdate(sessionId, false);
    }, this.intervalMs);

    this.sessions.set(sessionId, {
      intervalId,
      isSending: false,
      finalSent: false,
      sendingPromise: Promise.resolve(),
    });

    void this.sendUpdate(sessionId, false);
  }

  async finish(sessionId: string): Promise<void> {
    if (!sessionId) {
      return;
    }

    const state = this.sessions.get(sessionId);
    if (state) {
      clearInterval(state.intervalId);
    }

    const messageId = await this.sendUpdate(sessionId, true);

    if (state) {
      this.sessions.delete(sessionId);
    }

    if (messageId) {
      setTimeout(() => {
        void this.bot.deleteMessage(messageId).catch((error: unknown) => {
          this.logger.warn("Failed to delete step update message", {
            error: String(error),
            sessionId,
            messageId,
          });
        });
      }, 2000);
    }
  }

  private async sendUpdate(sessionId: string, isFinal: boolean): Promise<number | undefined> {
    const state = this.sessions.get(sessionId);

    // If we have state, we chain this update to the previous one
    if (state) {
      const nextUpdate = state.sendingPromise.then(async () => {
        return await this.performUpdate(sessionId, isFinal, state);
      });

      // Update the promise chain, but catch errors to prevent breaking the chain for future updates
      state.sendingPromise = nextUpdate.then(() => {}).catch(() => {});

      return nextUpdate;
    }

    // Fallback for no state (only happens if finish() called on unknown session)
    // In this case, we just send a new message if it's final
    return await this.performUpdate(sessionId, isFinal, undefined);
  }

  private async performUpdate(
    sessionId: string,
    isFinal: boolean,
    state: SessionState | undefined,
  ): Promise<number | undefined> {
    const text = this.globalStateStore.getLastUpdate(sessionId);

    if (!text || text.trim() === "") {
      if (isFinal && state) {
        state.finalSent = true;
      }
      return undefined;
    }

    if (!state) {
      if (isFinal) {
        try {
          const result = await this.bot.sendMessage(text);
          return result.message_id;
        } catch (error) {
          this.logger.warn("Failed to send final step update", {
            error: String(error),
            sessionId,
          });
        }
      }
      return undefined;
    }

    if (state.finalSent && !isFinal) {
      return state.messageId;
    }

    if (state.lastSentText === text) {
      if (isFinal) {
        state.finalSent = true;
      }
      return state.messageId;
    }

    // Note: We removed the `state.isSending` check because the promise chain
    // guarantees strict sequential execution. We still keep the flag for consistency/debugging if needed,
    // but `inFlightText` logic is less critical now for locking, more for optimization.

    try {
      state.isSending = true;
      state.inFlightText = text;

      if (state.messageId) {
        await this.bot.editMessage(state.messageId, text);
      } else {
        const result = await this.bot.sendMessage(text);
        state.messageId = result.message_id;
      }

      state.lastSentText = text;
      if (isFinal) {
        state.finalSent = true;
      }
      return state.messageId;
    } catch (error) {
      this.logger.warn("Failed to send step update", {
        error: String(error),
        sessionId,
        isFinal,
      });
    } finally {
      state.isSending = false;
      if (state.inFlightText === text) {
        state.inFlightText = undefined;
      }
    }

    return state.messageId;
  }
}
