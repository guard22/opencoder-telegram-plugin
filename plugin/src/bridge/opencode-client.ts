import { createOpencodeClient, type OpencodeClient } from "@opencode-ai/sdk";
import type { Config } from "../config.js";

function buildBasicAuthHeader(username: string, password: string): string {
  const token = Buffer.from(`${username}:${password}`, "utf8").toString("base64");
  return `Basic ${token}`;
}

export class AuthenticatedOpencodeClientFactory {
  private readonly config: Config;
  private readonly authHeader?: string;
  private readonly clients = new Map<string, OpencodeClient>();

  constructor(config: Config) {
    this.config = config;
    if (config.opencodeUsername && config.opencodePassword) {
      this.authHeader = buildBasicAuthHeader(
        config.opencodeUsername,
        config.opencodePassword,
      );
    }
  }

  getForDirectory(directory: string): OpencodeClient {
    const existing = this.clients.get(directory);
    if (existing) {
      return existing;
    }

    const created = createOpencodeClient({
      baseUrl: this.config.opencodeBaseUrl,
      directory,
      headers: this.authHeader
        ? {
          Authorization: this.authHeader,
        }
        : undefined,
    });

    this.clients.set(directory, created);
    return created;
  }
}
