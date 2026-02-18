# OpenCode Telegram Forum Bridge

Telegram bridge plugin for OpenCode with forum-topic workflow:

- One Telegram topic = one OpenCode session
- `/oc new <workspace>` creates topic + session mapping
- Messages in topic are routed into the mapped OpenCode session
- Assistant replies, questions, status, permission requests, and errors return to the same topic
- Supports Telegram text + photo + document attachments
- Supports live progress message updates while run is in-flight

> Disclaimer: This project is not affiliated with SST/OpenCode.

## Quick Start

```bash
git clone https://github.com/Tommertom/opencoder-telegram-plugin.git
cd opencoder-telegram-plugin/plugin
npm install
npm run build
```

Set environment variables in `.env` (or systemd env file), then add plugin path to OpenCode config:

```json
{
  "plugin": [
    "file:///home/opencode/.config/opencode/local-plugins/opencoder-telegram-plugin/plugin/dist/telegram-remote.js"
  ]
}
```

Minimal `.env`:

```bash
TELEGRAM_BOT_TOKEN=
TELEGRAM_ALLOWED_USER_IDS=123456789
TELEGRAM_FORUM_CHAT_ID=-1001234567890
TELEGRAM_ALLOWED_CHAT_IDS=-1001234567890
TELEGRAM_ALLOWED_WORKSPACE_ROOTS=/home/opencode/Projects/EdgeRolls,/home/opencode/Projects/BoosterVpn,/home/opencode/Projects/TGtoMax
TELEGRAM_OPENCODE_MODEL=openai/gpt-5.3-codex
TELEGRAM_OPENCODE_BASE_URL=http://127.0.0.1:4097
TELEGRAM_MAX_ATTACHMENT_BYTES=6291456
TELEGRAM_BRIDGE_STATE_PATH=/home/opencode/.config/opencode/local-plugins/opencoder-telegram-plugin/state/topic-session-map.json
```

Then in Telegram forum chat:

1. `/oc new /absolute/workspace/path`
2. Send prompt in that topic
3. Use `/oc status` to check session/runtime state

## Full Guides

- Developer setup, deployment, operations, troubleshooting (RU):
  - [`/Users/guard2/Projects/opencoder-telegram-plugin/docs/INSTALL_AND_USAGE_RU.md`](/Users/guard2/Projects/opencoder-telegram-plugin/docs/INSTALL_AND_USAGE_RU.md)
- 1:1 server bootstrap guide for AI agents (RU):
  - [`/Users/guard2/Projects/opencoder-telegram-plugin/docs/AGENT_1TO1_SERVER_SETUP_RU.md`](/Users/guard2/Projects/opencoder-telegram-plugin/docs/AGENT_1TO1_SERVER_SETUP_RU.md)
- Copy-paste autopilot prompt for agent (RU):
  - [`/Users/guard2/Projects/opencoder-telegram-plugin/docs/AGENT_AUTODEPLOY_PROMPT_RU.md`](/Users/guard2/Projects/opencoder-telegram-plugin/docs/AGENT_AUTODEPLOY_PROMPT_RU.md)
- AI agent engineering/incident runbook:
  - [`/Users/guard2/Projects/opencoder-telegram-plugin/AGENTS.md`](/Users/guard2/Projects/opencoder-telegram-plugin/AGENTS.md)

## Telegram Commands

- `/oc new <absolute_workspace_path>`
- `/oc import list`
- `/oc import <session_id>`
- `/oc sessions`
- `/oc status`
- `/oc set <model|effort|summary|verbosity> <value>`
- `/oc perm <permission_id> <once|always|reject>`
- `/oc rename <title>`
- `/oc undo`
- `/oc redo`
- `/oc stop`
- `/oc close`

## Project Structure

```text
plugin/src/
  telegram-remote.ts        # plugin entry
  bot.ts                    # Telegram API adapter
  config.ts                 # env parsing
  bridge/
    controller.ts           # command handling + routing + session orchestration
    store.ts                # topic/session persistent state
    types.ts                # bridge types
    utils.ts                # helpers
  events/                   # legacy event handlers (private-chat fallback)
```

## Build

```bash
cd plugin
npm run build
```

## License

MIT
