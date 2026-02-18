# Готовый Промпт Для Агента (Развернуть На СВОЕМ Сервере)

Скопируй текст ниже целиком и отдай агенту.

```text
Ты senior DevOps/Infra агент. Твоя задача: полностью и автоматически развернуть OpenCode Web + multi-auth codex + telegram bridge на МОЕМ сервере.

Не используй чужие прод-серверы как source. Работай только с моим сервером и публичными репозиториями.

## Входные данные
- TARGET_HOST: <МОЙ_СЕРВЕР_IP_ИЛИ_ДОМЕН>
- TARGET_USER: root
- SSH_KEY: <ПУТЬ_К_SSH_КЛЮЧУ_ЕСЛИ_НУЖНО>
- TELEGRAM_BOT_TOKEN: <TOKEN>
- TELEGRAM_ALLOWED_USER_IDS: <id1,id2>
- TELEGRAM_FORUM_CHAT_ID: <forum_chat_id>
- TELEGRAM_ALLOWED_CHAT_IDS: <chat_id1,chat_id2>
- TELEGRAM_CHAT_ID: <опционально_private_chat_id>
- OPENCODE_SERVER_USERNAME: opencode
- OPENCODE_SERVER_PASSWORD: <NEW_STRONG_PASSWORD>
- NTFY_URL: <опционально_ntfy_topic_url>

## Что должно получиться
1) OpenCode backend под systemd на `127.0.0.1:4097`.
2) OpenCode Web через nginx на `:4096`.
3) Basic auth на nginx.
4) Плагины OpenCode:
   - `opencode-antigravity-auth`
   - `opencode-multi-auth-codex` (wrapper)
   - `opencoder-telegram-plugin`
5) Telegram bridge рабочий:
   - topic <-> session mapping
   - live status (edit сообщений)
   - final reply в topic
   - permissions with buttons + `/oc perm ...`
6) Включены:
   - `opencode.service`
   - `opencode-autofix.service`
   - `opencode-notify.service` (если NTFY_URL передан)

## Репозитории и источники
Используй:
1) Telegram plugin:
   - `https://github.com/guard22/opencoder-telegram-plugin`
2) npm пакеты для multi-auth:
   - `@guard22/opencode-multi-auth-codex`
   - `opencode-openai-codex-auth`
   - `@opencode-ai/plugin`
   - `oh-my-opencode`

## Правила выполнения
- Делай всё idempotent.
- Перед изменением конфигов делай backup: `*.bak-<timestamp>`.
- Секреты не печатай в явном виде в отчёте.
- После каждого большого шага делай проверку и не переходи дальше, пока не green.

## Шаг 1. Подготовка сервера
На TARGET_HOST:
1) Установи пакеты:
   - `nginx apache2-utils git curl jq rsync unzip nodejs npm`
2) Создай пользователя:
   - `opencode` (если отсутствует)
3) Создай директории:
   - `/home/opencode/.config/opencode`
   - `/home/opencode/.config/opencode/local-plugins`
   - `/home/opencode/.local/bin`
   - `/home/opencode/.opencode/bin`
   - `/srv/opencode/overrides/assets`
4) `chown -R opencode:opencode /home/opencode`

## Шаг 2. Установка OpenCode
1) Установи OpenCode в `/home/opencode/.opencode/bin/opencode`.
2) Проверь:
   - `/home/opencode/.opencode/bin/opencode --version`
3) Зафиксируй выбранную версию в отчете.

## Шаг 3. Установка зависимостей OpenCode plugins
Создай `/home/opencode/.config/opencode/package.json`:

```json
{
  "dependencies": {
    "@a3fckx/opencode-multi-auth": "^1.0.4",
    "@guard22/opencode-multi-auth-codex": "github:guard22/opencode-multi-auth-codex#codex/opencode-1.1.53-fixes",
    "@opencode-ai/plugin": "1.1.53",
    "oh-my-opencode": "3.1.6",
    "opencode-multi-auth-codex": "file:./local-plugins/opencode-multi-auth-codex",
    "opencode-oh-my-opencode": "file:./local-plugins/opencode-oh-my-opencode",
    "opencode-openai-codex-auth": "code-yeongyu/opencode-openai-codex-auth#fix/orphaned-function-call-output-with-tools"
  }
}
```

Потом:
- `cd /home/opencode/.config/opencode && sudo -u opencode npm install`

## Шаг 4. Wrapper плагины
Создай:
1) `/home/opencode/.config/opencode/local-plugins/opencode-multi-auth-codex/package.json`
2) `/home/opencode/.config/opencode/local-plugins/opencode-multi-auth-codex/index.js`

`index.js`:
```js
import multiAuthModule from '@guard22/opencode-multi-auth-codex';
const toPlugin = (mod) => (typeof mod === 'function' ? mod : mod?.default ?? mod);
const multiAuth = toPlugin(multiAuthModule);
const MultiAuthOnlyPlugin = async (input) => {
  if (multiAuth) return await multiAuth(input);
  return {};
};
export default MultiAuthOnlyPlugin;
```

И аналогично:
`/home/opencode/.config/opencode/local-plugins/opencode-oh-my-opencode/index.js`
```js
import base from 'oh-my-opencode';
const plugin = typeof base === 'function' ? base : (base?.default ?? base);
let wrapped = plugin;
if (typeof plugin === 'function') {
  wrapped = (...args) => plugin(...args);
  Object.assign(wrapped, plugin);
  wrapped.name = 'opencode-oh-my-opencode';
}
export default wrapped;
```

## Шаг 5. Установка Telegram plugin
1) `cd /home/opencode/.config/opencode/local-plugins`
2) Клонируй repo:
   - `git clone https://github.com/Tommertom/opencoder-telegram-plugin.git`
   - если недоступен: `git clone https://github.com/guard22/opencoder-telegram-plugin.git`
3) Сборка:
   - `cd opencoder-telegram-plugin`
   - `sudo -u opencode npm install`
   - `sudo -u opencode npm run build`
4) Создай state dir:
   - `/home/opencode/.config/opencode/local-plugins/opencoder-telegram-plugin/state`
5) `chown -R opencode:opencode /home/opencode/.config/opencode/local-plugins`

## Шаг 6. opencode.jsonc
Создай `/home/opencode/.config/opencode/opencode.jsonc`:

```json
{
  "model": "openai/gpt-5.3-codex",
  "plugin": [
    "opencode-antigravity-auth@1.4.6",
    "file:///home/opencode/.config/opencode/node_modules/opencode-multi-auth-codex/index.js",
    "file:///home/opencode/.config/opencode/local-plugins/opencoder-telegram-plugin/plugin/dist/telegram-remote.js"
  ],
  "provider": {
    "openai": {
      "options": {
        "reasoningEffort": "medium",
        "reasoningSummary": "auto",
        "textVerbosity": "medium",
        "store": false
      }
    }
  },
  "$schema": "https://opencode.ai/config.json"
}
```

## Шаг 7. systemd
Создай:
1) `/etc/systemd/system/opencode.service`
2) `/etc/systemd/system/opencode.service.d/resources.conf`
3) `/etc/systemd/system/opencode.service.d/telegram-plugin.conf`

`opencode.service` должен запускать:
- `/home/opencode/.opencode/bin/opencode serve --hostname 127.0.0.1 --port 4097`

`telegram-plugin.conf` должен содержать:
- `TELEGRAM_BOT_TOKEN`
- `TELEGRAM_ALLOWED_USER_IDS`
- `TELEGRAM_ALLOWED_CHAT_IDS`
- `TELEGRAM_FORUM_CHAT_ID`
- `TELEGRAM_CHAT_ID` (если есть)
- `TELEGRAM_ALLOWED_WORKSPACE_ROOTS`
- `TELEGRAM_OPENCODE_MODEL=openai/gpt-5.3-codex`
- `TELEGRAM_OPENCODE_BASE_URL=http://127.0.0.1:4097`
- `TELEGRAM_OPENCODE_USERNAME=opencode`
- `TELEGRAM_OPENCODE_PASSWORD=<same as OPENCODE_SERVER_PASSWORD>`
- `TELEGRAM_BRIDGE_STATE_PATH=/home/opencode/.config/opencode/local-plugins/opencoder-telegram-plugin/state/topic-session-map.json`

## Шаг 8. nginx
1) Создай basic auth:
   - `htpasswd -bc /etc/nginx/opencode.htpasswd opencode '<OPENCODE_SERVER_PASSWORD>'`
2) Создай `/etc/nginx/conf.d/opencode.conf`:
   - listen `4096`
   - proxy to `127.0.0.1:4097`
   - отдельные `location = /event` и `location = /global/event` с `proxy_buffering off`
   - `proxy_set_header Authorization Basic <base64(opencode:password)>`
3) Добавь `/srv/opencode/overrides/oc-randomuuid-polyfill.js` (минимальный полифилл `crypto.randomUUID` + clipboard fallback).

## Шаг 9. autofix и notify
1) Положи скрипты в `/home/opencode/.local/bin`:
   - `opencode-session-sanitize.js`
   - `opencode-autofix.js`
   - `opencode-ntfy-notify.js`
2) Создай юниты:
   - `opencode-autofix.service`
   - `opencode-notify.service`
3) Если `NTFY_URL` не задан, `opencode-notify.service` не включай.

## Шаг 10. Запуск
```bash
systemctl daemon-reload
systemctl enable --now opencode.service
systemctl enable --now opencode-autofix.service
if [ -n "$NTFY_URL" ]; then systemctl enable --now opencode-notify.service; fi
nginx -t
systemctl reload nginx
```

## Шаг 11. Проверки
Обязательно:
1) `systemctl status opencode.service --no-pager`
2) `ss -ltnp | grep -E ':4096|:4097'`
3) `curl -I http://127.0.0.1:4097`
4) `curl -I http://<TARGET_HOST>:4096`
5) `journalctl -u opencode.service -n 200 --no-pager`
6) Telegram smoke:
   - `/oc new <workspace>`
   - prompt в topic
   - убедиться в live status и final reply
   - `/oc status`
   - проверка permission кнопок

Если тесты не прошли — сам исправляй до green.

## Шаг 12. Финальный отчет
Верни:
1) Что установлено.
2) Какие файлы созданы/изменены.
3) Статусы сервисов.
4) Результаты curl/ports.
5) Результат Telegram smoke test.
6) Остаточные риски.
Секреты в отчете маскируй.
```
