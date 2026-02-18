# OpenCode Telegram Bridge: Полная Инструкция

Этот документ для разработчиков/админов, которые хотят развернуть и эксплуатировать плагин в проде.

## 1. Что делает плагин

- Привязывает Telegram forum topic к OpenCode session (`1 topic = 1 session`).
- Принимает сообщения из Telegram, отправляет их в OpenCode.
- Возвращает в тот же topic:
  - финальный ответ ассистента,
  - live-статус выполнения,
  - вопросы и ошибки,
  - запросы permissions (с кнопками `Deny`, `Allow always`, `Allow once`).
- Поддерживает вложения:
  - фото,
  - документы.
- Поддерживает импорт уже существующих сессий OpenCode в topic.

## 2. Требования

- Linux/macOS хост с Node.js `18+`.
- Работающий OpenCode server/CLI.
- Telegram-бот от `@BotFather`.
- Telegram supergroup с включёнными `Topics`.
- Бот должен быть admin в группе.

## 3. Права бота в Telegram

Минимально нужно:

- читать/писать сообщения в группе,
- управлять темами (если хотите создание новых topics через `/oc new`),
- редактировать свои сообщения (для live-статуса),
- отправлять inline keyboard (для permission action).

Если `can_manage_topics` нет, `/oc new` будет использовать текущий topic как fallback.

## 4. Установка

```bash
git clone https://github.com/Tommertom/opencoder-telegram-plugin.git
cd opencoder-telegram-plugin/plugin
npm install
npm run build
```

## 5. Конфиг OpenCode

Добавьте плагин в `opencode.json`/`opencode.jsonc`:

```json
{
  "plugin": [
    "file:///home/opencode/.config/opencode/local-plugins/opencoder-telegram-plugin/plugin/dist/telegram-remote.js"
  ]
}
```

Важно: путь должен указывать на собранный `dist/telegram-remote.js`.

## 6. Переменные окружения

Создайте `.env` (обычно в `plugin/.env`) или передайте через systemd.

Обязательные:

- `TELEGRAM_BOT_TOKEN`
- `TELEGRAM_ALLOWED_USER_IDS` (список Telegram user ID через запятую)

Рекомендуемые:

- `TELEGRAM_FORUM_CHAT_ID` (ID группы/форума)
- `TELEGRAM_ALLOWED_CHAT_IDS` (ограничение по chat IDs)
- `TELEGRAM_ALLOWED_WORKSPACE_ROOTS` (разрешённые корни воркспейсов)
- `TELEGRAM_OPENCODE_MODEL` (по умолчанию `openai/gpt-5.3-codex`)
- `TELEGRAM_OPENCODE_BASE_URL` (по умолчанию `http://127.0.0.1:4097`)
- `TELEGRAM_BRIDGE_STATE_PATH` (json с маппингом topic->session)
- `TELEGRAM_MAX_ATTACHMENT_BYTES` (по умолчанию 6291456)

Опционально (если на OpenCode включён basic auth):

- `TELEGRAM_OPENCODE_USERNAME`
- `TELEGRAM_OPENCODE_PASSWORD`

Оба должны быть либо заполнены, либо оба пустые.

Пример:

```bash
TELEGRAM_BOT_TOKEN=123456:ABC
TELEGRAM_ALLOWED_USER_IDS=111111111,222222222
TELEGRAM_FORUM_CHAT_ID=-1001234567890
TELEGRAM_ALLOWED_CHAT_IDS=-1001234567890
TELEGRAM_ALLOWED_WORKSPACE_ROOTS=/home/opencode/Projects/EdgeRolls,/home/opencode/Projects/BoosterVpn
TELEGRAM_OPENCODE_MODEL=openai/gpt-5.3-codex
TELEGRAM_OPENCODE_BASE_URL=http://127.0.0.1:4097
TELEGRAM_MAX_ATTACHMENT_BYTES=6291456
TELEGRAM_BRIDGE_STATE_PATH=/home/opencode/.config/opencode/local-plugins/opencoder-telegram-plugin/state/topic-session-map.json
```

## 7. Запуск через systemd (рекомендуется)

Пример unit (`/etc/systemd/system/opencode.service`), если у вас OpenCode и плагин в одном процессе:

```ini
[Unit]
Description=OpenCode Server
After=network.target

[Service]
Type=simple
User=opencode
WorkingDirectory=/home/opencode
EnvironmentFile=/home/opencode/.config/opencode/local-plugins/opencoder-telegram-plugin/plugin/.env
ExecStart=/usr/bin/opencode serve --host 0.0.0.0 --port 4096
Restart=always
RestartSec=3

[Install]
WantedBy=multi-user.target
```

Применение:

```bash
sudo systemctl daemon-reload
sudo systemctl restart opencode.service
sudo systemctl status opencode.service --no-pager
```

## 8. Команды в Telegram

- `/oc new <absolute_workspace_path>`: создать новую session + (по возможности) topic.
- `/oc import list`: показать последние сессии для импорта.
- `/oc import <session_id>`: импортировать существующую session в текущий topic.
- `/oc sessions`: алиас списка сессий.
- `/oc status`: текущее состояние topic/session.
- `/oc set model gpt-5.3-codex|gpt-5.2-codex`
- `/oc set effort low|medium|high|xhigh|none`
- `/oc set summary auto|none|detailed`
- `/oc set verbosity low|medium|high`
- `/oc perm <permission_id> <once|always|reject>`
- `/oc rename <title>`
- `/oc undo`
- `/oc redo`
- `/oc stop`
- `/oc close`

## 9. Поведение рантайма

- Очередь на session: пока идёт ран, новые сообщения ставятся в pending.
- Coalescing сообщений:
  - короткие подряд сообщения объединяются в один prompt,
  - media-group объединяется,
  - ответ на предыдущее сообщение также может быть слит в один prompt.
- Live status обновляется через редактирование сообщения с throttling, чтобы не попасть в Telegram flood.
- При permission request в topic прилетает сообщение с inline-кнопками.

## 10. Медиа и форматирование

- Поддерживаются `photo` и `document` как вход для OpenCode.
- Reply context добавляется в prompt (кто/какое сообщение было процитировано).
- Выход OpenCode рендерится в Telegram с поддержкой Markdown-подобного форматирования:
  - bold/italic/strike/code block/links/list/quote.
- При ошибке parse entities есть fallback на plain text.

## 11. Smoke Test после установки

1. В группе создайте/выберите topic.
2. Выполните `/oc new /absolute/workspace/path`.
3. Отправьте короткий текст (`тест`).
4. Убедитесь:
   - появился live-status,
   - пришёл финальный ответ,
   - `/oc status` показывает актуальную модель/effort.
5. Проверьте permission flow:
   - спровоцируйте запрос permission в OpenCode,
   - проверьте, что в topic появились кнопки approve/deny.

## 12. Диагностика, если нет ответа в Telegram

Проверка сервиса:

```bash
sudo systemctl status opencode.service --no-pager
```

Логи за последние 15 минут:

```bash
sudo journalctl -u opencode.service --since "15 minutes ago" --no-pager
```

Ищите ошибки:

- `Too Many Requests` / `retry after` (flood),
- `can't parse entities`,
- ошибки OpenCode API/авторизации,
- ошибки загрузки файла из Telegram.

Проверка state-файла маппинга:

```bash
cat /home/opencode/.config/opencode/local-plugins/opencoder-telegram-plugin/state/topic-session-map.json
```

Проверьте, что `chatId/threadId/sessionId` соответствуют нужному topic.

## 13. Обновление плагина

```bash
cd /home/opencode/.config/opencode/local-plugins/opencoder-telegram-plugin
git pull
cd plugin
npm install
npm run build
sudo systemctl restart opencode.service
```

## 14. Безопасность

- Всегда используйте `TELEGRAM_ALLOWED_USER_IDS`.
- Желательно фиксировать `TELEGRAM_FORUM_CHAT_ID` и `TELEGRAM_ALLOWED_CHAT_IDS`.
- Обязательно ограничивайте `TELEGRAM_ALLOWED_WORKSPACE_ROOTS`.
- Не храните токены в репозитории.
