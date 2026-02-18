# AI Agent Guide: opencoder-telegram-plugin

This file is for AI/coding agents working in this repository.

## Goal

Maintain a Telegram forum bridge for OpenCode with stable session mapping, prompt routing, progress updates, and permission controls.

## Core Runtime Flow

1. `plugin/src/telegram-remote.ts`
   - Loads env config.
   - Creates Telegram bot adapter.
   - Creates `TelegramForumBridge`.
   - Forwards OpenCode events into bridge.
2. `plugin/src/bot.ts`
   - Telegram API integration via `grammy`.
   - Inbound message extraction (`text`, `caption`, `reply`, `photo`, `document`, callbacks).
   - Outbound send/edit/download/topic ops.
3. `plugin/src/bridge/controller.ts`
   - Command handling (`/oc ...`).
   - Topic <-> session mapping and persistence.
   - Queueing/coalescing prompts.
   - Dispatch to OpenCode SDK/API.
   - Live progress + result/error delivery.
   - Permission request messages and callback handling.

## Files You Must Understand Before Editing Logic

- `/Users/guard2/Projects/opencoder-telegram-plugin/plugin/src/bridge/controller.ts`
- `/Users/guard2/Projects/opencoder-telegram-plugin/plugin/src/bot.ts`
- `/Users/guard2/Projects/opencoder-telegram-plugin/plugin/src/config.ts`
- `/Users/guard2/Projects/opencoder-telegram-plugin/plugin/src/bridge/types.ts`
- `/Users/guard2/Projects/opencoder-telegram-plugin/plugin/src/bridge/store.ts`

## Required Behavior Contracts

- One Telegram topic should map to one OpenCode session binding.
- User messages in mapped topic must eventually reach session prompt dispatch.
- Final assistant output must be sent back to the same topic.
- While run is active:
  - queue additional prompts,
  - show live status updates via message edit with throttling.
- Permission events must be actionable in Telegram:
  - inline buttons (deny/always/once),
  - and command fallback (`/oc perm`).
- Telegram flood limits must be respected (retry/backoff on edit/send).

## Common Failure Modes to Check First

- Missing/invalid env (`TELEGRAM_BOT_TOKEN`, allowed user IDs, auth mismatch).
- Wrong forum/chat ID filtering.
- State map mismatch (`topic-session-map.json`).
- Telegram parse entities errors on formatted output.
- Flood/rate limit from too frequent edits.
- OpenCode API auth/base URL mismatch.

## Development Commands

From repository root:

```bash
npm run build
npm run typecheck
```

Lint exists but currently not clean across the full repo:

```bash
npm run lint
```

## Build Artifacts

Build writes to:

- `/Users/guard2/Projects/opencoder-telegram-plugin/plugin/dist/telegram-remote.js`
- `/Users/guard2/Projects/opencoder-telegram-plugin/.opencode/plugin/telegram-remote.js`

If runtime uses local plugin path, ensure build step is executed after source edits.

## Incident Triage Commands (server)

```bash
sudo systemctl status opencode.service --no-pager
sudo journalctl -u opencode.service --since "30 minutes ago" --no-pager
```

State map:

```bash
cat /home/opencode/.config/opencode/local-plugins/opencoder-telegram-plugin/state/topic-session-map.json
```

## Safe Change Checklist

Before merge/push:

1. Build passes.
2. Manual smoke test in Telegram:
   - `/oc status`
   - normal text prompt
   - media prompt (photo/doc)
   - permission prompt handling
3. Verify no regression in topic mapping and session queue.
4. Confirm final answer delivery still works after live-progress edits.
