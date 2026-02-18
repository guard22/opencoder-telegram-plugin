# 1-в-1 Развертывание OpenCode + Web + Multi-Auth + Telegram Bridge (для агента)

Этот runbook собран по фактическому состоянию прод-сервера `89.185.85.15` на `2026-02-18`.
Цель: поднять на новом сервере ту же схему работы.

## 0. Текущий прод-снимок (что именно повторяем)

- OpenCode:
  - бинарник: `/home/opencode/.opencode/bin/opencode`
  - версия: `1.1.53`
  - запуск: `opencode serve --hostname 127.0.0.1 --port 4097`
- Web:
  - внешний порт: `4096` (nginx reverse proxy)
  - внутренний OpenCode порт: `127.0.0.1:4097`
  - basic auth включен на nginx
- Systemd юниты:
  - `opencode.service`
  - `opencode-autofix.service`
  - `opencode-notify.service`
- Плагины OpenCode:
  - `opencode-antigravity-auth@1.4.6`
  - `file:///home/opencode/.config/opencode/node_modules/opencode-multi-auth-codex/index.js`
  - `file:///home/opencode/.config/opencode/local-plugins/opencoder-telegram-plugin/plugin/dist/telegram-remote.js`
- Telegram bridge:
  - локальный плагин в `/home/opencode/.config/opencode/local-plugins/opencoder-telegram-plugin`
  - state-файл: `/home/opencode/.config/opencode/local-plugins/opencoder-telegram-plugin/state/topic-session-map.json`

## 1. Требования

- Ubuntu/Debian сервер.
- Доступ root по SSH.
- Домен не обязателен (в проде используется IP + порт 4096).
- Telegram bot token.
- OpenAI/Codex auth для multi-auth (аккаунты в `~/.codex/auth.json`).

## 2. Подготовка ОС

```bash
apt update
apt install -y nginx apache2-utils git curl jq rsync unzip
curl -fsSL https://deb.nodesource.com/setup_18.x | bash -
apt install -y nodejs
```

Проверка:

```bash
node -v
npm -v
```

## 3. Пользователь и директории

```bash
id opencode >/dev/null 2>&1 || useradd -m -s /bin/bash opencode
mkdir -p /home/opencode/.config/opencode
mkdir -p /home/opencode/.config/opencode/local-plugins
mkdir -p /home/opencode/.local/bin
mkdir -p /srv/opencode/overrides/assets
chown -R opencode:opencode /home/opencode
```

## 4. OpenCode бинарник (точно как в проде)

### Вариант A (строго 1-в-1, рекомендуется)

Скопировать бинарник с текущего прода:

```bash
sudo -u opencode mkdir -p /home/opencode/.opencode/bin
rsync -avz root@89.185.85.15:/home/opencode/.opencode/bin/opencode /home/opencode/.opencode/bin/opencode
chmod +x /home/opencode/.opencode/bin/opencode
chown -R opencode:opencode /home/opencode/.opencode
```

### Вариант B (если нет доступа к старому хосту)

Установить OpenCode официальным способом и убедиться, что версия совпадает с продом (`1.1.53`), либо зафиксировать согласованную версию.

Проверка:

```bash
/home/opencode/.opencode/bin/opencode --version
```

## 5. Установка Multi-Auth обвязки (как в проде)

### 5.1 wrapper `opencode-multi-auth-codex`

```bash
mkdir -p /home/opencode/.config/opencode/local-plugins/opencode-multi-auth-codex
cat > /home/opencode/.config/opencode/local-plugins/opencode-multi-auth-codex/package.json <<'JSON'
{
  "name": "opencode-multi-auth-codex",
  "version": "1.0.0",
  "type": "module",
  "main": "index.js"
}
JSON

cat > /home/opencode/.config/opencode/local-plugins/opencode-multi-auth-codex/index.js <<'JS'
import multiAuthModule from '@guard22/opencode-multi-auth-codex';
const toPlugin = (mod) => (typeof mod === 'function' ? mod : mod?.default ?? mod);
const multiAuth = toPlugin(multiAuthModule);
const MultiAuthOnlyPlugin = async (input) => {
  if (multiAuth) return await multiAuth(input);
  return {};
};
export default MultiAuthOnlyPlugin;
JS
```

### 5.2 wrapper `opencode-oh-my-opencode` (в проде установлен)

```bash
mkdir -p /home/opencode/.config/opencode/local-plugins/opencode-oh-my-opencode
cat > /home/opencode/.config/opencode/local-plugins/opencode-oh-my-opencode/package.json <<'JSON'
{
  "name": "opencode-oh-my-opencode",
  "version": "1.0.0",
  "type": "module",
  "main": "index.js"
}
JSON

cat > /home/opencode/.config/opencode/local-plugins/opencode-oh-my-opencode/index.js <<'JS'
import base from 'oh-my-opencode';
const plugin = typeof base === 'function' ? base : (base?.default ?? base);
let wrapped = plugin;
if (typeof plugin === 'function') {
  wrapped = (...args) => plugin(...args);
  Object.assign(wrapped, plugin);
  wrapped.name = 'opencode-oh-my-opencode';
} else if (plugin && typeof plugin === 'object') {
  try { wrapped.name = 'opencode-oh-my-opencode'; } catch {}
}
export default wrapped;
JS
```

### 5.3 package.json для `/home/opencode/.config/opencode`

```bash
cat > /home/opencode/.config/opencode/package.json <<'JSON'
{
  "dependencies": {
    "@a3fckx/opencode-multi-auth": "^1.0.4",
    "@guard22/opencode-multi-auth-codex": "github:guard22/opencode-multi-auth-codex#codex/opencode-1.1.53-fixes",
    "@opencode-ai/plugin": "1.1.53",
    "oh-my-opencode": "3.1.6",
    "opencode-multi-auth-codex": "file:./local-plugins/opencode-multi-auth-codex",
    "opencode-oh-my-opencode": "file:./local-plugins/opencode-oh-my-opencode",
    "opencode-openai-codex-auth": "code-yeongyu/opencode-openai-codex-auth#fix/orphaned-function-call-output-with-tools"
  },
  "trustedDependencies": [
    "@ast-grep/cli",
    "@code-yeongyu/comment-checker",
    "oh-my-opencode"
  ]
}
JSON

cd /home/opencode/.config/opencode
sudo -u opencode npm install
```

## 6. Установка Telegram bridge плагина

До мержа PR можно брать форк с нужными коммитами.

```bash
cd /home/opencode/.config/opencode/local-plugins
sudo -u opencode git clone https://github.com/guard22/opencoder-telegram-plugin.git
cd /home/opencode/.config/opencode/local-plugins/opencoder-telegram-plugin
sudo -u opencode git checkout 7dc9116
sudo -u opencode npm install
sudo -u opencode npm run build
mkdir -p /home/opencode/.config/opencode/local-plugins/opencoder-telegram-plugin/state
chown -R opencode:opencode /home/opencode/.config/opencode/local-plugins/opencoder-telegram-plugin
```

## 7. OpenCode config (`opencode.jsonc`)

Создать файл `/home/opencode/.config/opencode/opencode.jsonc`:

```json
{
  "model": "openai/gpt-5.3-codex",
  "plugin": [
    "opencode-antigravity-auth@1.4.6",
    "file:///home/opencode/.config/opencode/node_modules/opencode-multi-auth-codex/index.js",
    "file:///home/opencode/.config/opencode/local-plugins/opencoder-telegram-plugin/plugin/dist/telegram-remote.js"
  ],
  "permission": {
    "delegate_task": "allow",
    "task": { "*": "allow" },
    "skill": {
      "git-master": "allow",
      "*": "allow"
    },
    "external_directory": {
      "/home/opencode/Projects/EdgeRolls": "allow",
      "/home/opencode/Projects/EdgeRolls/*": "allow",
      "/home/opencode/Projects/BoosterVpn": "allow",
      "/home/opencode/Projects/BoosterVpn/*": "allow",
      "/home/opencode/Projects/TGtoMax": "allow",
      "/home/opencode/Projects/TGtoMax/*": "allow"
    }
  },
  "compaction": {
    "auto": true,
    "prune": true
  },
  "provider": {
    "openai": {
      "options": {
        "reasoningEffort": "medium",
        "reasoningSummary": "auto",
        "textVerbosity": "medium",
        "store": false
      },
      "models": {
        "gpt-5.3-codex": {
          "id": "gpt-5.3-codex",
          "limit": { "context": 260000, "output": 8192 }
        }
      }
    }
  },
  "$schema": "https://opencode.ai/config.json"
}
```

`chown -R opencode:opencode /home/opencode/.config/opencode`

## 8. systemd: `opencode.service`

`/etc/systemd/system/opencode.service`:

```ini
[Unit]
Description=OpenCode Server
After=network-online.target
Wants=network-online.target

[Service]
User=opencode
Group=opencode
WorkingDirectory=/srv/opencode
Environment=HOME=/home/opencode
Environment=OPENCODE_SERVER_USERNAME=opencode
Environment=OPENCODE_SERVER_PASSWORD=<SET_STRONG_PASSWORD>
Environment=PATH=/home/opencode/.opencode/bin:/home/opencode/.local/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
Environment=OPENCODE_MULTI_AUTH_NOTIFY=0
Environment=OPENCODE_MULTI_AUTH_NOTIFY_UI_BASE_URL=http://<SERVER_IP>:4096
ExecStart=/home/opencode/.opencode/bin/opencode serve --hostname 127.0.0.1 --port 4097
Restart=always
RestartSec=2
CPUQuota=250%
MemoryMax=4G
MemorySwapMax=5G
TasksMax=4096
Nice=10
IOSchedulingClass=best-effort
IOWeight=100
NoNewPrivileges=false
PrivateTmp=true
LimitNOFILE=65535

[Install]
WantedBy=multi-user.target
```

Drop-in `/etc/systemd/system/opencode.service.d/resources.conf`:

```ini
[Service]
MemoryHigh=8G
MemoryMax=8G
MemorySwapMax=0
RuntimeMaxSec=infinity
Restart=always
RestartSec=3s
TimeoutStopSec=25s
OOMPolicy=continue
Environment=NODE_OPTIONS=--max-old-space-size=512
```

Drop-in `/etc/systemd/system/opencode.service.d/telegram-plugin.conf`:

```ini
[Service]
Environment=TELEGRAM_BOT_TOKEN=<BOT_TOKEN>
Environment=TELEGRAM_ALLOWED_USER_IDS=<USER_ID_1,USER_ID_2>
Environment=TELEGRAM_ALLOWED_CHAT_IDS=<FORUM_CHAT_ID>
Environment=TELEGRAM_FORUM_CHAT_ID=<FORUM_CHAT_ID>
Environment=TELEGRAM_CHAT_ID=<PRIVATE_CHAT_ID_OPTIONAL>
Environment=TELEGRAM_ALLOWED_WORKSPACE_ROOTS=/home/opencode/Projects/EdgeRolls,/home/opencode/Projects/BoosterVpn,/home/opencode/Projects/TGtoMax
Environment=TELEGRAM_OPENCODE_MODEL=openai/gpt-5.3-codex
Environment=TELEGRAM_OPENCODE_BASE_URL=http://127.0.0.1:4097
Environment=TELEGRAM_OPENCODE_USERNAME=opencode
Environment=TELEGRAM_OPENCODE_PASSWORD=<SET_STRONG_PASSWORD>
Environment=TELEGRAM_MAX_ATTACHMENT_BYTES=6291456
Environment=TELEGRAM_BRIDGE_STATE_PATH=/home/opencode/.config/opencode/local-plugins/opencoder-telegram-plugin/state/topic-session-map.json
```

## 9. nginx на порт 4096

Создать basic auth:

```bash
htpasswd -bc /etc/nginx/opencode.htpasswd opencode '<SET_STRONG_PASSWORD>'
```

Подготовить base64 для upstream auth:

```bash
UPSTREAM_AUTH="$(printf 'opencode:%s' '<SET_STRONG_PASSWORD>' | base64 -w0)"
echo "$UPSTREAM_AUTH"
```

`/etc/nginx/conf.d/opencode.conf`:

```nginx
server {
  listen 0.0.0.0:4096 default_server;
  listen [::]:4096 default_server;
  server_name _;

  client_max_body_size 50m;

  auth_basic "OpenCode";
  auth_basic_user_file /etc/nginx/opencode.htpasswd;
  set $opencode_upstream_auth "Basic <PASTE_BASE64_FROM_COMMAND>";

  location = /oc-randomuuid-polyfill.js {
    alias /srv/opencode/overrides/oc-randomuuid-polyfill.js;
    default_type application/javascript;
    add_header Cache-Control "no-store" always;
  }

  location = /global/event {
    proxy_pass http://127.0.0.1:4097;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-For $remote_addr;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_set_header Authorization $opencode_upstream_auth;
    proxy_buffering off;
    proxy_read_timeout 3600s;
  }

  location = /event {
    proxy_pass http://127.0.0.1:4097;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-For $remote_addr;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_set_header Authorization $opencode_upstream_auth;
    proxy_buffering off;
    proxy_read_timeout 3600s;
  }

  location / {
    proxy_pass http://127.0.0.1:4097;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-For $remote_addr;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_set_header Authorization $opencode_upstream_auth;

    sub_filter_once on;
    sub_filter '</head>' '<script src="/oc-randomuuid-polyfill.js"></script></head>';

    proxy_hide_header Content-Security-Policy;
    add_header Content-Security-Policy "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; font-src 'self' data:; media-src 'self' data:; connect-src 'self' data: https://opencode.ai; manifest-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'self'" always;

    proxy_read_timeout 3600s;
  }
}
```

Поллифилл файл `/srv/opencode/overrides/oc-randomuuid-polyfill.js` можно скопировать 1-в-1:

```bash
rsync -avz root@89.185.85.15:/srv/opencode/overrides/oc-randomuuid-polyfill.js /srv/opencode/overrides/oc-randomuuid-polyfill.js
```

## 10. Доп. сервисы (как в проде)

### 10.1 Скрипты

Скопировать с прода:

```bash
rsync -avz root@89.185.85.15:/home/opencode/.local/bin/opencode-session-sanitize.js /home/opencode/.local/bin/
rsync -avz root@89.185.85.15:/home/opencode/.local/bin/opencode-autofix.js /home/opencode/.local/bin/
rsync -avz root@89.185.85.15:/home/opencode/.local/bin/opencode-ntfy-notify.js /home/opencode/.local/bin/
chmod +x /home/opencode/.local/bin/opencode-*.js
chown -R opencode:opencode /home/opencode/.local/bin
```

### 10.2 Юниты

`/etc/systemd/system/opencode-autofix.service`:

```ini
[Unit]
Description=OpenCode autofix (sanitize sessions that hit context_length_exceeded)
After=network-online.target opencode.service
Wants=network-online.target

[Service]
User=opencode
Group=opencode
Environment=HOME=/home/opencode
Environment=OPENCODE_AUTOFIX_ENABLED=1
Environment=OPENCODE_AUTOFIX_MIN_INTERVAL_MS=300000
Environment=OPENCODE_SANITIZE_TOOL_OUTPUT_CHARS=8000
Environment=OPENCODE_SANITIZE_TOOL_INPUT_CHARS=4000
Environment=OPENCODE_SANITIZE_DROP_REASONING=1
ExecStart=/usr/bin/node /home/opencode/.local/bin/opencode-autofix.js
Restart=always
RestartSec=2
NoNewPrivileges=true
PrivateTmp=true

[Install]
WantedBy=multi-user.target
```

`/etc/systemd/system/opencode-notify.service`:

```ini
[Unit]
Description=OpenCode ntfy notifier (push session done/error to phone)
After=network-online.target opencode.service
Wants=network-online.target

[Service]
User=opencode
Group=opencode
Environment=HOME=/home/opencode
Environment=OPENCODE_NOTIFY_NTFY_URL=<NTFY_TOPIC_URL>
Environment=OPENCODE_NOTIFY_UI_BASE_URL=http://<SERVER_IP>:4096
Environment=OPENCODE_NOTIFY_MIN_BUSY_MS=0
Environment=OPENCODE_NOTIFY_SESSION_COOLDOWN_MS=0
Environment=OPENCODE_NOTIFY_POLL_INTERVAL_MS=3000
ExecStart=/usr/bin/node /home/opencode/.local/bin/opencode-ntfy-notify.js
Restart=always
RestartSec=2
NoNewPrivileges=true
PrivateTmp=true

[Install]
WantedBy=multi-user.target
```

## 11. Старт сервисов

```bash
systemctl daemon-reload
systemctl enable --now opencode.service
systemctl enable --now opencode-autofix.service
systemctl enable --now opencode-notify.service
nginx -t && systemctl reload nginx
```

## 12. Проверка

```bash
systemctl status opencode.service --no-pager
systemctl status opencode-autofix.service --no-pager
systemctl status opencode-notify.service --no-pager
ss -ltnp | grep -E ':4096|:4097'
curl -I http://127.0.0.1:4097
```

Проверка через web:

- открыть `http://<SERVER_IP>:4096`
- ввести basic auth
- убедиться, что OpenCode UI доступен

Проверка Telegram bridge:

1. В Telegram forum выполнить `/oc new /home/opencode/Projects/EdgeRolls`.
2. Отправить тестовое сообщение.
3. Проверить live progress и финальный ответ в topic.
4. Проверить `/oc status`.

## 13. Что критично для совпадения 1-в-1

- Тот же OpenCode binary (`1.1.53`) или согласованная версия на обоих серверах.
- Та же цепочка plugins в `opencode.jsonc`.
- Тот же nginx proxy pattern (`4096 -> 4097`) + upstream auth header.
- Тот же Telegram bridge build.
- Тот же набор env для `opencode.service` и drop-ins.

## 14. Важно по безопасности

- Не копируй секреты из текущего прода в открытые репозитории.
- Для нового сервера сгенерируй свои:
  - `OPENCODE_SERVER_PASSWORD`
  - `TELEGRAM_BOT_TOKEN`
  - `ntfy` URL/token (если используете notify).
