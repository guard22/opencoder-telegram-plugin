import type { Context } from "grammy";
import { getDefaultKeyboardOptions } from "../lib/utils.js";
import type { CommandDeps } from "./types.js";

export function createEscCommandHandler({ config, client, logger, globalStateStore }: CommandDeps) {
  return async (ctx: Context) => {
    console.log("[Bot] /esc command received");
    if (ctx.chat?.type !== "private") return;

    // Enforce authorization explicitly so middleware cannot be bypassed
    const userId = ctx.from?.id;
    if (!userId || !config.allowedUserIds.includes(userId)) {
      console.log(`[Bot] /esc attempt by unauthorized user ${userId}`);
      await ctx.reply("You are not authorized to use this bot.", getDefaultKeyboardOptions());
      return;
    }

    const sessionId = globalStateStore.getActiveSession();

    if (!sessionId) {
      await ctx.reply("❌ No active session. Use /new to create one.", getDefaultKeyboardOptions());
      return;
    }

    try {
      const response = await client.session.abort({
        path: { id: sessionId },
      });

      if (response.error) {
        logger.error("Failed to stop session", {
          error: response.error,
          sessionId,
        });
        await ctx.reply("❌ Failed to stop session", getDefaultKeyboardOptions());
        return;
      }

      const sessionTitle = globalStateStore.getSessionTitle(sessionId) || sessionId;
      await ctx.reply(`🛑 Session stopped: ${sessionTitle}`, getDefaultKeyboardOptions());

      logger.debug("Stopped session", { sessionId });
    } catch (error) {
      logger.error("Failed to stop session", {
        error: String(error),
        sessionId,
      });
      await ctx.reply("❌ Failed to stop session", getDefaultKeyboardOptions());
    }
  };
}
