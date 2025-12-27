import type { Session } from "@opencode-ai/sdk";
import type { Logger } from "../../../lib/logger";
import type { OpencodeClient } from "../../../lib/types";

export async function getSessionInfo(
  client: OpencodeClient,
  logger: Logger,
  sessionId: string,
): Promise<Session | null> {
  try {
    const response = await client.session.get({
      path: { id: sessionId },
    });

    if (response.error) {
      logger.error(`Error getting session: ${JSON.stringify(response.error)}`);
      return null;
    }

    logger.debug("Session details", { session: response.data });

    return response.data;
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    const errorStack = error instanceof Error ? error.stack : "";

    logger.error(`Error getting session info: ${errorMessage}`, { stack: errorStack });

    return null;
  }
}
