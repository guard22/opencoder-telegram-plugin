/**
 * OpenCoder Telegram Remote Plugin
 * https://github.com/YOUR_USERNAME/opencoder-telegram-remote-plugin
 */

// src/bot.ts
import { Bot } from "grammy";
var botInstance = null;
var activePrivateChatId = null;
function isUserAllowed(ctx, allowedUserIds) {
  const userId = ctx.from?.id;
  if (!userId) {
    return false;
  }
  return allowedUserIds.includes(userId);
}
function isChatAllowed(ctx, config) {
  const chatId = ctx.chat?.id;
  if (!chatId) {
    return false;
  }
  if (typeof config.forumChatId === "number" && chatId !== config.forumChatId) {
    return false;
  }
  if (config.allowedChatIds.length > 0 && !config.allowedChatIds.includes(chatId)) {
    return false;
  }
  return true;
}
function formatTelegramUserName(user) {
  if (!user || typeof user !== "object") {
    return void 0;
  }
  const first = typeof user.first_name === "string" ? user.first_name.trim() : "";
  const last = typeof user.last_name === "string" ? user.last_name.trim() : "";
  const full = [first, last].filter(Boolean).join(" ").trim();
  if (full) {
    return full;
  }
  const username = typeof user.username === "string" ? user.username.trim() : "";
  if (username) {
    return `@${username}`;
  }
  return void 0;
}
function extractReplyContext(replyMessage) {
  if (!replyMessage || typeof replyMessage.message_id !== "number") {
    return void 0;
  }
  const photos = Array.isArray(replyMessage.photo) ? replyMessage.photo : [];
  const hasPhoto = photos.length > 0;
  const documentName = typeof replyMessage.document?.file_name === "string" ? replyMessage.document.file_name : void 0;
  const documentMime = typeof replyMessage.document?.mime_type === "string" ? replyMessage.document.mime_type : void 0;
  return {
    messageId: Number(replyMessage.message_id),
    fromName: formatTelegramUserName(replyMessage.from),
    text: typeof replyMessage.text === "string" ? replyMessage.text : void 0,
    caption: typeof replyMessage.caption === "string" ? replyMessage.caption : void 0,
    hasPhoto,
    documentName,
    documentMime
  };
}
function buildInboundMessage(ctx) {
  const message = ctx.message ?? void 0;
  if (!message || !ctx.chat || !ctx.from) {
    return void 0;
  }
  const photos = Array.isArray(message.photo) ? message.photo : [];
  const bestPhoto = photos.length > 0 ? photos[photos.length - 1] : void 0;
  const document = message.document ? {
    fileId: String(message.document.file_id),
    filename: typeof message.document.file_name === "string" ? message.document.file_name : void 0,
    mime: typeof message.document.mime_type === "string" ? message.document.mime_type : void 0
  } : void 0;
  return {
    chatId: ctx.chat.id,
    chatType: String(ctx.chat.type),
    threadId: typeof message.message_thread_id === "number" ? message.message_thread_id : void 0,
    messageId: Number(message.message_id),
    userId: ctx.from.id,
    mediaGroupId: typeof message.media_group_id === "string" ? message.media_group_id : void 0,
    text: typeof message.text === "string" ? message.text : void 0,
    caption: typeof message.caption === "string" ? message.caption : void 0,
    photoFileId: bestPhoto?.file_id ? String(bestPhoto.file_id) : void 0,
    document,
    replyContext: extractReplyContext(message.reply_to_message)
  };
}
function createTelegramBot(config, onMessage) {
  if (botInstance) {
    return createBotManager(botInstance, config);
  }
  const bot = new Bot(config.botToken);
  botInstance = bot;
  bot.use(async (ctx, next) => {
    if (!isUserAllowed(ctx, config.allowedUserIds)) {
      return;
    }
    if (!isChatAllowed(ctx, config)) {
      return;
    }
    if (ctx.chat?.type === "private" && typeof ctx.chat.id === "number") {
      activePrivateChatId = ctx.chat.id;
    }
    const inbound = buildInboundMessage(ctx);
    if (inbound) {
      try {
        await onMessage(inbound);
      } catch (error) {
        console.error("[Bot] Failed to process inbound message:", error);
      }
    }
    await next();
  });
  bot.on("callback_query:data", async (ctx) => {
    if (!isUserAllowed(ctx, config.allowedUserIds)) {
      await ctx.answerCallbackQuery();
      return;
    }
    if (!isChatAllowed(ctx, config)) {
      await ctx.answerCallbackQuery();
      return;
    }
    const data = String(ctx.callbackQuery.data ?? "");
    if (!data.startsWith("ocimp:") && !data.startsWith("ocset:") && !data.startsWith("ocperm:")) {
      await ctx.answerCallbackQuery();
      return;
    }
    const message = ctx.callbackQuery.message ?? void 0;
    if (!message || !ctx.chat || !ctx.from) {
      await ctx.answerCallbackQuery({
        text: "Cannot process this callback.",
        show_alert: false
      });
      return;
    }
    let command = "";
    if (data.startsWith("ocimp:")) {
      const payload = data.slice("ocimp:".length).trim();
      if (payload === "list") {
        command = "/oc import list";
      } else if (payload.startsWith("list:")) {
        command = `/oc import ${payload.replaceAll(":", " ")}`;
      } else {
        command = `/oc import ${payload}`;
      }
    } else if (data.startsWith("ocset:")) {
      const payload = data.slice("ocset:".length).trim();
      if (payload === "status") {
        command = "/oc status";
      } else {
        const [key, value] = payload.split(":", 2);
        if (!key || !value) {
          await ctx.answerCallbackQuery({
            text: "Bad settings payload",
            show_alert: false
          });
          return;
        }
        command = `/oc set ${key} ${value}`;
      }
    } else {
      const payload = data.slice("ocperm:".length);
      const cut = payload.lastIndexOf(":");
      if (cut <= 0 || cut >= payload.length - 1) {
        await ctx.answerCallbackQuery({
          text: "Bad permission payload",
          show_alert: false
        });
        return;
      }
      const permissionId = payload.slice(0, cut).trim();
      const response = payload.slice(cut + 1).trim().toLowerCase();
      if (!permissionId || !["once", "always", "reject"].includes(response)) {
        await ctx.answerCallbackQuery({
          text: "Bad permission payload",
          show_alert: false
        });
        return;
      }
      command = `/oc perm ${permissionId} ${response}`;
    }
    const inbound = {
      chatId: ctx.chat.id,
      chatType: String(ctx.chat.type),
      threadId: typeof message.message_thread_id === "number" ? message.message_thread_id : void 0,
      messageId: Number(message.message_id),
      userId: ctx.from.id,
      text: command
    };
    try {
      await onMessage(inbound);
      await ctx.answerCallbackQuery({
        text: command === "/oc import list" ? "List refreshed" : command.startsWith("/oc import ") ? "Import started" : command.startsWith("/oc perm ") ? "Permission response sent" : "Settings updated",
        show_alert: false
      });
    } catch (error) {
      console.error("[Bot] Callback import failed:", error);
      await ctx.answerCallbackQuery({
        text: "Import failed",
        show_alert: false
      });
    }
  });
  bot.catch((error) => {
    console.error("[Bot] Bot error:", error);
  });
  return createBotManager(bot, config);
}
function createBotManager(bot, config) {
  return {
    async start() {
      await bot.start({
        drop_pending_updates: true
      });
    },
    async stop() {
      await bot.stop();
      botInstance = null;
    },
    async sendMessage(params) {
      const result = await bot.api.sendMessage(params.chatId, params.text, {
        message_thread_id: params.threadId,
        reply_parameters: params.replyToMessageId ? { message_id: params.replyToMessageId } : void 0,
        disable_notification: params.disableNotification,
        parse_mode: params.parseMode,
        reply_markup: params.inlineKeyboard ? {
          inline_keyboard: params.inlineKeyboard.map(
            (row) => row.map((button) => ({
              text: button.text,
              callback_data: button.callbackData
            }))
          )
        } : void 0
      });
      return { message_id: result.message_id };
    },
    async editMessage(params) {
      await bot.api.editMessageText(params.chatId, params.messageId, params.text, {
        parse_mode: params.parseMode,
        reply_markup: params.inlineKeyboard ? {
          inline_keyboard: params.inlineKeyboard.map(
            (row) => row.map((button) => ({
              text: button.text,
              callback_data: button.callbackData
            }))
          )
        } : void 0
      });
    },
    async sendLegacyMessage(text) {
      const chatId = config.chatId ?? activePrivateChatId;
      if (!chatId) {
        throw new Error("No active private chat configured for legacy messaging.");
      }
      const result = await bot.api.sendMessage(chatId, text);
      return { message_id: result.message_id };
    },
    async createForumTopic(chatId, name) {
      const result = await bot.api.createForumTopic(chatId, name);
      return { message_thread_id: result.message_thread_id };
    },
    async editForumTopic(chatId, threadId, name) {
      await bot.api.editForumTopic(chatId, threadId, { name });
    },
    async downloadFile(fileId) {
      const file = await bot.api.getFile(fileId);
      if (!file.file_path) {
        throw new Error("Telegram file has no file_path.");
      }
      const url = `https://api.telegram.org/file/bot${config.botToken}/${file.file_path}`;
      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(
          `Failed to download Telegram file: ${response.status} ${response.statusText}`
        );
      }
      const contentType = response.headers.get("content-type");
      const buffer = Buffer.from(await response.arrayBuffer());
      return {
        buffer,
        mime: contentType && contentType.trim() !== "" ? contentType : "application/octet-stream",
        filePath: file.file_path
      };
    },
    getActivePrivateChatId() {
      return activePrivateChatId;
    }
  };
}

// src/bridge/controller.ts
import { realpathSync } from "fs";
import { basename as basename2 } from "path";

// node_modules/@opencode-ai/sdk/dist/gen/core/serverSentEvents.gen.js
var createSseClient = ({ onSseError, onSseEvent, responseTransformer, responseValidator, sseDefaultRetryDelay, sseMaxRetryAttempts, sseMaxRetryDelay, sseSleepFn, url, ...options }) => {
  let lastEventId;
  const sleep2 = sseSleepFn ?? ((ms) => new Promise((resolve3) => setTimeout(resolve3, ms)));
  const createStream = async function* () {
    let retryDelay = sseDefaultRetryDelay ?? 3e3;
    let attempt = 0;
    const signal = options.signal ?? new AbortController().signal;
    while (true) {
      if (signal.aborted)
        break;
      attempt++;
      const headers = options.headers instanceof Headers ? options.headers : new Headers(options.headers);
      if (lastEventId !== void 0) {
        headers.set("Last-Event-ID", lastEventId);
      }
      try {
        const response = await fetch(url, { ...options, headers, signal });
        if (!response.ok)
          throw new Error(`SSE failed: ${response.status} ${response.statusText}`);
        if (!response.body)
          throw new Error("No body in SSE response");
        const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
        let buffer = "";
        const abortHandler = () => {
          try {
            reader.cancel();
          } catch {
          }
        };
        signal.addEventListener("abort", abortHandler);
        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done)
              break;
            buffer += value;
            const chunks = buffer.split("\n\n");
            buffer = chunks.pop() ?? "";
            for (const chunk of chunks) {
              const lines = chunk.split("\n");
              const dataLines = [];
              let eventName;
              for (const line of lines) {
                if (line.startsWith("data:")) {
                  dataLines.push(line.replace(/^data:\s*/, ""));
                } else if (line.startsWith("event:")) {
                  eventName = line.replace(/^event:\s*/, "");
                } else if (line.startsWith("id:")) {
                  lastEventId = line.replace(/^id:\s*/, "");
                } else if (line.startsWith("retry:")) {
                  const parsed = Number.parseInt(line.replace(/^retry:\s*/, ""), 10);
                  if (!Number.isNaN(parsed)) {
                    retryDelay = parsed;
                  }
                }
              }
              let data;
              let parsedJson = false;
              if (dataLines.length) {
                const rawData = dataLines.join("\n");
                try {
                  data = JSON.parse(rawData);
                  parsedJson = true;
                } catch {
                  data = rawData;
                }
              }
              if (parsedJson) {
                if (responseValidator) {
                  await responseValidator(data);
                }
                if (responseTransformer) {
                  data = await responseTransformer(data);
                }
              }
              onSseEvent?.({
                data,
                event: eventName,
                id: lastEventId,
                retry: retryDelay
              });
              if (dataLines.length) {
                yield data;
              }
            }
          }
        } finally {
          signal.removeEventListener("abort", abortHandler);
          reader.releaseLock();
        }
        break;
      } catch (error) {
        onSseError?.(error);
        if (sseMaxRetryAttempts !== void 0 && attempt >= sseMaxRetryAttempts) {
          break;
        }
        const backoff = Math.min(retryDelay * 2 ** (attempt - 1), sseMaxRetryDelay ?? 3e4);
        await sleep2(backoff);
      }
    }
  };
  const stream = createStream();
  return { stream };
};

// node_modules/@opencode-ai/sdk/dist/gen/core/auth.gen.js
var getAuthToken = async (auth, callback) => {
  const token = typeof callback === "function" ? await callback(auth) : callback;
  if (!token) {
    return;
  }
  if (auth.scheme === "bearer") {
    return `Bearer ${token}`;
  }
  if (auth.scheme === "basic") {
    return `Basic ${btoa(token)}`;
  }
  return token;
};

// node_modules/@opencode-ai/sdk/dist/gen/core/bodySerializer.gen.js
var jsonBodySerializer = {
  bodySerializer: (body) => JSON.stringify(body, (_key, value) => typeof value === "bigint" ? value.toString() : value)
};

// node_modules/@opencode-ai/sdk/dist/gen/core/pathSerializer.gen.js
var separatorArrayExplode = (style) => {
  switch (style) {
    case "label":
      return ".";
    case "matrix":
      return ";";
    case "simple":
      return ",";
    default:
      return "&";
  }
};
var separatorArrayNoExplode = (style) => {
  switch (style) {
    case "form":
      return ",";
    case "pipeDelimited":
      return "|";
    case "spaceDelimited":
      return "%20";
    default:
      return ",";
  }
};
var separatorObjectExplode = (style) => {
  switch (style) {
    case "label":
      return ".";
    case "matrix":
      return ";";
    case "simple":
      return ",";
    default:
      return "&";
  }
};
var serializeArrayParam = ({ allowReserved, explode, name, style, value }) => {
  if (!explode) {
    const joinedValues2 = (allowReserved ? value : value.map((v) => encodeURIComponent(v))).join(separatorArrayNoExplode(style));
    switch (style) {
      case "label":
        return `.${joinedValues2}`;
      case "matrix":
        return `;${name}=${joinedValues2}`;
      case "simple":
        return joinedValues2;
      default:
        return `${name}=${joinedValues2}`;
    }
  }
  const separator = separatorArrayExplode(style);
  const joinedValues = value.map((v) => {
    if (style === "label" || style === "simple") {
      return allowReserved ? v : encodeURIComponent(v);
    }
    return serializePrimitiveParam({
      allowReserved,
      name,
      value: v
    });
  }).join(separator);
  return style === "label" || style === "matrix" ? separator + joinedValues : joinedValues;
};
var serializePrimitiveParam = ({ allowReserved, name, value }) => {
  if (value === void 0 || value === null) {
    return "";
  }
  if (typeof value === "object") {
    throw new Error("Deeply-nested arrays/objects aren\u2019t supported. Provide your own `querySerializer()` to handle these.");
  }
  return `${name}=${allowReserved ? value : encodeURIComponent(value)}`;
};
var serializeObjectParam = ({ allowReserved, explode, name, style, value, valueOnly }) => {
  if (value instanceof Date) {
    return valueOnly ? value.toISOString() : `${name}=${value.toISOString()}`;
  }
  if (style !== "deepObject" && !explode) {
    let values = [];
    Object.entries(value).forEach(([key, v]) => {
      values = [...values, key, allowReserved ? v : encodeURIComponent(v)];
    });
    const joinedValues2 = values.join(",");
    switch (style) {
      case "form":
        return `${name}=${joinedValues2}`;
      case "label":
        return `.${joinedValues2}`;
      case "matrix":
        return `;${name}=${joinedValues2}`;
      default:
        return joinedValues2;
    }
  }
  const separator = separatorObjectExplode(style);
  const joinedValues = Object.entries(value).map(([key, v]) => serializePrimitiveParam({
    allowReserved,
    name: style === "deepObject" ? `${name}[${key}]` : key,
    value: v
  })).join(separator);
  return style === "label" || style === "matrix" ? separator + joinedValues : joinedValues;
};

// node_modules/@opencode-ai/sdk/dist/gen/core/utils.gen.js
var PATH_PARAM_RE = /\{[^{}]+\}/g;
var defaultPathSerializer = ({ path, url: _url }) => {
  let url = _url;
  const matches = _url.match(PATH_PARAM_RE);
  if (matches) {
    for (const match of matches) {
      let explode = false;
      let name = match.substring(1, match.length - 1);
      let style = "simple";
      if (name.endsWith("*")) {
        explode = true;
        name = name.substring(0, name.length - 1);
      }
      if (name.startsWith(".")) {
        name = name.substring(1);
        style = "label";
      } else if (name.startsWith(";")) {
        name = name.substring(1);
        style = "matrix";
      }
      const value = path[name];
      if (value === void 0 || value === null) {
        continue;
      }
      if (Array.isArray(value)) {
        url = url.replace(match, serializeArrayParam({ explode, name, style, value }));
        continue;
      }
      if (typeof value === "object") {
        url = url.replace(match, serializeObjectParam({
          explode,
          name,
          style,
          value,
          valueOnly: true
        }));
        continue;
      }
      if (style === "matrix") {
        url = url.replace(match, `;${serializePrimitiveParam({
          name,
          value
        })}`);
        continue;
      }
      const replaceValue = encodeURIComponent(style === "label" ? `.${value}` : value);
      url = url.replace(match, replaceValue);
    }
  }
  return url;
};
var getUrl = ({ baseUrl, path, query, querySerializer, url: _url }) => {
  const pathUrl = _url.startsWith("/") ? _url : `/${_url}`;
  let url = (baseUrl ?? "") + pathUrl;
  if (path) {
    url = defaultPathSerializer({ path, url });
  }
  let search = query ? querySerializer(query) : "";
  if (search.startsWith("?")) {
    search = search.substring(1);
  }
  if (search) {
    url += `?${search}`;
  }
  return url;
};

// node_modules/@opencode-ai/sdk/dist/gen/client/utils.gen.js
var createQuerySerializer = ({ allowReserved, array, object } = {}) => {
  const querySerializer = (queryParams) => {
    const search = [];
    if (queryParams && typeof queryParams === "object") {
      for (const name in queryParams) {
        const value = queryParams[name];
        if (value === void 0 || value === null) {
          continue;
        }
        if (Array.isArray(value)) {
          const serializedArray = serializeArrayParam({
            allowReserved,
            explode: true,
            name,
            style: "form",
            value,
            ...array
          });
          if (serializedArray)
            search.push(serializedArray);
        } else if (typeof value === "object") {
          const serializedObject = serializeObjectParam({
            allowReserved,
            explode: true,
            name,
            style: "deepObject",
            value,
            ...object
          });
          if (serializedObject)
            search.push(serializedObject);
        } else {
          const serializedPrimitive = serializePrimitiveParam({
            allowReserved,
            name,
            value
          });
          if (serializedPrimitive)
            search.push(serializedPrimitive);
        }
      }
    }
    return search.join("&");
  };
  return querySerializer;
};
var getParseAs = (contentType) => {
  if (!contentType) {
    return "stream";
  }
  const cleanContent = contentType.split(";")[0]?.trim();
  if (!cleanContent) {
    return;
  }
  if (cleanContent.startsWith("application/json") || cleanContent.endsWith("+json")) {
    return "json";
  }
  if (cleanContent === "multipart/form-data") {
    return "formData";
  }
  if (["application/", "audio/", "image/", "video/"].some((type) => cleanContent.startsWith(type))) {
    return "blob";
  }
  if (cleanContent.startsWith("text/")) {
    return "text";
  }
  return;
};
var checkForExistence = (options, name) => {
  if (!name) {
    return false;
  }
  if (options.headers.has(name) || options.query?.[name] || options.headers.get("Cookie")?.includes(`${name}=`)) {
    return true;
  }
  return false;
};
var setAuthParams = async ({ security, ...options }) => {
  for (const auth of security) {
    if (checkForExistence(options, auth.name)) {
      continue;
    }
    const token = await getAuthToken(auth, options.auth);
    if (!token) {
      continue;
    }
    const name = auth.name ?? "Authorization";
    switch (auth.in) {
      case "query":
        if (!options.query) {
          options.query = {};
        }
        options.query[name] = token;
        break;
      case "cookie":
        options.headers.append("Cookie", `${name}=${token}`);
        break;
      case "header":
      default:
        options.headers.set(name, token);
        break;
    }
  }
};
var buildUrl = (options) => getUrl({
  baseUrl: options.baseUrl,
  path: options.path,
  query: options.query,
  querySerializer: typeof options.querySerializer === "function" ? options.querySerializer : createQuerySerializer(options.querySerializer),
  url: options.url
});
var mergeConfigs = (a, b) => {
  const config = { ...a, ...b };
  if (config.baseUrl?.endsWith("/")) {
    config.baseUrl = config.baseUrl.substring(0, config.baseUrl.length - 1);
  }
  config.headers = mergeHeaders(a.headers, b.headers);
  return config;
};
var mergeHeaders = (...headers) => {
  const mergedHeaders = new Headers();
  for (const header of headers) {
    if (!header || typeof header !== "object") {
      continue;
    }
    const iterator = header instanceof Headers ? header.entries() : Object.entries(header);
    for (const [key, value] of iterator) {
      if (value === null) {
        mergedHeaders.delete(key);
      } else if (Array.isArray(value)) {
        for (const v of value) {
          mergedHeaders.append(key, v);
        }
      } else if (value !== void 0) {
        mergedHeaders.set(key, typeof value === "object" ? JSON.stringify(value) : value);
      }
    }
  }
  return mergedHeaders;
};
var Interceptors = class {
  _fns;
  constructor() {
    this._fns = [];
  }
  clear() {
    this._fns = [];
  }
  getInterceptorIndex(id) {
    if (typeof id === "number") {
      return this._fns[id] ? id : -1;
    } else {
      return this._fns.indexOf(id);
    }
  }
  exists(id) {
    const index = this.getInterceptorIndex(id);
    return !!this._fns[index];
  }
  eject(id) {
    const index = this.getInterceptorIndex(id);
    if (this._fns[index]) {
      this._fns[index] = null;
    }
  }
  update(id, fn) {
    const index = this.getInterceptorIndex(id);
    if (this._fns[index]) {
      this._fns[index] = fn;
      return id;
    } else {
      return false;
    }
  }
  use(fn) {
    this._fns = [...this._fns, fn];
    return this._fns.length - 1;
  }
};
var createInterceptors = () => ({
  error: new Interceptors(),
  request: new Interceptors(),
  response: new Interceptors()
});
var defaultQuerySerializer = createQuerySerializer({
  allowReserved: false,
  array: {
    explode: true,
    style: "form"
  },
  object: {
    explode: true,
    style: "deepObject"
  }
});
var defaultHeaders = {
  "Content-Type": "application/json"
};
var createConfig = (override = {}) => ({
  ...jsonBodySerializer,
  headers: defaultHeaders,
  parseAs: "auto",
  querySerializer: defaultQuerySerializer,
  ...override
});

// node_modules/@opencode-ai/sdk/dist/gen/client/client.gen.js
var createClient = (config = {}) => {
  let _config = mergeConfigs(createConfig(), config);
  const getConfig = () => ({ ..._config });
  const setConfig = (config2) => {
    _config = mergeConfigs(_config, config2);
    return getConfig();
  };
  const interceptors = createInterceptors();
  const beforeRequest = async (options) => {
    const opts = {
      ..._config,
      ...options,
      fetch: options.fetch ?? _config.fetch ?? globalThis.fetch,
      headers: mergeHeaders(_config.headers, options.headers),
      serializedBody: void 0
    };
    if (opts.security) {
      await setAuthParams({
        ...opts,
        security: opts.security
      });
    }
    if (opts.requestValidator) {
      await opts.requestValidator(opts);
    }
    if (opts.body && opts.bodySerializer) {
      opts.serializedBody = opts.bodySerializer(opts.body);
    }
    if (opts.serializedBody === void 0 || opts.serializedBody === "") {
      opts.headers.delete("Content-Type");
    }
    const url = buildUrl(opts);
    return { opts, url };
  };
  const request = async (options) => {
    const { opts, url } = await beforeRequest(options);
    const requestInit = {
      redirect: "follow",
      ...opts,
      body: opts.serializedBody
    };
    let request2 = new Request(url, requestInit);
    for (const fn of interceptors.request._fns) {
      if (fn) {
        request2 = await fn(request2, opts);
      }
    }
    const _fetch = opts.fetch;
    let response = await _fetch(request2);
    for (const fn of interceptors.response._fns) {
      if (fn) {
        response = await fn(response, request2, opts);
      }
    }
    const result = {
      request: request2,
      response
    };
    if (response.ok) {
      if (response.status === 204 || response.headers.get("Content-Length") === "0") {
        return opts.responseStyle === "data" ? {} : {
          data: {},
          ...result
        };
      }
      const parseAs = (opts.parseAs === "auto" ? getParseAs(response.headers.get("Content-Type")) : opts.parseAs) ?? "json";
      let data;
      switch (parseAs) {
        case "arrayBuffer":
        case "blob":
        case "formData":
        case "json":
        case "text":
          data = await response[parseAs]();
          break;
        case "stream":
          return opts.responseStyle === "data" ? response.body : {
            data: response.body,
            ...result
          };
      }
      if (parseAs === "json") {
        if (opts.responseValidator) {
          await opts.responseValidator(data);
        }
        if (opts.responseTransformer) {
          data = await opts.responseTransformer(data);
        }
      }
      return opts.responseStyle === "data" ? data : {
        data,
        ...result
      };
    }
    const textError = await response.text();
    let jsonError;
    try {
      jsonError = JSON.parse(textError);
    } catch {
    }
    const error = jsonError ?? textError;
    let finalError = error;
    for (const fn of interceptors.error._fns) {
      if (fn) {
        finalError = await fn(error, response, request2, opts);
      }
    }
    finalError = finalError || {};
    if (opts.throwOnError) {
      throw finalError;
    }
    return opts.responseStyle === "data" ? void 0 : {
      error: finalError,
      ...result
    };
  };
  const makeMethod = (method) => {
    const fn = (options) => request({ ...options, method });
    fn.sse = async (options) => {
      const { opts, url } = await beforeRequest(options);
      return createSseClient({
        ...opts,
        body: opts.body,
        headers: opts.headers,
        method,
        url
      });
    };
    return fn;
  };
  return {
    buildUrl,
    connect: makeMethod("CONNECT"),
    delete: makeMethod("DELETE"),
    get: makeMethod("GET"),
    getConfig,
    head: makeMethod("HEAD"),
    interceptors,
    options: makeMethod("OPTIONS"),
    patch: makeMethod("PATCH"),
    post: makeMethod("POST"),
    put: makeMethod("PUT"),
    request,
    setConfig,
    trace: makeMethod("TRACE")
  };
};

// node_modules/@opencode-ai/sdk/dist/gen/core/params.gen.js
var extraPrefixesMap = {
  $body_: "body",
  $headers_: "headers",
  $path_: "path",
  $query_: "query"
};
var extraPrefixes = Object.entries(extraPrefixesMap);

// node_modules/@opencode-ai/sdk/dist/gen/client.gen.js
var client = createClient(createConfig({
  baseUrl: "http://localhost:4096"
}));

// node_modules/@opencode-ai/sdk/dist/gen/sdk.gen.js
var _HeyApiClient = class {
  _client = client;
  constructor(args) {
    if (args?.client) {
      this._client = args.client;
    }
  }
};
var Global = class extends _HeyApiClient {
  /**
   * Get events
   */
  event(options) {
    return (options?.client ?? this._client).get.sse({
      url: "/global/event",
      ...options
    });
  }
};
var Project = class extends _HeyApiClient {
  /**
   * List all projects
   */
  list(options) {
    return (options?.client ?? this._client).get({
      url: "/project",
      ...options
    });
  }
  /**
   * Get the current project
   */
  current(options) {
    return (options?.client ?? this._client).get({
      url: "/project/current",
      ...options
    });
  }
};
var Pty = class extends _HeyApiClient {
  /**
   * List all PTY sessions
   */
  list(options) {
    return (options?.client ?? this._client).get({
      url: "/pty",
      ...options
    });
  }
  /**
   * Create a new PTY session
   */
  create(options) {
    return (options?.client ?? this._client).post({
      url: "/pty",
      ...options,
      headers: {
        "Content-Type": "application/json",
        ...options?.headers
      }
    });
  }
  /**
   * Remove a PTY session
   */
  remove(options) {
    return (options.client ?? this._client).delete({
      url: "/pty/{id}",
      ...options
    });
  }
  /**
   * Get PTY session info
   */
  get(options) {
    return (options.client ?? this._client).get({
      url: "/pty/{id}",
      ...options
    });
  }
  /**
   * Update PTY session
   */
  update(options) {
    return (options.client ?? this._client).put({
      url: "/pty/{id}",
      ...options,
      headers: {
        "Content-Type": "application/json",
        ...options.headers
      }
    });
  }
  /**
   * Connect to a PTY session
   */
  connect(options) {
    return (options.client ?? this._client).get({
      url: "/pty/{id}/connect",
      ...options
    });
  }
};
var Config = class extends _HeyApiClient {
  /**
   * Get config info
   */
  get(options) {
    return (options?.client ?? this._client).get({
      url: "/config",
      ...options
    });
  }
  /**
   * Update config
   */
  update(options) {
    return (options?.client ?? this._client).patch({
      url: "/config",
      ...options,
      headers: {
        "Content-Type": "application/json",
        ...options?.headers
      }
    });
  }
  /**
   * List all providers
   */
  providers(options) {
    return (options?.client ?? this._client).get({
      url: "/config/providers",
      ...options
    });
  }
};
var Tool = class extends _HeyApiClient {
  /**
   * List all tool IDs (including built-in and dynamically registered)
   */
  ids(options) {
    return (options?.client ?? this._client).get({
      url: "/experimental/tool/ids",
      ...options
    });
  }
  /**
   * List tools with JSON schema parameters for a provider/model
   */
  list(options) {
    return (options.client ?? this._client).get({
      url: "/experimental/tool",
      ...options
    });
  }
};
var Instance = class extends _HeyApiClient {
  /**
   * Dispose the current instance
   */
  dispose(options) {
    return (options?.client ?? this._client).post({
      url: "/instance/dispose",
      ...options
    });
  }
};
var Path = class extends _HeyApiClient {
  /**
   * Get the current path
   */
  get(options) {
    return (options?.client ?? this._client).get({
      url: "/path",
      ...options
    });
  }
};
var Vcs = class extends _HeyApiClient {
  /**
   * Get VCS info for the current instance
   */
  get(options) {
    return (options?.client ?? this._client).get({
      url: "/vcs",
      ...options
    });
  }
};
var Session = class extends _HeyApiClient {
  /**
   * List all sessions
   */
  list(options) {
    return (options?.client ?? this._client).get({
      url: "/session",
      ...options
    });
  }
  /**
   * Create a new session
   */
  create(options) {
    return (options?.client ?? this._client).post({
      url: "/session",
      ...options,
      headers: {
        "Content-Type": "application/json",
        ...options?.headers
      }
    });
  }
  /**
   * Get session status
   */
  status(options) {
    return (options?.client ?? this._client).get({
      url: "/session/status",
      ...options
    });
  }
  /**
   * Delete a session and all its data
   */
  delete(options) {
    return (options.client ?? this._client).delete({
      url: "/session/{id}",
      ...options
    });
  }
  /**
   * Get session
   */
  get(options) {
    return (options.client ?? this._client).get({
      url: "/session/{id}",
      ...options
    });
  }
  /**
   * Update session properties
   */
  update(options) {
    return (options.client ?? this._client).patch({
      url: "/session/{id}",
      ...options,
      headers: {
        "Content-Type": "application/json",
        ...options.headers
      }
    });
  }
  /**
   * Get a session's children
   */
  children(options) {
    return (options.client ?? this._client).get({
      url: "/session/{id}/children",
      ...options
    });
  }
  /**
   * Get the todo list for a session
   */
  todo(options) {
    return (options.client ?? this._client).get({
      url: "/session/{id}/todo",
      ...options
    });
  }
  /**
   * Analyze the app and create an AGENTS.md file
   */
  init(options) {
    return (options.client ?? this._client).post({
      url: "/session/{id}/init",
      ...options,
      headers: {
        "Content-Type": "application/json",
        ...options.headers
      }
    });
  }
  /**
   * Fork an existing session at a specific message
   */
  fork(options) {
    return (options.client ?? this._client).post({
      url: "/session/{id}/fork",
      ...options,
      headers: {
        "Content-Type": "application/json",
        ...options.headers
      }
    });
  }
  /**
   * Abort a session
   */
  abort(options) {
    return (options.client ?? this._client).post({
      url: "/session/{id}/abort",
      ...options
    });
  }
  /**
   * Unshare the session
   */
  unshare(options) {
    return (options.client ?? this._client).delete({
      url: "/session/{id}/share",
      ...options
    });
  }
  /**
   * Share a session
   */
  share(options) {
    return (options.client ?? this._client).post({
      url: "/session/{id}/share",
      ...options
    });
  }
  /**
   * Get the diff for this session
   */
  diff(options) {
    return (options.client ?? this._client).get({
      url: "/session/{id}/diff",
      ...options
    });
  }
  /**
   * Summarize the session
   */
  summarize(options) {
    return (options.client ?? this._client).post({
      url: "/session/{id}/summarize",
      ...options,
      headers: {
        "Content-Type": "application/json",
        ...options.headers
      }
    });
  }
  /**
   * List messages for a session
   */
  messages(options) {
    return (options.client ?? this._client).get({
      url: "/session/{id}/message",
      ...options
    });
  }
  /**
   * Create and send a new message to a session
   */
  prompt(options) {
    return (options.client ?? this._client).post({
      url: "/session/{id}/message",
      ...options,
      headers: {
        "Content-Type": "application/json",
        ...options.headers
      }
    });
  }
  /**
   * Get a message from a session
   */
  message(options) {
    return (options.client ?? this._client).get({
      url: "/session/{id}/message/{messageID}",
      ...options
    });
  }
  /**
   * Create and send a new message to a session, start if needed and return immediately
   */
  promptAsync(options) {
    return (options.client ?? this._client).post({
      url: "/session/{id}/prompt_async",
      ...options,
      headers: {
        "Content-Type": "application/json",
        ...options.headers
      }
    });
  }
  /**
   * Send a new command to a session
   */
  command(options) {
    return (options.client ?? this._client).post({
      url: "/session/{id}/command",
      ...options,
      headers: {
        "Content-Type": "application/json",
        ...options.headers
      }
    });
  }
  /**
   * Run a shell command
   */
  shell(options) {
    return (options.client ?? this._client).post({
      url: "/session/{id}/shell",
      ...options,
      headers: {
        "Content-Type": "application/json",
        ...options.headers
      }
    });
  }
  /**
   * Revert a message
   */
  revert(options) {
    return (options.client ?? this._client).post({
      url: "/session/{id}/revert",
      ...options,
      headers: {
        "Content-Type": "application/json",
        ...options.headers
      }
    });
  }
  /**
   * Restore all reverted messages
   */
  unrevert(options) {
    return (options.client ?? this._client).post({
      url: "/session/{id}/unrevert",
      ...options
    });
  }
};
var Command = class extends _HeyApiClient {
  /**
   * List all commands
   */
  list(options) {
    return (options?.client ?? this._client).get({
      url: "/command",
      ...options
    });
  }
};
var Oauth = class extends _HeyApiClient {
  /**
   * Authorize a provider using OAuth
   */
  authorize(options) {
    return (options.client ?? this._client).post({
      url: "/provider/{id}/oauth/authorize",
      ...options,
      headers: {
        "Content-Type": "application/json",
        ...options.headers
      }
    });
  }
  /**
   * Handle OAuth callback for a provider
   */
  callback(options) {
    return (options.client ?? this._client).post({
      url: "/provider/{id}/oauth/callback",
      ...options,
      headers: {
        "Content-Type": "application/json",
        ...options.headers
      }
    });
  }
};
var Provider = class extends _HeyApiClient {
  /**
   * List all providers
   */
  list(options) {
    return (options?.client ?? this._client).get({
      url: "/provider",
      ...options
    });
  }
  /**
   * Get provider authentication methods
   */
  auth(options) {
    return (options?.client ?? this._client).get({
      url: "/provider/auth",
      ...options
    });
  }
  oauth = new Oauth({ client: this._client });
};
var Find = class extends _HeyApiClient {
  /**
   * Find text in files
   */
  text(options) {
    return (options.client ?? this._client).get({
      url: "/find",
      ...options
    });
  }
  /**
   * Find files
   */
  files(options) {
    return (options.client ?? this._client).get({
      url: "/find/file",
      ...options
    });
  }
  /**
   * Find workspace symbols
   */
  symbols(options) {
    return (options.client ?? this._client).get({
      url: "/find/symbol",
      ...options
    });
  }
};
var File = class extends _HeyApiClient {
  /**
   * List files and directories
   */
  list(options) {
    return (options.client ?? this._client).get({
      url: "/file",
      ...options
    });
  }
  /**
   * Read a file
   */
  read(options) {
    return (options.client ?? this._client).get({
      url: "/file/content",
      ...options
    });
  }
  /**
   * Get file status
   */
  status(options) {
    return (options?.client ?? this._client).get({
      url: "/file/status",
      ...options
    });
  }
};
var App = class extends _HeyApiClient {
  /**
   * Write a log entry to the server logs
   */
  log(options) {
    return (options?.client ?? this._client).post({
      url: "/log",
      ...options,
      headers: {
        "Content-Type": "application/json",
        ...options?.headers
      }
    });
  }
  /**
   * List all agents
   */
  agents(options) {
    return (options?.client ?? this._client).get({
      url: "/agent",
      ...options
    });
  }
};
var Auth = class extends _HeyApiClient {
  /**
   * Remove OAuth credentials for an MCP server
   */
  remove(options) {
    return (options.client ?? this._client).delete({
      url: "/mcp/{name}/auth",
      ...options
    });
  }
  /**
   * Start OAuth authentication flow for an MCP server
   */
  start(options) {
    return (options.client ?? this._client).post({
      url: "/mcp/{name}/auth",
      ...options
    });
  }
  /**
   * Complete OAuth authentication with authorization code
   */
  callback(options) {
    return (options.client ?? this._client).post({
      url: "/mcp/{name}/auth/callback",
      ...options,
      headers: {
        "Content-Type": "application/json",
        ...options.headers
      }
    });
  }
  /**
   * Start OAuth flow and wait for callback (opens browser)
   */
  authenticate(options) {
    return (options.client ?? this._client).post({
      url: "/mcp/{name}/auth/authenticate",
      ...options
    });
  }
  /**
   * Set authentication credentials
   */
  set(options) {
    return (options.client ?? this._client).put({
      url: "/auth/{id}",
      ...options,
      headers: {
        "Content-Type": "application/json",
        ...options.headers
      }
    });
  }
};
var Mcp = class extends _HeyApiClient {
  /**
   * Get MCP server status
   */
  status(options) {
    return (options?.client ?? this._client).get({
      url: "/mcp",
      ...options
    });
  }
  /**
   * Add MCP server dynamically
   */
  add(options) {
    return (options?.client ?? this._client).post({
      url: "/mcp",
      ...options,
      headers: {
        "Content-Type": "application/json",
        ...options?.headers
      }
    });
  }
  /**
   * Connect an MCP server
   */
  connect(options) {
    return (options.client ?? this._client).post({
      url: "/mcp/{name}/connect",
      ...options
    });
  }
  /**
   * Disconnect an MCP server
   */
  disconnect(options) {
    return (options.client ?? this._client).post({
      url: "/mcp/{name}/disconnect",
      ...options
    });
  }
  auth = new Auth({ client: this._client });
};
var Lsp = class extends _HeyApiClient {
  /**
   * Get LSP server status
   */
  status(options) {
    return (options?.client ?? this._client).get({
      url: "/lsp",
      ...options
    });
  }
};
var Formatter = class extends _HeyApiClient {
  /**
   * Get formatter status
   */
  status(options) {
    return (options?.client ?? this._client).get({
      url: "/formatter",
      ...options
    });
  }
};
var Control = class extends _HeyApiClient {
  /**
   * Get the next TUI request from the queue
   */
  next(options) {
    return (options?.client ?? this._client).get({
      url: "/tui/control/next",
      ...options
    });
  }
  /**
   * Submit a response to the TUI request queue
   */
  response(options) {
    return (options?.client ?? this._client).post({
      url: "/tui/control/response",
      ...options,
      headers: {
        "Content-Type": "application/json",
        ...options?.headers
      }
    });
  }
};
var Tui = class extends _HeyApiClient {
  /**
   * Append prompt to the TUI
   */
  appendPrompt(options) {
    return (options?.client ?? this._client).post({
      url: "/tui/append-prompt",
      ...options,
      headers: {
        "Content-Type": "application/json",
        ...options?.headers
      }
    });
  }
  /**
   * Open the help dialog
   */
  openHelp(options) {
    return (options?.client ?? this._client).post({
      url: "/tui/open-help",
      ...options
    });
  }
  /**
   * Open the session dialog
   */
  openSessions(options) {
    return (options?.client ?? this._client).post({
      url: "/tui/open-sessions",
      ...options
    });
  }
  /**
   * Open the theme dialog
   */
  openThemes(options) {
    return (options?.client ?? this._client).post({
      url: "/tui/open-themes",
      ...options
    });
  }
  /**
   * Open the model dialog
   */
  openModels(options) {
    return (options?.client ?? this._client).post({
      url: "/tui/open-models",
      ...options
    });
  }
  /**
   * Submit the prompt
   */
  submitPrompt(options) {
    return (options?.client ?? this._client).post({
      url: "/tui/submit-prompt",
      ...options
    });
  }
  /**
   * Clear the prompt
   */
  clearPrompt(options) {
    return (options?.client ?? this._client).post({
      url: "/tui/clear-prompt",
      ...options
    });
  }
  /**
   * Execute a TUI command (e.g. agent_cycle)
   */
  executeCommand(options) {
    return (options?.client ?? this._client).post({
      url: "/tui/execute-command",
      ...options,
      headers: {
        "Content-Type": "application/json",
        ...options?.headers
      }
    });
  }
  /**
   * Show a toast notification in the TUI
   */
  showToast(options) {
    return (options?.client ?? this._client).post({
      url: "/tui/show-toast",
      ...options,
      headers: {
        "Content-Type": "application/json",
        ...options?.headers
      }
    });
  }
  /**
   * Publish a TUI event
   */
  publish(options) {
    return (options?.client ?? this._client).post({
      url: "/tui/publish",
      ...options,
      headers: {
        "Content-Type": "application/json",
        ...options?.headers
      }
    });
  }
  control = new Control({ client: this._client });
};
var Event = class extends _HeyApiClient {
  /**
   * Get events
   */
  subscribe(options) {
    return (options?.client ?? this._client).get.sse({
      url: "/event",
      ...options
    });
  }
};
var OpencodeClient = class extends _HeyApiClient {
  /**
   * Respond to a permission request
   */
  postSessionIdPermissionsPermissionId(options) {
    return (options.client ?? this._client).post({
      url: "/session/{id}/permissions/{permissionID}",
      ...options,
      headers: {
        "Content-Type": "application/json",
        ...options.headers
      }
    });
  }
  global = new Global({ client: this._client });
  project = new Project({ client: this._client });
  pty = new Pty({ client: this._client });
  config = new Config({ client: this._client });
  tool = new Tool({ client: this._client });
  instance = new Instance({ client: this._client });
  path = new Path({ client: this._client });
  vcs = new Vcs({ client: this._client });
  session = new Session({ client: this._client });
  command = new Command({ client: this._client });
  provider = new Provider({ client: this._client });
  find = new Find({ client: this._client });
  file = new File({ client: this._client });
  app = new App({ client: this._client });
  mcp = new Mcp({ client: this._client });
  lsp = new Lsp({ client: this._client });
  formatter = new Formatter({ client: this._client });
  tui = new Tui({ client: this._client });
  auth = new Auth({ client: this._client });
  event = new Event({ client: this._client });
};

// node_modules/@opencode-ai/sdk/dist/client.js
function createOpencodeClient(config) {
  if (!config?.fetch) {
    const customFetch = (req) => {
      req.timeout = false;
      return fetch(req);
    };
    config = {
      ...config,
      fetch: customFetch
    };
  }
  if (config?.directory) {
    config.headers = {
      ...config.headers,
      "x-opencode-directory": config.directory
    };
  }
  const client2 = createClient(config);
  return new OpencodeClient({ client: client2 });
}

// node_modules/@opencode-ai/sdk/dist/server.js
import { spawn } from "child_process";

// src/bridge/opencode-client.ts
function buildBasicAuthHeader(username, password) {
  const token = Buffer.from(`${username}:${password}`, "utf8").toString("base64");
  return `Basic ${token}`;
}
var AuthenticatedOpencodeClientFactory = class {
  config;
  authHeader;
  clients = /* @__PURE__ */ new Map();
  constructor(config) {
    this.config = config;
    if (config.opencodeUsername && config.opencodePassword) {
      this.authHeader = buildBasicAuthHeader(
        config.opencodeUsername,
        config.opencodePassword
      );
    }
  }
  getForDirectory(directory) {
    const existing = this.clients.get(directory);
    if (existing) {
      return existing;
    }
    const created = createOpencodeClient({
      baseUrl: this.config.opencodeBaseUrl,
      directory,
      headers: this.authHeader ? {
        Authorization: this.authHeader
      } : void 0
    });
    this.clients.set(directory, created);
    return created;
  }
};

// src/bridge/store.ts
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "fs";
import { dirname } from "path";
function nowMs() {
  return Date.now();
}
function createEmptyState() {
  return {
    version: 1,
    topics: []
  };
}
var TopicSessionStore = class {
  statePath;
  state;
  constructor(statePath) {
    this.statePath = statePath;
    this.state = this.load();
  }
  load() {
    try {
      const raw = readFileSync(this.statePath, "utf8");
      const parsed = JSON.parse(raw);
      if (parsed?.version !== 1 || !Array.isArray(parsed.topics)) {
        return createEmptyState();
      }
      return parsed;
    } catch {
      return createEmptyState();
    }
  }
  persist() {
    mkdirSync(dirname(this.statePath), { recursive: true });
    const tmpPath = `${this.statePath}.tmp-${nowMs()}`;
    writeFileSync(tmpPath, JSON.stringify(this.state, null, 2));
    renameSync(tmpPath, this.statePath);
  }
  getByThread(chatId, threadId) {
    return this.state.topics.find(
      (item) => item.chatId === chatId && item.threadId === threadId
    );
  }
  getBySession(sessionId) {
    return this.state.topics.find((item) => item.sessionId === sessionId);
  }
  listByChat(chatId) {
    return this.state.topics.filter((item) => item.chatId === chatId);
  }
  upsert(binding) {
    const index = this.state.topics.findIndex(
      (item) => item.chatId === binding.chatId && item.threadId === binding.threadId
    );
    if (index === -1) {
      this.state.topics.push(binding);
    } else {
      this.state.topics[index] = binding;
    }
    this.persist();
  }
  patchBySession(sessionId, patch) {
    const index = this.state.topics.findIndex((item) => item.sessionId === sessionId);
    if (index === -1) {
      return void 0;
    }
    const next = {
      ...this.state.topics[index],
      ...patch,
      updatedAt: nowMs()
    };
    this.state.topics[index] = next;
    this.persist();
    return next;
  }
  closeByThread(chatId, threadId) {
    const current = this.getByThread(chatId, threadId);
    if (!current) {
      return void 0;
    }
    const next = {
      ...current,
      state: "closed",
      updatedAt: nowMs()
    };
    this.upsert(next);
    return next;
  }
};

// src/bridge/utils.ts
import { basename, isAbsolute, resolve } from "path";
function splitMessage(text, maxLength = 3500) {
  if (text.length <= maxLength) {
    return [text];
  }
  const chunks = [];
  let cursor = 0;
  while (cursor < text.length) {
    chunks.push(text.slice(cursor, cursor + maxLength));
    cursor += maxLength;
  }
  return chunks;
}
function normalizeTextInput(text, caption) {
  const merged = [text ?? "", caption ?? ""].filter(Boolean).join("\n").trim();
  return merged;
}
function parseOcCommand(input) {
  const text = input.trim();
  const match = text.match(/^\/oc(?:@\w+)?(?:\s+(\w+))?(?:\s+([\s\S]+))?$/i);
  if (!match) {
    return void 0;
  }
  const name = (match[1] ?? "help").toLowerCase();
  const args = (match[2] ?? "").trim();
  return { name, args };
}
function ensureAbsolutePath(value) {
  if (!isAbsolute(value)) {
    throw new Error("Workspace path must be absolute.");
  }
  return resolve(value);
}
function isPathWithinRoots(pathValue, roots) {
  if (roots.length === 0) {
    return true;
  }
  return roots.some((root) => pathValue === root || pathValue.startsWith(`${root}/`));
}
function shortSessionId(sessionId) {
  if (sessionId.length <= 12) {
    return sessionId;
  }
  return sessionId.slice(0, 12);
}
function workspaceLabel(pathValue) {
  return basename(pathValue) || pathValue;
}
function detectContextOverflow(errorText) {
  const normalized = errorText.toLowerCase();
  return normalized.includes("context_length_exceeded") || normalized.includes("input exceeds the context window");
}
function safeErrorMessage(error) {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

// src/bridge/controller.ts
var EMPTY_ASSISTANT_OUTPUT = "Assistant finished without final text output.";
var LIVE_PROGRESS_TICK_MS = 3e3;
var LIVE_PROGRESS_MIN_EDIT_MS = 2500;
var LIVE_PROGRESS_MIN_SEND_MS = 1200;
var TOPIC_RENAME_MIN_MS = 5e3;
var FLOOD_JITTER_MS = 250;
var DEFAULT_REASONING_EFFORT = "high";
var PROMPT_COALESCE_MS = 1500;
function truncateTopicName(value) {
  if (value.length <= 120) {
    return value;
  }
  return `${value.slice(0, 117)}...`;
}
function truncateButtonText(value, maxLength = 52) {
  if (value.length <= maxLength) {
    return value;
  }
  return `${value.slice(0, Math.max(0, maxLength - 3))}...`;
}
function parseErrorPayload(error) {
  if (!error) {
    return "Unknown error";
  }
  if (typeof error === "string") {
    return error;
  }
  if (error instanceof Error) {
    return error.message;
  }
  const errorObj = error;
  if (typeof errorObj.detail === "string" && errorObj.detail.trim() !== "") {
    return errorObj.detail;
  }
  if (typeof errorObj.message === "string" && errorObj.message.trim() !== "") {
    return errorObj.message;
  }
  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
}
function toDataUrl(mime, data) {
  return `data:${mime};base64,${data.toString("base64")}`;
}
function extractAssistantText(parts) {
  const textParts = parts.filter((part) => {
    const candidate = part;
    return candidate?.type === "text" && typeof candidate.text === "string";
  }).map((part) => part.text).join("").trim();
  if (textParts !== "") {
    return textParts;
  }
  const fileParts = parts.filter((part) => {
    const candidate = part;
    return candidate?.type === "file";
  }).map((part) => part.filename || part.url).filter(Boolean).join("\n");
  if (fileParts !== "") {
    return `Assistant returned file output:
${fileParts}`;
  }
  const reasoningText = parts.filter((part) => part?.type === "reasoning" && typeof part?.text === "string").map((part) => String(part.text).trim()).filter(Boolean).join("\n\n").trim();
  if (reasoningText !== "") {
    return `Assistant reasoning:
${reasoningText.slice(0, 2e3)}`;
  }
  const toolStates = parts.filter((part) => part?.type === "tool").map((part) => {
    const name = String(part?.tool || "tool");
    const status = String(part?.state?.status || "unknown");
    return `- ${name}: ${status}`;
  });
  if (toolStates.length > 0) {
    return `Assistant ran tools but returned no final text yet:
${toolStates.join("\n")}`;
  }
  return EMPTY_ASSISTANT_OUTPUT;
}
function isTopicCreationPermissionError(errorText) {
  const normalized = errorText.toLowerCase();
  return normalized.includes("not enough rights to create a topic") || normalized.includes("can_manage_topics");
}
function formatSessionProfile(profile) {
  const modelId = profile.model.modelID;
  const modelName = modelDisplayName(profile.model);
  const effort = profile.reasoningEffort ?? DEFAULT_REASONING_EFFORT;
  const summary = profile.reasoningSummary ?? "auto";
  const verbosity = profile.textVerbosity ?? "medium";
  const effortHint = effort === "high" ? "max quality, slower" : effort === "xhigh" ? "highest quality, slowest" : effort === "low" ? "faster, less deep" : effort === "none" ? "minimal reasoning" : "balanced";
  const summaryHint = summary === "detailed" ? "long reasoning summary" : summary === "none" ? "hide reasoning summary" : "auto summary";
  const verbosityHint = verbosity === "high" ? "more detailed final answer" : verbosity === "low" ? "short final answer" : "balanced final answer";
  return [
    `Model: ${modelName} (${profile.model.providerID}/${modelId})`,
    `Reasoning effort: ${effort} (${effortHint})`,
    `Reasoning summary: ${summary} (${summaryHint})`,
    `Verbosity: ${verbosity} (${verbosityHint})`
  ];
}
function modelDisplayName(model) {
  const modelId = model.modelID;
  if (modelId === "gpt-5.3-codex") return "ChatGPT Codex 5.3";
  if (modelId === "gpt-5.2-codex") return "ChatGPT Codex 5.2";
  return modelId;
}
function markSelected(label, isSelected) {
  return isSelected ? `${label} *` : label;
}
function profileLegendLines() {
  return [
    "Parameters:",
    "- Model: Codex model used in this topic.",
    "- Effort: how deep the model reasons (quality vs speed).",
    "- Summary: how much reasoning summary is shown.",
    "- Verbosity: detail level of the final answer.",
    "- Plain ChatGPT mode is not enabled in this bridge yet; this topic uses Codex profile."
  ];
}
function formatDurationSeconds(ms) {
  const sec = Math.max(0, Math.round(ms / 1e3));
  if (sec < 60) return `${sec}s`;
  const min = Math.floor(sec / 60);
  const rem = sec % 60;
  return `${min}m ${rem}s`;
}
function formatDateTime(ms) {
  const value = new Date(ms);
  const date = value.toISOString().replace("T", " ").slice(0, 19);
  return `${date} UTC`;
}
function shortPreferences(binding) {
  return `Reasoning: effort=${binding.reasoningEffort || DEFAULT_REASONING_EFFORT}, summary=${binding.reasoningSummary || "auto"}, verbosity=${binding.textVerbosity || "medium"}`;
}
function collapseLine(value, max = 120) {
  const single = value.replace(/\s+/g, " ").trim();
  if (single.length <= max) {
    return single;
  }
  return `${single.slice(0, Math.max(0, max - 3))}...`;
}
function trimWithEllipsis(value, max = 1200) {
  const trimmed = value.trim();
  if (trimmed.length <= max) {
    return trimmed;
  }
  return `${trimmed.slice(0, Math.max(0, max - 3))}...`;
}
function escapeHtml(value) {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}
function escapeHtmlAttr(value) {
  return escapeHtml(value).replaceAll('"', "&quot;").replaceAll("'", "&#39;");
}
function renderInlineMarkdownToHtml(input) {
  let rendered = escapeHtml(input);
  const placeholders = [];
  rendered = rendered.replace(/`([^`\n]+)`/g, (_full, code) => {
    const id = placeholders.length;
    placeholders.push(`<code>${code}</code>`);
    return `\0CODE_${id}\0`;
  });
  rendered = rendered.replace(
    /\[([^\]\n]{1,1000})\]\((https?:\/\/[^\s)]+)\)/gi,
    (_full, label, url) => `<a href="${escapeHtmlAttr(url)}">${label}</a>`
  );
  rendered = rendered.replace(/\*\*([^\n*][^*\n]*?)\*\*/g, "<b>$1</b>");
  rendered = rendered.replace(/__([^\n_][^_\n]*?)__/g, "<b>$1</b>");
  rendered = rendered.replace(/~~([^\n~][^~\n]*?)~~/g, "<s>$1</s>");
  rendered = rendered.replace(/(^|[\s(])\*([^*\n]+)\*(?=$|[\s).,!?:;])/g, "$1<i>$2</i>");
  rendered = rendered.replace(/(^|[\s(])_([^_\n]+)_(?=$|[\s).,!?:;])/g, "$1<i>$2</i>");
  rendered = rendered.replace(/\u0000CODE_(\d+)\u0000/g, (_full, idx) => {
    const index = Number.parseInt(String(idx), 10);
    return placeholders[index] ?? "";
  });
  return rendered;
}
function renderMarkdownLinesToHtml(input) {
  if (input === "") {
    return "";
  }
  return input.split("\n").map((line) => {
    const heading = line.match(/^\s{0,3}#{1,6}\s+(.+)$/);
    if (heading) {
      return `<b>${renderInlineMarkdownToHtml(heading[1].trim())}</b>`;
    }
    const bullet = line.match(/^(\s*)[-*]\s+(.+)$/);
    if (bullet) {
      return `${bullet[1]}\u2022 ${renderInlineMarkdownToHtml(bullet[2])}`;
    }
    const numbered = line.match(/^(\s*)(\d+)\.\s+(.+)$/);
    if (numbered) {
      return `${numbered[1]}${numbered[2]}. ${renderInlineMarkdownToHtml(numbered[3])}`;
    }
    const quote = line.match(/^>\s?(.*)$/);
    if (quote) {
      const body = quote[1] ? renderInlineMarkdownToHtml(quote[1]) : "";
      return body ? `&gt; ${body}` : "&gt;";
    }
    return renderInlineMarkdownToHtml(line);
  }).join("\n");
}
function renderMarkdownToTelegramHtml(input) {
  if (!input || input.trim() === "") {
    return input;
  }
  let result = "";
  let cursor = 0;
  const codeBlockPattern = /```([a-zA-Z0-9_+-]+)?\n?([\s\S]*?)```/g;
  const renderTextFenceAsQuote = (body) => {
    const normalized = body.replace(/\r\n/g, "\n").trimEnd();
    if (normalized === "") {
      return "<blockquote> </blockquote>";
    }
    const quoted = normalized.split("\n").map((line) => renderInlineMarkdownToHtml(line)).join("\n");
    return `<blockquote>${quoted}</blockquote>`;
  };
  for (const match of input.matchAll(codeBlockPattern)) {
    if (typeof match.index !== "number") {
      continue;
    }
    const start = match.index;
    const end = start + match[0].length;
    const before = input.slice(cursor, start);
    result += renderMarkdownLinesToHtml(before);
    const language = match[1] ? String(match[1]).trim() : "";
    const codeBody = String(match[2] ?? "");
    const languageLower = language.toLowerCase();
    if (languageLower === "text" || languageLower === "quote" || languageLower === "blockquote") {
      result += renderTextFenceAsQuote(codeBody);
    } else {
      const escapedCode = escapeHtml(codeBody);
      result += language ? `<pre><code class="language-${escapeHtmlAttr(language)}">${escapedCode}</code></pre>` : `<pre><code>${escapedCode}</code></pre>`;
    }
    cursor = end;
  }
  result += renderMarkdownLinesToHtml(input.slice(cursor));
  return result;
}
function composeReplyContextText(message) {
  const reply = message.replyContext;
  if (!reply) {
    return void 0;
  }
  const lines = [];
  if (reply.fromName) {
    lines.push(`From: ${reply.fromName}`);
  }
  lines.push(`Message ID: ${reply.messageId}`);
  const replyText = normalizeTextInput(reply.text, reply.caption);
  if (replyText !== "") {
    lines.push(`Quoted text: ${trimWithEllipsis(replyText, 1500)}`);
  }
  if (reply.hasPhoto) {
    lines.push("Quoted media: photo");
  }
  if (reply.documentName || reply.documentMime) {
    lines.push(
      `Quoted document: ${reply.documentName || "unnamed"}${reply.documentMime ? ` (${reply.documentMime})` : ""}`
    );
  }
  return lines.join("\n");
}
function sleep(ms) {
  return new Promise((resolve3) => {
    setTimeout(resolve3, ms);
  });
}
function parseTelegramErrorMeta(error) {
  const anyError = error;
  const message = safeErrorMessage(error);
  const description = typeof anyError?.description === "string" ? anyError.description : "";
  const errorCode = typeof anyError?.error_code === "number" ? anyError.error_code : void 0;
  const retryAfterRaw = anyError?.parameters?.retry_after;
  const retryAfterFromParams = typeof retryAfterRaw === "number" && Number.isFinite(retryAfterRaw) ? Math.max(0, Math.round(retryAfterRaw * 1e3)) : void 0;
  let retryAfterMs = retryAfterFromParams;
  if (typeof retryAfterMs === "undefined") {
    const combined = `${description} ${message}`.toLowerCase();
    const match = combined.match(/retry after\s+(\d+)/i);
    if (match) {
      const sec = Number.parseInt(match[1], 10);
      if (!Number.isNaN(sec)) {
        retryAfterMs = Math.max(0, sec * 1e3);
      }
    }
  }
  return {
    message,
    description,
    errorCode,
    retryAfterMs
  };
}
function isTopicNotModifiedMeta(meta) {
  const combined = `${meta.message} ${meta.description}`.toLowerCase();
  return combined.includes("topic_not_modified") || combined.includes("topic not modified");
}
function isMessageNotModifiedMeta(meta) {
  const combined = `${meta.message} ${meta.description}`.toLowerCase();
  return combined.includes("message is not modified");
}
function isFloodMeta(meta) {
  if (meta.errorCode === 429) {
    return true;
  }
  if (typeof meta.retryAfterMs === "number") {
    return true;
  }
  const combined = `${meta.message} ${meta.description}`.toLowerCase();
  return combined.includes("too many requests") || combined.includes("flood");
}
function isParseEntitiesMeta(meta) {
  const combined = `${meta.message} ${meta.description}`.toLowerCase();
  return combined.includes("can't parse entities") || combined.includes("can't find end tag");
}
function formatPermissionPattern(pattern) {
  if (typeof pattern === "string" && pattern.trim() !== "") {
    return pattern.trim();
  }
  if (Array.isArray(pattern)) {
    const values = pattern.map((item) => String(item ?? "").trim()).filter(Boolean);
    if (values.length > 0) {
      return values.join(", ");
    }
  }
  return void 0;
}
function formatPermissionMessage(permission) {
  const type = String(permission?.type ?? "unknown");
  const title = String(permission?.title ?? "Permission required");
  const pattern = formatPermissionPattern(permission?.pattern);
  const created = Number(permission?.time?.created ?? 0);
  const lines = [
    `Permission required: ${type}`,
    `Title: ${title}`,
    permission?.id ? `Permission ID: ${String(permission.id)}` : "",
    pattern ? `Pattern: ${pattern}` : "",
    Number.isFinite(created) && created > 0 ? `Created: ${formatDateTime(created)}` : "",
    "Choose action:"
  ];
  return lines.filter(Boolean).join("\n");
}
function flattenPromptParts(parts) {
  const textChunks = [];
  const files = [];
  for (const part of parts) {
    if (part.type === "text") {
      const value = String(part.text ?? "").trim();
      if (value !== "") {
        textChunks.push(value);
      }
      continue;
    }
    files.push(part);
  }
  return {
    text: textChunks.join("\n\n").trim(),
    files
  };
}
function mergePrompts(left, right) {
  const leftFlat = flattenPromptParts(left.parts);
  const rightFlat = flattenPromptParts(right.parts);
  const mergedText = [leftFlat.text, rightFlat.text].filter(Boolean).join("\n\n---\n\n").trim();
  const mergedParts = [];
  if (mergedText !== "") {
    mergedParts.push({
      type: "text",
      text: mergedText
    });
  }
  mergedParts.push(...leftFlat.files, ...rightFlat.files);
  return {
    sourceMessageId: left.sourceMessageId,
    replyToMessageId: left.replyToMessageId,
    userId: left.userId,
    createdAt: right.createdAt,
    mediaGroupId: left.mediaGroupId || right.mediaGroupId,
    parts: mergedParts
  };
}
var TelegramForumBridge = class {
  config;
  clientFactory;
  bot;
  store;
  runtime = /* @__PURE__ */ new Map();
  threadLocks = /* @__PURE__ */ new Map();
  topicNameState = /* @__PURE__ */ new Map();
  permissionMessages = /* @__PURE__ */ new Map();
  profileCache;
  constructor(config, bot) {
    this.config = config;
    this.clientFactory = new AuthenticatedOpencodeClientFactory(config);
    this.bot = bot;
    this.store = new TopicSessionStore(config.stateFilePath);
  }
  async handleInboundMessage(message) {
    const key = `${message.chatId}:${message.threadId ?? 0}`;
    await this.runThreadLock(key, async () => {
      const command = parseOcCommand(message.text ?? "");
      if (command) {
        await this.handleCommand(message, command.name, command.args);
        return;
      }
      if (typeof message.threadId !== "number") {
        await this.bot.sendMessage({
          chatId: message.chatId,
          text: "Use /oc new <absolute_workspace_path> in this chat to create a session topic.",
          replyToMessageId: message.messageId
        });
        return;
      }
      const binding = this.store.getByThread(message.chatId, message.threadId);
      if (!binding || binding.state === "closed") {
        await this.bot.sendMessage({
          chatId: message.chatId,
          threadId: message.threadId,
          text: "Topic is not bound to an OpenCode session. Use /oc new <path>.",
          replyToMessageId: message.messageId
        });
        return;
      }
      const prompt = await this.buildPrompt(message);
      if (!prompt) {
        await this.bot.sendMessage({
          chatId: message.chatId,
          threadId: message.threadId,
          text: "Message ignored: empty content and no supported attachments.",
          replyToMessageId: message.messageId
        });
        return;
      }
      await this.enqueuePrompt(binding, prompt);
    });
  }
  async handleEvent(event) {
    const eventType = String(event?.type ?? "");
    if (eventType === "session.updated") {
      const sessionId = String(event?.properties?.info?.id ?? "");
      if (!sessionId) {
        return;
      }
      const binding = this.store.patchBySession(sessionId, {
        sessionTitle: event?.properties?.info?.title
      });
      if (binding) {
        await this.updateTopicName(binding);
      }
      return;
    }
    if (eventType === "message.updated") {
      const info = event?.properties?.info;
      if (!info) {
        return;
      }
      if (info.role === "assistant" && typeof info.sessionID === "string") {
        const state = this.getRuntime(info.sessionID);
        state.lastAssistantMessageId = info.id;
      }
      if (info.role === "assistant" && info.error && typeof info.sessionID === "string") {
        const binding = this.store.getBySession(info.sessionID);
        if (binding) {
          await this.sendToSessionThread(
            binding,
            `Error: ${parseErrorPayload(info.error?.data?.message ?? info.error)}`
          );
        }
      }
      return;
    }
    if (eventType === "message.part.updated") {
      const part = event?.properties?.part;
      const delta = String(event?.properties?.delta ?? "");
      const sessionId = String(part?.sessionID ?? "");
      if (!sessionId) {
        return;
      }
      const binding = this.store.getBySession(sessionId);
      if (!binding) {
        return;
      }
      const runtime = this.getRuntime(sessionId);
      if (!runtime.inFlight) {
        return;
      }
      this.captureLivePart(runtime, part, delta);
      await this.refreshLiveProgress(binding);
      return;
    }
    if (eventType === "permission.updated" || eventType === "permission.ask" || eventType === "permission.required") {
      const props = event?.properties ?? {};
      const permission = props?.permission ?? props?.data?.permission ?? props;
      const sessionId = String(
        permission?.sessionID ?? permission?.sessionId ?? props?.sessionID ?? props?.sessionId ?? ""
      );
      const permissionId = String(
        permission?.id ?? permission?.permissionID ?? permission?.permissionId ?? props?.permissionID ?? props?.permissionId ?? ""
      );
      if (!sessionId || !permissionId) {
        console.warn(
          "[Bridge] Permission event missing sessionId/permissionId:",
          eventType,
          JSON.stringify(event?.properties ?? {})
        );
        return;
      }
      const binding = this.store.getBySession(sessionId);
      if (!binding) {
        console.warn(
          `[Bridge] Permission event for unmapped session ${sessionId}: ${permissionId}`
        );
        return;
      }
      const tracked = this.permissionMessages.get(permissionId);
      if (tracked) {
        const edited = await this.editMessageWithFloodRetry({
          chatId: tracked.chatId,
          messageId: tracked.messageId,
          text: formatPermissionMessage(permission),
          inlineKeyboard: this.buildPermissionKeyboard(permissionId)
        });
        if (edited) {
          return;
        }
        this.permissionMessages.delete(permissionId);
      }
      const sentMessageId = await this.sendPermissionRequestWithRetry(
        binding,
        permissionId,
        formatPermissionMessage(permission)
      );
      if (sentMessageId) {
        this.permissionMessages.set(permissionId, {
          chatId: binding.chatId,
          threadId: binding.threadId,
          messageId: sentMessageId
        });
      }
      return;
    }
    if (eventType === "permission.replied") {
      const props = event?.properties ?? {};
      const payload = props?.permission ?? props?.data?.permission ?? props;
      const sessionId = String(
        payload?.sessionID ?? payload?.sessionId ?? props?.sessionID ?? props?.sessionId ?? ""
      );
      const permissionId = String(
        payload?.permissionID ?? payload?.permissionId ?? payload?.id ?? props?.permissionID ?? props?.permissionId ?? ""
      );
      const response = String(payload?.response ?? props?.response ?? "");
      if (!sessionId || !permissionId) {
        console.warn(
          "[Bridge] Permission reply event missing sessionId/permissionId:",
          JSON.stringify(event?.properties ?? {})
        );
        return;
      }
      const binding = this.store.getBySession(sessionId);
      if (!binding) {
        console.warn(
          `[Bridge] Permission reply for unmapped session ${sessionId}: ${permissionId}`
        );
        return;
      }
      const tracked = this.permissionMessages.get(permissionId);
      if (tracked) {
        const edited = await this.editMessageWithFloodRetry({
          chatId: tracked.chatId,
          messageId: tracked.messageId,
          text: `Permission handled: ${permissionId}
Response: ${response || "unknown"}`
        });
        if (edited) {
          this.permissionMessages.delete(permissionId);
          return;
        }
        this.permissionMessages.delete(permissionId);
      }
      await this.sendToSessionThread(
        binding,
        `Permission handled: ${permissionId} -> ${response || "unknown"}`
      );
      return;
    }
    if (eventType === "question.asked") {
      const sessionId = String(event?.properties?.sessionID ?? "");
      const binding = this.store.getBySession(sessionId);
      const questions = Array.isArray(event?.properties?.questions) ? event.properties.questions : [];
      if (!binding || questions.length === 0) {
        return;
      }
      const formatted = questions.map((question, index) => {
        const header = question?.header ? `${question.header}: ` : "";
        return `${index + 1}. ${header}${String(question?.question ?? "")}`;
      }).join("\n");
      await this.sendToSessionThread(binding, `Question from OpenCode:
${formatted}`);
      return;
    }
    if (eventType === "session.status") {
      const sessionId = String(event?.properties?.sessionID ?? "");
      const binding = this.store.getBySession(sessionId);
      if (!binding) {
        return;
      }
      const runtime = this.getRuntime(sessionId);
      if (!runtime.inFlight) {
        return;
      }
      const statusType = String(event?.properties?.status?.type ?? "");
      if (statusType === "busy") {
        runtime.liveStage = "busy";
      } else if (statusType === "retry") {
        const attempt = Number(event?.properties?.status?.attempt ?? 0);
        runtime.liveStage = attempt > 0 ? `retry #${attempt}` : "retry";
      } else if (statusType === "idle") {
        runtime.liveStage = "finalizing";
      }
      await this.refreshLiveProgress(binding);
      return;
    }
    if (eventType === "session.idle") {
      return;
    }
    if (eventType === "session.error") {
      const sessionId = String(event?.properties?.sessionID ?? "");
      const binding = this.store.getBySession(sessionId);
      if (!binding) {
        return;
      }
      const runtime = this.getRuntime(sessionId);
      if (!runtime.inFlight) {
        return;
      }
      const rawError = parseErrorPayload(
        event?.properties?.error?.data?.message ?? event?.properties?.error
      );
      await this.onSessionError(binding, rawError);
    }
  }
  async handleCommand(message, commandName, args) {
    const threadId = message.threadId;
    if (commandName === "new") {
      await this.commandNew(message, args);
      return;
    }
    if (commandName === "import") {
      await this.commandImport(message, args);
      return;
    }
    if (commandName === "status") {
      if (typeof threadId !== "number") {
        await this.bot.sendMessage({
          chatId: message.chatId,
          text: "Use /oc status inside a session topic.",
          replyToMessageId: message.messageId
        });
        return;
      }
      const binding = this.store.getByThread(message.chatId, threadId);
      if (!binding) {
        await this.bot.sendMessage({
          chatId: message.chatId,
          threadId,
          text: "No mapped session in this topic."
        });
        return;
      }
      const runtime = this.getRuntime(binding.sessionId);
      await this.sendToSessionThread(
        binding,
        [
          `Status: ${binding.state}`,
          `Workspace: ${binding.workspacePath}`,
          `Session: ${binding.sessionId}`,
          ...formatSessionProfile({
            model: binding.model,
            reasoningEffort: binding.reasoningEffort,
            reasoningSummary: binding.reasoningSummary,
            textVerbosity: binding.textVerbosity
          }),
          "",
          ...profileLegendLines(),
          `Pending queue: ${runtime.pending.length}`,
          binding.lastError ? `Last error: ${binding.lastError}` : ""
        ].filter(Boolean).join("\n"),
        this.buildSettingsKeyboard(binding)
      );
      return;
    }
    if (commandName === "set") {
      await this.commandSet(message, args);
      return;
    }
    if (commandName === "rename") {
      await this.commandRename(message, args);
      return;
    }
    if (commandName === "undo") {
      await this.commandRevert(message, "undo");
      return;
    }
    if (commandName === "redo") {
      await this.commandRevert(message, "redo");
      return;
    }
    if (commandName === "sessions") {
      await this.commandImportList(message, 12, 0);
      return;
    }
    if (commandName === "perm" || commandName === "permission") {
      await this.commandPermission(message, args);
      return;
    }
    if (commandName === "stop") {
      if (typeof threadId !== "number") {
        return;
      }
      const binding = this.store.getByThread(message.chatId, threadId);
      if (!binding) {
        return;
      }
      await this.expectOk(
        this.getClient(binding.workspacePath).session.abort({
          path: { id: binding.sessionId }
        })
      );
      const runtime = this.getRuntime(binding.sessionId);
      runtime.inFlight = false;
      await this.upsertProgress(
        binding,
        [
          "Status: aborted",
          `Session: ${binding.sessionId}`,
          `Model: ${modelDisplayName(binding.model)}`,
          shortPreferences(binding)
        ].join("\n")
      );
      return;
    }
    if (commandName === "close") {
      if (typeof threadId !== "number") {
        return;
      }
      const binding = this.store.closeByThread(message.chatId, threadId);
      if (!binding) {
        return;
      }
      await this.updateTopicName(binding);
      await this.sendToSessionThread(binding, "Session mapping closed for this topic.");
      return;
    }
    await this.bot.sendMessage({
      chatId: message.chatId,
      threadId,
      text: "Commands:\n/oc new <absolute_workspace_path>\n/oc import list\n/oc import <session_id>\n/oc sessions\n/oc status\n/oc set <model|effort|summary|verbosity> <value>\n/oc perm <permission_id> <once|always|reject>\n/oc rename <title>\n/oc undo\n/oc redo\n/oc stop\n/oc close",
      replyToMessageId: message.messageId
    });
  }
  async commandImport(message, args) {
    const normalized = args.trim();
    const listMatch = normalized.match(/^list(?:\s+(\d+))?(?:\s+(\d+))?$/i);
    if (normalized === "" || listMatch) {
      const limitRaw = listMatch?.[1] ? Number.parseInt(listMatch[1], 10) : 12;
      const offsetRaw = listMatch?.[2] ? Number.parseInt(listMatch[2], 10) : 0;
      const limit = Number.isNaN(limitRaw) ? 12 : limitRaw;
      const offset = Number.isNaN(offsetRaw) ? 0 : offsetRaw;
      await this.commandImportList(message, limit, offset);
      return;
    }
    await this.commandImportById(message, normalized);
  }
  async commandSet(message, args) {
    if (typeof message.threadId !== "number") {
      await this.bot.sendMessage({
        chatId: message.chatId,
        text: "Use /oc set inside a session topic.",
        replyToMessageId: message.messageId
      });
      return;
    }
    const binding = this.store.getByThread(message.chatId, message.threadId);
    if (!binding || binding.state === "closed") {
      await this.bot.sendMessage({
        chatId: message.chatId,
        threadId: message.threadId,
        text: "No mapped session in this topic."
      });
      return;
    }
    const [rawKey, rawValue] = args.trim().split(/\s+/, 2);
    const key = (rawKey || "").toLowerCase();
    const value = (rawValue || "").toLowerCase();
    if (!key || !value) {
      await this.sendToSessionThread(
        binding,
        "Usage: /oc set <model|effort|summary|verbosity> <value>"
      );
      return;
    }
    const patch = {};
    if (key === "model") {
      if (!["gpt-5.3-codex", "gpt-5.2-codex"].includes(value)) {
        await this.sendToSessionThread(
          binding,
          "Allowed model values in this bridge: gpt-5.3-codex, gpt-5.2-codex"
        );
        return;
      }
      patch.model = { ...binding.model, modelID: value };
    } else if (key === "effort" || key === "reasoning_effort") {
      const normalizedEffort = this.normalizeEffortValue(value);
      if (!normalizedEffort) {
        await this.sendToSessionThread(
          binding,
          "Allowed effort values: low, medium, high, xhigh, none (aliases: extra_high, extra-high, x-high)"
        );
        return;
      }
      patch.reasoningEffort = normalizedEffort;
    } else if (key === "summary" || key === "reasoning_summary") {
      if (!["auto", "none", "detailed"].includes(value)) {
        await this.sendToSessionThread(
          binding,
          "Allowed summary values: auto, none, detailed"
        );
        return;
      }
      patch.reasoningSummary = value;
    } else if (key === "verbosity" || key === "text_verbosity") {
      if (!["low", "medium", "high"].includes(value)) {
        await this.sendToSessionThread(
          binding,
          "Allowed verbosity values: low, medium, high"
        );
        return;
      }
      patch.textVerbosity = value;
    } else {
      await this.sendToSessionThread(
        binding,
        "Unknown key. Use: model, effort, summary, verbosity"
      );
      return;
    }
    const updated = this.store.patchBySession(binding.sessionId, patch);
    if (!updated) {
      await this.sendToSessionThread(binding, "Failed to update settings.");
      return;
    }
    await this.sendToSessionThread(
      updated,
      [
        "Session settings updated.",
        ...formatSessionProfile({
          model: updated.model,
          reasoningEffort: updated.reasoningEffort,
          reasoningSummary: updated.reasoningSummary,
          textVerbosity: updated.textVerbosity
        }),
        "",
        ...profileLegendLines()
      ].join("\n"),
      this.buildSettingsKeyboard(updated)
    );
  }
  async commandPermission(message, args) {
    if (typeof message.threadId !== "number") {
      await this.bot.sendMessage({
        chatId: message.chatId,
        text: "Use /oc perm inside a session topic.",
        replyToMessageId: message.messageId
      });
      return;
    }
    const binding = this.store.getByThread(message.chatId, message.threadId);
    if (!binding || binding.state === "closed") {
      await this.bot.sendMessage({
        chatId: message.chatId,
        threadId: message.threadId,
        text: "No mapped session in this topic."
      });
      return;
    }
    const parts = args.trim().split(/\s+/).filter(Boolean);
    const permissionId = parts[0] ?? "";
    const rawResponse = (parts[1] ?? "").toLowerCase();
    const response = rawResponse === "deny" ? "reject" : rawResponse;
    if (!permissionId || !["once", "always", "reject"].includes(response)) {
      await this.sendToSessionThread(
        binding,
        "Usage: /oc perm <permission_id> <once|always|reject>"
      );
      return;
    }
    try {
      await this.expectData(
        this.getClient(binding.workspacePath).postSessionIdPermissionsPermissionId({
          path: {
            id: binding.sessionId,
            permissionID: permissionId
          },
          body: {
            response
          }
        })
      );
      const tracked = this.permissionMessages.get(permissionId);
      if (tracked) {
        try {
          await this.bot.editMessage({
            chatId: tracked.chatId,
            messageId: tracked.messageId,
            text: `Permission handled: ${permissionId}
Response: ${response}`
          });
          this.permissionMessages.delete(permissionId);
        } catch {
        }
      }
      await this.sendToSessionThread(
        binding,
        `Permission response sent: ${permissionId} -> ${response}`
      );
    } catch (error) {
      await this.sendToSessionThread(
        binding,
        `Failed to respond to permission: ${safeErrorMessage(error)}`
      );
    }
  }
  async commandRename(message, args) {
    if (typeof message.threadId !== "number") {
      await this.bot.sendMessage({
        chatId: message.chatId,
        text: "Use /oc rename inside a session topic.",
        replyToMessageId: message.messageId
      });
      return;
    }
    const binding = this.store.getByThread(message.chatId, message.threadId);
    if (!binding || binding.state === "closed") {
      await this.bot.sendMessage({
        chatId: message.chatId,
        threadId: message.threadId,
        text: "No mapped session in this topic."
      });
      return;
    }
    const title = args.trim();
    if (!title) {
      await this.sendToSessionThread(binding, "Usage: /oc rename <title>");
      return;
    }
    try {
      const updatedSession = await this.expectData(
        this.getClient(binding.workspacePath).session.update({
          path: { id: binding.sessionId },
          body: { title }
        })
      );
      const updated = this.store.patchBySession(binding.sessionId, {
        sessionTitle: updatedSession.title || title
      });
      await this.updateTopicName(updated ?? binding);
      await this.sendToSessionThread(
        updated ?? binding,
        `Session renamed to: ${updatedSession.title || title}`
      );
    } catch (error) {
      await this.sendToSessionThread(
        binding,
        `Failed to rename session: ${safeErrorMessage(error)}`
      );
    }
  }
  async commandRevert(message, mode) {
    if (typeof message.threadId !== "number") {
      await this.bot.sendMessage({
        chatId: message.chatId,
        text: `Use /oc ${mode} inside a session topic.`,
        replyToMessageId: message.messageId
      });
      return;
    }
    const binding = this.store.getByThread(message.chatId, message.threadId);
    if (!binding || binding.state === "closed") {
      await this.bot.sendMessage({
        chatId: message.chatId,
        threadId: message.threadId,
        text: "No mapped session in this topic."
      });
      return;
    }
    try {
      if (mode === "undo") {
        await this.expectOk(
          this.getClient(binding.workspacePath).session.revert({
            path: { id: binding.sessionId }
          })
        );
      } else {
        await this.expectOk(
          this.getClient(binding.workspacePath).session.unrevert({
            path: { id: binding.sessionId }
          })
        );
      }
      await this.sendToSessionThread(
        binding,
        mode === "undo" ? "Undo applied." : "Redo applied."
      );
    } catch (error) {
      await this.sendToSessionThread(
        binding,
        `Failed to ${mode}: ${safeErrorMessage(error)}`
      );
    }
  }
  async commandImportList(message, limit, offset) {
    const sessions = await this.collectSessions();
    if (sessions.length === 0) {
      await this.bot.sendMessage({
        chatId: message.chatId,
        threadId: message.threadId,
        text: "No sessions found in allowed workspace roots."
      });
      return;
    }
    const pageSize = Math.max(1, Math.min(limit, 20));
    const safeOffset = Math.max(
      0,
      Math.min(offset, Math.max(0, sessions.length - 1))
    );
    const selected = sessions.slice(safeOffset, safeOffset + pageSize);
    const rows = selected.map((session, index) => {
      const mapped = this.store.getBySession(session.id);
      const mapFlag = mapped ? "mapped" : "free";
      const updated = new Date(session.updatedAt).toISOString().replace("T", " ").slice(0, 16);
      return `${safeOffset + index + 1}. ${session.id} | ${workspaceLabel(session.directory)} | ${mapFlag} | ${updated}
   ${session.title}`;
    }).join("\n\n");
    const inlineKeyboard = selected.map((session, index) => {
      const title = session.title?.trim() || workspaceLabel(session.directory);
      const label = truncateButtonText(`${safeOffset + index + 1}. ${title}`);
      return [{ text: label, callbackData: `ocimp:${session.id}` }];
    });
    const navRow = [];
    if (safeOffset > 0) {
      navRow.push({
        text: "Prev",
        callbackData: `ocimp:list:${pageSize}:${Math.max(0, safeOffset - pageSize)}`
      });
    }
    if (safeOffset + pageSize < sessions.length) {
      navRow.push({
        text: "Next",
        callbackData: `ocimp:list:${pageSize}:${safeOffset + pageSize}`
      });
    }
    if (navRow.length > 0) {
      inlineKeyboard.push(navRow);
    }
    inlineKeyboard.push([
      { text: "Refresh", callbackData: `ocimp:list:${pageSize}:${safeOffset}` }
    ]);
    await this.bot.sendMessage({
      chatId: message.chatId,
      threadId: message.threadId,
      text: `Sessions available for import (${safeOffset + 1}-${Math.min(safeOffset + pageSize, sessions.length)} of ${sessions.length}):

${rows}

Tap a button to import that session into this topic, or use /oc import <session_id>.`,
      inlineKeyboard
    });
  }
  async commandImportById(message, sessionId) {
    const found = await this.findSessionById(sessionId);
    if (!found) {
      await this.bot.sendMessage({
        chatId: message.chatId,
        threadId: message.threadId,
        text: `Session not found in allowed roots: ${sessionId}`
      });
      return;
    }
    const resolvedPath = realpathSync(found.directory);
    if (!isPathWithinRoots(resolvedPath, this.config.allowedWorkspaceRoots)) {
      await this.bot.sendMessage({
        chatId: message.chatId,
        threadId: message.threadId,
        text: `Session directory is outside allowed roots: ${resolvedPath}`
      });
      return;
    }
    const target = typeof message.threadId === "number" ? {
      threadId: message.threadId,
      usedCurrentThreadFallback: true
    } : await this.resolveTargetThread(message, resolvedPath, found.title);
    if (!target) {
      return;
    }
    const existing = this.store.getByThread(message.chatId, target.threadId);
    if (existing && existing.state !== "closed") {
      await this.bot.sendMessage({
        chatId: message.chatId,
        threadId: target.threadId,
        text: "This topic is already bound to an active session. Use /oc status or /oc close first."
      });
      return;
    }
    const profile = await this.resolveSessionProfile(resolvedPath, found.id);
    const binding = {
      chatId: message.chatId,
      threadId: target.threadId,
      workspacePath: resolvedPath,
      sessionId: found.id,
      state: "idle",
      model: profile.model,
      reasoningEffort: profile.reasoningEffort,
      reasoningSummary: profile.reasoningSummary,
      textVerbosity: profile.textVerbosity,
      createdBy: message.userId,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      sessionTitle: found.title
    };
    this.store.upsert(binding);
    this.getRuntime(binding.sessionId);
    await this.updateTopicName(binding);
    await this.sendToSessionThread(
      binding,
      [
        target.usedCurrentThreadFallback ? "Imported existing OpenCode session into current topic." : "Imported existing OpenCode session.",
        `Workspace: ${binding.workspacePath}`,
        `Session: ${binding.sessionId}`,
        ...formatSessionProfile(profile),
        "",
        ...profileLegendLines(),
        "Send your prompt in this topic."
      ].join("\n"),
      this.buildSettingsKeyboard(binding)
    );
  }
  async commandNew(message, args) {
    if (!args) {
      await this.bot.sendMessage({
        chatId: message.chatId,
        threadId: message.threadId,
        text: "Usage: /oc new <absolute_workspace_path>",
        replyToMessageId: message.messageId
      });
      return;
    }
    const requestedPath = ensureAbsolutePath(args);
    const resolvedPath = realpathSync(requestedPath);
    if (!isPathWithinRoots(resolvedPath, this.config.allowedWorkspaceRoots)) {
      await this.bot.sendMessage({
        chatId: message.chatId,
        threadId: message.threadId,
        text: `Path is outside allowed roots: ${resolvedPath}`
      });
      return;
    }
    const target = await this.resolveTargetThread(message, resolvedPath, "creating");
    if (!target) {
      return;
    }
    const existing = this.store.getByThread(message.chatId, target.threadId);
    if (existing && existing.state !== "closed") {
      await this.bot.sendMessage({
        chatId: message.chatId,
        threadId: target.threadId,
        text: "This topic is already bound to an active session. Use /oc status or /oc close first."
      });
      return;
    }
    try {
      const created = await this.expectData(
        this.getClient(resolvedPath).session.create({
          body: {
            title: `Telegram ${workspaceLabel(resolvedPath)} ${(/* @__PURE__ */ new Date()).toISOString()}`
          }
        })
      );
      const profile = await this.getDefaultProfile(resolvedPath);
      const binding = {
        chatId: message.chatId,
        threadId: target.threadId,
        workspacePath: resolvedPath,
        sessionId: created.id,
        state: "idle",
        model: profile.model,
        reasoningEffort: profile.reasoningEffort,
        reasoningSummary: profile.reasoningSummary,
        textVerbosity: profile.textVerbosity,
        createdBy: message.userId,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        sessionTitle: created.title
      };
      this.store.upsert(binding);
      this.getRuntime(binding.sessionId);
      await this.updateTopicName(binding);
      await this.sendToSessionThread(
        binding,
        [
          target.usedCurrentThreadFallback ? "OpenCode session created in current topic." : "OpenCode session created.",
          `Workspace: ${binding.workspacePath}`,
          `Session: ${binding.sessionId}`,
          ...formatSessionProfile(profile),
          "",
          ...profileLegendLines(),
          "Send your prompt in this topic."
        ].join("\n"),
        this.buildSettingsKeyboard(binding)
      );
    } catch (error) {
      const errorText = safeErrorMessage(error);
      await this.bot.sendMessage({
        chatId: message.chatId,
        threadId: target.threadId,
        text: `Failed to create OpenCode session: ${errorText}`
      });
    }
  }
  async resolveTargetThread(message, workspacePath, titleLabel) {
    try {
      const topic = await this.bot.createForumTopic(
        message.chatId,
        truncateTopicName(`${workspaceLabel(workspacePath)} | ${titleLabel}`)
      );
      return {
        threadId: topic.message_thread_id,
        usedCurrentThreadFallback: false
      };
    } catch (error) {
      const errorText = safeErrorMessage(error);
      if (typeof message.threadId === "number" && isTopicCreationPermissionError(errorText)) {
        await this.bot.sendMessage({
          chatId: message.chatId,
          threadId: message.threadId,
          text: "Bot has no rights to create new topics, using current topic for this session."
        });
        return {
          threadId: message.threadId,
          usedCurrentThreadFallback: true
        };
      }
      await this.bot.sendMessage({
        chatId: message.chatId,
        threadId: message.threadId,
        text: `Failed to create forum topic: ${errorText}`
      });
      return void 0;
    }
  }
  async collectSessions() {
    const all = [];
    for (const root of this.config.allowedWorkspaceRoots) {
      try {
        const list = await this.expectData(this.getClient(root).session.list());
        for (const item of list) {
          all.push({
            id: item.id,
            title: item.title,
            directory: item.directory,
            updatedAt: Number(item.time?.updated ?? item.time?.created ?? 0)
          });
        }
      } catch (error) {
        console.error(`[Bridge] Failed to list sessions for ${root}:`, error);
      }
    }
    const uniq = /* @__PURE__ */ new Map();
    for (const item of all) {
      const prev = uniq.get(item.id);
      if (!prev || item.updatedAt > prev.updatedAt) {
        uniq.set(item.id, item);
      }
    }
    return Array.from(uniq.values()).sort((a, b) => b.updatedAt - a.updatedAt);
  }
  async findSessionById(sessionId) {
    const sessions = await this.collectSessions();
    return sessions.find((session) => session.id === sessionId);
  }
  async resolveSessionProfile(directory, sessionId) {
    const profile = { ...await this.getDefaultProfile(directory) };
    try {
      const messages = await this.expectData(
        this.getClient(directory).session.messages({
          path: { id: sessionId },
          query: { limit: 200 }
        })
      );
      for (const entry of messages) {
        const info = entry?.info;
        if (info?.role === "user" && typeof info?.model?.providerID === "string" && typeof info?.model?.modelID === "string") {
          profile.model = {
            providerID: info.model.providerID,
            modelID: info.model.modelID
          };
          break;
        }
      }
    } catch (error) {
      console.error("[Bridge] Failed to resolve session profile:", error);
    }
    return profile;
  }
  async getDefaultProfile(directory) {
    if (this.profileCache) {
      return this.profileCache;
    }
    const fallback = {
      model: this.config.defaultModel,
      reasoningEffort: DEFAULT_REASONING_EFFORT
    };
    try {
      const configData = await this.expectData(
        this.getClient(directory).config.get()
      );
      const options = configData?.provider?.openai?.options;
      this.profileCache = {
        model: this.config.defaultModel,
        reasoningEffort: DEFAULT_REASONING_EFFORT,
        reasoningSummary: typeof options?.reasoningSummary === "string" ? options.reasoningSummary : void 0,
        textVerbosity: typeof options?.textVerbosity === "string" ? options.textVerbosity : void 0
      };
      return this.profileCache;
    } catch (error) {
      console.error("[Bridge] Failed to fetch default profile:", error);
      this.profileCache = fallback;
      return fallback;
    }
  }
  async buildPrompt(message) {
    const userText = normalizeTextInput(message.text, message.caption);
    const replyContextText = composeReplyContextText(message);
    const text = [
      replyContextText ? `Reply context:
${replyContextText}` : "",
      userText !== "" ? `User message:
${userText}` : ""
    ].filter(Boolean).join("\n\n").trim();
    const parts = [];
    if (text !== "") {
      parts.push({
        type: "text",
        text
      });
    }
    if (message.photoFileId) {
      const downloaded = await this.bot.downloadFile(message.photoFileId);
      if (downloaded.buffer.byteLength > this.config.maxAttachmentBytes) {
        throw new Error(
          `Photo exceeds TELEGRAM_MAX_ATTACHMENT_BYTES (${this.config.maxAttachmentBytes}).`
        );
      }
      const imageMime = downloaded.mime.startsWith("image/") ? downloaded.mime : "image/jpeg";
      parts.push({
        type: "file",
        mime: imageMime,
        filename: basename2(downloaded.filePath) || "telegram-photo.jpg",
        url: toDataUrl(imageMime, downloaded.buffer)
      });
    }
    if (message.document) {
      const downloaded = await this.bot.downloadFile(message.document.fileId);
      if (downloaded.buffer.byteLength > this.config.maxAttachmentBytes) {
        throw new Error(
          `Document exceeds TELEGRAM_MAX_ATTACHMENT_BYTES (${this.config.maxAttachmentBytes}).`
        );
      }
      const mime = message.document.mime || downloaded.mime || "application/octet-stream";
      parts.push({
        type: "file",
        mime,
        filename: message.document.filename || basename2(downloaded.filePath) || "telegram-document",
        url: toDataUrl(mime, downloaded.buffer)
      });
    }
    if (parts.length === 0) {
      return void 0;
    }
    return {
      sourceMessageId: message.messageId,
      replyToMessageId: message.replyContext?.messageId,
      userId: message.userId,
      createdAt: Date.now(),
      mediaGroupId: message.mediaGroupId,
      parts
    };
  }
  async enqueuePrompt(binding, prompt) {
    const runtime = this.getRuntime(binding.sessionId);
    if (runtime.inFlight) {
      const tail = runtime.pending.at(-1);
      if (tail && this.shouldCoalescePrompts(tail, prompt)) {
        runtime.pending[runtime.pending.length - 1] = mergePrompts(tail, prompt);
      } else {
        runtime.pending.push(prompt);
      }
      await this.refreshLiveProgress(binding);
      return;
    }
    if (runtime.stagedPrompt) {
      if (this.shouldCoalescePrompts(runtime.stagedPrompt, prompt)) {
        runtime.stagedPrompt = mergePrompts(runtime.stagedPrompt, prompt);
      } else {
        const previous = runtime.stagedPrompt;
        runtime.stagedPrompt = prompt;
        if (runtime.stagedTimer) {
          clearTimeout(runtime.stagedTimer);
          runtime.stagedTimer = void 0;
        }
        void this.dispatchPrompt(binding, previous);
      }
    } else {
      runtime.stagedPrompt = prompt;
    }
    if (!runtime.stagedTimer) {
      runtime.stagedTimer = setTimeout(() => {
        void this.flushStagedPrompt(binding).catch((error) => {
          console.error("[Bridge] Failed to flush staged prompt:", error);
        });
      }, PROMPT_COALESCE_MS);
    }
  }
  shouldCoalescePrompts(left, right) {
    if (left.userId !== right.userId) {
      return false;
    }
    if (left.mediaGroupId && right.mediaGroupId) {
      return left.mediaGroupId === right.mediaGroupId;
    }
    const delta = Math.abs(right.createdAt - left.createdAt);
    if (right.replyToMessageId === left.sourceMessageId) {
      return delta <= 3e4;
    }
    return delta <= PROMPT_COALESCE_MS;
  }
  async flushStagedPrompt(binding) {
    const runtime = this.getRuntime(binding.sessionId);
    if (runtime.stagedTimer) {
      clearTimeout(runtime.stagedTimer);
      runtime.stagedTimer = void 0;
    }
    const staged = runtime.stagedPrompt;
    runtime.stagedPrompt = void 0;
    if (!staged) {
      return;
    }
    if (runtime.inFlight) {
      const tail = runtime.pending.at(-1);
      if (tail && this.shouldCoalescePrompts(tail, staged)) {
        runtime.pending[runtime.pending.length - 1] = mergePrompts(tail, staged);
      } else {
        runtime.pending.push(staged);
      }
      return;
    }
    void this.dispatchPrompt(binding, staged);
  }
  async dispatchPrompt(binding, prompt) {
    const runtime = this.getRuntime(binding.sessionId);
    const effectiveModel = this.getEffectiveModel(binding);
    const systemPreferences = this.buildSystemPreferences(binding);
    const bodyParts = prompt.parts.map((part) => {
      if (part.type === "text") {
        return {
          type: "text",
          text: part.text ?? ""
        };
      }
      return {
        type: "file",
        mime: part.mime ?? "application/octet-stream",
        filename: part.filename,
        url: part.url ?? ""
      };
    });
    const retryingSamePrompt = runtime.lastPrompt?.sourceMessageId === prompt.sourceMessageId;
    runtime.inFlight = true;
    runtime.lastPrompt = prompt;
    if (!retryingSamePrompt) {
      runtime.retriedAfterCompaction = false;
    }
    runtime.lastDeliveredAssistantMessageId = "";
    runtime.liveStage = "starting";
    runtime.liveDetail = void 0;
    runtime.runStartedAt = Date.now();
    this.store.patchBySession(binding.sessionId, {
      state: "active",
      lastError: void 0
    });
    await this.updateTopicName(binding);
    this.startLiveProgress(binding);
    await this.refreshLiveProgress(binding);
    try {
      const response = await this.expectData(
        this.getClient(binding.workspacePath).session.prompt({
          path: { id: binding.sessionId },
          body: {
            model: effectiveModel,
            system: systemPreferences,
            parts: bodyParts
          }
        })
      );
      const responseError = response?.info?.error;
      if (responseError) {
        throw new Error(parseErrorPayload(responseError?.data?.message ?? responseError));
      }
      this.stopLiveProgress(binding.sessionId);
      runtime.inFlight = false;
      this.store.patchBySession(binding.sessionId, {
        state: "idle",
        lastError: void 0
      });
      await this.updateTopicName(binding);
      const duration = runtime.runStartedAt ? formatDurationSeconds(Date.now() - runtime.runStartedAt) : "n/a";
      await this.upsertProgress(
        binding,
        [
          "Status: done",
          `Session: ${binding.sessionId}`,
          `Model: ${modelDisplayName(binding.model)}`,
          shortPreferences(binding),
          `Duration: ${duration}`,
          `Finished: ${formatDateTime(Date.now())}`,
          `Queue: ${runtime.pending.length}`
        ].join("\n")
      );
      let assistantText = extractAssistantText(response.parts ?? []);
      if (assistantText === EMPTY_ASSISTANT_OUTPUT || assistantText.startsWith("Assistant ran tools but returned no final text yet:")) {
        const assistantFromList = await this.resolveLatestAssistantOutput(binding, runtime);
        if (assistantFromList && assistantFromList.text !== EMPTY_ASSISTANT_OUTPUT) {
          assistantText = assistantFromList.text;
          runtime.lastDeliveredAssistantMessageId = assistantFromList.messageId;
        } else {
          const finishReason = String(response?.info?.finish ?? "").trim();
          if (finishReason !== "") {
            assistantText = `Assistant finished (${finishReason}) without text output.`;
          }
        }
      }
      const chunks = splitMessage(assistantText);
      for (const chunk of chunks) {
        await this.sendToSessionThread(binding, chunk, void 0, "markdown");
      }
      if (!runtime.lastDeliveredAssistantMessageId) {
        runtime.lastDeliveredAssistantMessageId = String(response?.info?.id ?? "");
      }
      runtime.runStartedAt = void 0;
      const next = runtime.pending.shift();
      if (next) {
        void this.dispatchPrompt(binding, next);
      }
    } catch (error) {
      const errorText = safeErrorMessage(error);
      if (runtime.lastPrompt && !runtime.retriedAfterCompaction && detectContextOverflow(errorText)) {
        runtime.retriedAfterCompaction = true;
        runtime.liveStage = "context overflow";
        runtime.liveDetail = "summarize + retry";
        await this.refreshLiveProgress(binding);
        try {
          await this.expectData(
            this.getClient(binding.workspacePath).session.summarize({
              path: { id: binding.sessionId },
              body: binding.model
            })
          );
          await this.dispatchPrompt(binding, runtime.lastPrompt);
          return;
        } catch (summaryError) {
          this.stopLiveProgress(binding.sessionId);
          runtime.inFlight = false;
          this.store.patchBySession(binding.sessionId, {
            state: "error",
            lastError: safeErrorMessage(summaryError)
          });
          await this.updateTopicName(binding);
          await this.upsertProgress(
            binding,
            [
              "Status: error",
              `Session: ${binding.sessionId}`,
              `Model: ${modelDisplayName(binding.model)}`,
              shortPreferences(binding),
              `Compaction retry failed: ${safeErrorMessage(summaryError)}`
            ].join("\n")
          );
          const next2 = runtime.pending.shift();
          if (next2) {
            void this.dispatchPrompt(binding, next2);
          }
          return;
        }
      }
      this.stopLiveProgress(binding.sessionId);
      runtime.inFlight = false;
      this.store.patchBySession(binding.sessionId, {
        state: "error",
        lastError: errorText
      });
      await this.updateTopicName(binding);
      await this.upsertProgress(
        binding,
        [
          "Status: error",
          `Session: ${binding.sessionId}`,
          `Model: ${modelDisplayName(binding.model)}`,
          shortPreferences(binding),
          `Error: ${errorText}`
        ].join("\n")
      );
      const next = runtime.pending.shift();
      if (next) {
        void this.dispatchPrompt(binding, next);
      }
    }
  }
  async onSessionIdle(binding) {
    const runtime = this.getRuntime(binding.sessionId);
    this.stopLiveProgress(binding.sessionId);
    if (!runtime.inFlight) {
      const nextIfAny = runtime.pending.shift();
      if (nextIfAny) {
        await this.dispatchPrompt(binding, nextIfAny);
      }
      return;
    }
    runtime.inFlight = false;
    this.store.patchBySession(binding.sessionId, {
      state: "idle",
      lastError: void 0
    });
    await this.updateTopicName(binding);
    const duration = runtime.runStartedAt ? formatDurationSeconds(Date.now() - runtime.runStartedAt) : "n/a";
    await this.upsertProgress(
      binding,
      [
        "Status: done",
        `Session: ${binding.sessionId}`,
        `Model: ${modelDisplayName(binding.model)}`,
        shortPreferences(binding),
        `Duration: ${duration}`,
        `Finished: ${formatDateTime(Date.now())}`,
        `Queue: ${runtime.pending.length}`
      ].join("\n")
    );
    const assistant = await this.resolveLatestAssistantOutput(binding, runtime);
    if (assistant) {
      const chunks = splitMessage(assistant.text);
      for (const chunk of chunks) {
        await this.sendToSessionThread(binding, chunk, void 0, "markdown");
      }
      runtime.lastDeliveredAssistantMessageId = assistant.messageId;
    } else {
      await this.sendToSessionThread(
        binding,
        "No assistant output was returned for this run."
      );
    }
    runtime.runStartedAt = void 0;
    const next = runtime.pending.shift();
    if (next) {
      await this.dispatchPrompt(binding, next);
    }
  }
  async onSessionError(binding, errorText) {
    const runtime = this.getRuntime(binding.sessionId);
    this.stopLiveProgress(binding.sessionId);
    this.store.patchBySession(binding.sessionId, {
      state: "error",
      lastError: errorText
    });
    await this.updateTopicName(binding);
    await this.upsertProgress(
      binding,
      [
        "Status: error",
        `Session: ${binding.sessionId}`,
        `Model: ${modelDisplayName(binding.model)}`,
        shortPreferences(binding),
        `Error: ${errorText}`
      ].join("\n")
    );
    if (runtime.lastPrompt && !runtime.retriedAfterCompaction && detectContextOverflow(errorText)) {
      runtime.retriedAfterCompaction = true;
      await this.upsertProgress(
        binding,
        [
          "Status: context overflow",
          `Session: ${binding.sessionId}`,
          shortPreferences(binding),
          "Action: summarize + single retry"
        ].join("\n")
      );
      try {
        await this.expectData(
          this.getClient(binding.workspacePath).session.summarize({
            path: { id: binding.sessionId },
            body: binding.model
          })
        );
        await this.dispatchPrompt(binding, runtime.lastPrompt);
        return;
      } catch (error) {
        runtime.inFlight = false;
        await this.upsertProgress(
          binding,
          [
            "Status: error",
            `Session: ${binding.sessionId}`,
            shortPreferences(binding),
            `Compaction retry failed: ${safeErrorMessage(error)}`
          ].join("\n")
        );
        return;
      }
    }
    runtime.inFlight = false;
    const next = runtime.pending.shift();
    if (next) {
      await this.dispatchPrompt(binding, next);
    }
  }
  async resolveLatestAssistantOutput(binding, runtime) {
    try {
      const messages = await this.expectData(
        this.getClient(binding.workspacePath).session.messages({
          path: { id: binding.sessionId },
          query: { limit: 200 }
        })
      );
      const assistantMessages = messages.filter(
        (entry) => entry?.info?.role === "assistant"
      );
      const runStartedAt = Number(runtime.runStartedAt ?? 0);
      const scopedMessages = runStartedAt > 0 ? assistantMessages.filter(
        (entry) => Number(entry?.info?.time?.created ?? 0) >= runStartedAt - 5e3
      ) : assistantMessages;
      const messagePool = scopedMessages.length > 0 ? scopedMessages : assistantMessages;
      const scoreEntry = (entry) => {
        const info = entry?.info ?? {};
        const parts = Array.isArray(entry?.parts) ? entry.parts : [];
        const textLen = parts.filter((part) => part?.type === "text").map((part) => String(part?.text || "").trim().length).reduce((sum, value) => sum + value, 0);
        const fileCount = parts.filter((part) => part?.type === "file").length;
        const reasoningLen = parts.filter((part) => part?.type === "reasoning").map((part) => String(part?.text || "").trim().length).reduce((sum, value) => sum + value, 0);
        const hasRunningTool = parts.some(
          (part) => part?.type === "tool" && ["pending", "running"].includes(String(part?.state?.status || ""))
        );
        const completedAt = Number(info?.time?.completed ?? 0);
        const createdAt = Number(info?.time?.created ?? 0);
        const baseTime = completedAt || createdAt;
        let score = baseTime;
        if (textLen > 0) score += 3e12;
        else if (fileCount > 0) score += 2e12;
        else if (reasoningLen > 0) score += 1e12;
        else score += 1e11;
        if (hasRunningTool) score -= 5e11;
        return score;
      };
      const candidate = messagePool.filter(
        (entry) => String(entry?.info?.id ?? "") !== runtime.lastDeliveredAssistantMessageId
      ).sort((a, b) => scoreEntry(b) - scoreEntry(a))[0];
      if (!candidate) {
        return void 0;
      }
      const messageId = String(candidate?.info?.id ?? "");
      return {
        messageId,
        text: extractAssistantText(candidate?.parts ?? [])
      };
    } catch (error) {
      console.error("[Bridge] Failed to resolve assistant output from message list:", error);
      return void 0;
    }
  }
  async updateTopicName(binding) {
    const suffix = binding.state;
    const name = truncateTopicName(
      `${workspaceLabel(binding.workspacePath)} | ${shortSessionId(binding.sessionId)} | ${suffix}`
    );
    const key = `${binding.chatId}:${binding.threadId}`;
    const state = this.topicNameState.get(key) ?? {};
    if (state.lastName === name) {
      return;
    }
    const now = Date.now();
    if (state.nextAllowedAt && now < state.nextAllowedAt) {
      return;
    }
    try {
      await this.bot.editForumTopic(binding.chatId, binding.threadId, name);
      this.topicNameState.set(key, {
        lastName: name,
        nextAllowedAt: Date.now() + TOPIC_RENAME_MIN_MS
      });
    } catch (error) {
      const meta = parseTelegramErrorMeta(error);
      if (isTopicNotModifiedMeta(meta)) {
        this.topicNameState.set(key, {
          lastName: name,
          nextAllowedAt: Date.now() + TOPIC_RENAME_MIN_MS
        });
        return;
      }
      if (isFloodMeta(meta)) {
        const retryAfterMs = meta.retryAfterMs ?? TOPIC_RENAME_MIN_MS;
        this.topicNameState.set(key, {
          ...state,
          nextAllowedAt: Date.now() + retryAfterMs + FLOOD_JITTER_MS
        });
        console.warn(
          `[Bridge] Topic rename rate-limited for ${Math.max(
            1,
            Math.ceil((retryAfterMs + FLOOD_JITTER_MS) / 1e3)
          )}s`
        );
        return;
      }
      console.error("[Bridge] Failed to update topic name:", error);
    }
  }
  getEffectiveModel(binding) {
    const normalizedId = binding.model.modelID.replace(/-(none|low|medium|high|xhigh)$/, "");
    return {
      providerID: binding.model.providerID,
      modelID: normalizedId
    };
  }
  buildSystemPreferences(binding) {
    const hints = [];
    if (binding.reasoningEffort) {
      hints.push(`reasoning_effort=${binding.reasoningEffort}`);
    }
    if (binding.reasoningSummary) {
      hints.push(`reasoning_summary=${binding.reasoningSummary}`);
    }
    if (binding.textVerbosity) {
      hints.push(`text_verbosity=${binding.textVerbosity}`);
    }
    if (hints.length === 0) {
      return void 0;
    }
    return `Preference hints for this session: ${hints.join(", ")}.`;
  }
  buildSettingsKeyboard(binding) {
    const model = (binding.model.modelID || "").trim().toLowerCase();
    const effort = this.normalizeEffortValue(
      (binding.reasoningEffort || DEFAULT_REASONING_EFFORT).trim().toLowerCase()
    ) || DEFAULT_REASONING_EFFORT;
    const summary = (binding.reasoningSummary || "auto").trim().toLowerCase();
    const verbosity = (binding.textVerbosity || "medium").trim().toLowerCase();
    return [
      [
        {
          text: markSelected("ChatGPT Codex 5.3", model === "gpt-5.3-codex"),
          callbackData: "ocset:model:gpt-5.3-codex"
        },
        {
          text: markSelected("ChatGPT Codex 5.2", model === "gpt-5.2-codex"),
          callbackData: "ocset:model:gpt-5.2-codex"
        }
      ],
      [
        {
          text: markSelected("Effort low", effort === "low"),
          callbackData: "ocset:effort:low"
        },
        {
          text: markSelected("Effort medium", effort === "medium"),
          callbackData: "ocset:effort:medium"
        },
        {
          text: markSelected("Effort high", effort === "high"),
          callbackData: "ocset:effort:high"
        },
        {
          text: markSelected("Effort extra high", effort === "xhigh"),
          callbackData: "ocset:effort:xhigh"
        }
      ],
      [
        {
          text: markSelected("Summary auto", summary === "auto"),
          callbackData: "ocset:summary:auto"
        },
        {
          text: markSelected("Summary none", summary === "none"),
          callbackData: "ocset:summary:none"
        },
        {
          text: markSelected("Summary detailed", summary === "detailed"),
          callbackData: "ocset:summary:detailed"
        }
      ],
      [
        {
          text: markSelected("Verbosity low", verbosity === "low"),
          callbackData: "ocset:verbosity:low"
        },
        {
          text: markSelected("Verbosity medium", verbosity === "medium"),
          callbackData: "ocset:verbosity:medium"
        },
        {
          text: markSelected("Verbosity high", verbosity === "high"),
          callbackData: "ocset:verbosity:high"
        }
      ],
      [{ text: "Refresh status", callbackData: "ocset:status" }]
    ];
  }
  buildPermissionKeyboard(permissionId) {
    return [[
      {
        text: "Deny",
        callbackData: `ocperm:${permissionId}:reject`
      },
      {
        text: "Allow always",
        callbackData: `ocperm:${permissionId}:always`
      },
      {
        text: "Allow once",
        callbackData: `ocperm:${permissionId}:once`
      }
    ]];
  }
  normalizeEffortValue(input) {
    const value = input.trim().toLowerCase();
    if (["none", "low", "medium", "high", "xhigh"].includes(value)) {
      return value;
    }
    if (["extra_high", "extra-high", "x-high", "extra high", "extra"].includes(value)) {
      return "xhigh";
    }
    return void 0;
  }
  startLiveProgress(binding) {
    const runtime = this.getRuntime(binding.sessionId);
    if (runtime.progressTicker) {
      clearInterval(runtime.progressTicker);
    }
    runtime.progressTicker = setInterval(() => {
      void this.refreshLiveProgress(binding).catch((error) => {
        console.error("[Bridge] Failed to refresh live progress:", error);
      });
    }, LIVE_PROGRESS_TICK_MS);
  }
  stopLiveProgress(sessionId) {
    const runtime = this.getRuntime(sessionId);
    if (runtime.progressTicker) {
      clearInterval(runtime.progressTicker);
      runtime.progressTicker = void 0;
    }
    runtime.liveStage = void 0;
    runtime.liveDetail = void 0;
    runtime.pendingProgressText = void 0;
  }
  async refreshLiveProgress(binding) {
    const runtime = this.getRuntime(binding.sessionId);
    if (!runtime.inFlight) {
      return;
    }
    const elapsedMs = runtime.runStartedAt ? Date.now() - runtime.runStartedAt : 0;
    const stage = runtime.liveStage || "working";
    const liveDetail = runtime.liveDetail;
    await this.upsertProgress(
      binding,
      [
        "Status: working",
        `Session: ${binding.sessionId}`,
        `Model: ${modelDisplayName(binding.model)}`,
        shortPreferences(binding),
        runtime.runStartedAt ? `Started: ${formatDateTime(runtime.runStartedAt)}` : "",
        `Elapsed: ${formatDurationSeconds(elapsedMs)}`,
        `Stage: ${stage}`,
        liveDetail ? `Last: ${liveDetail}` : "",
        `Queue: ${runtime.pending.length}`
      ].filter(Boolean).join("\n")
    );
  }
  captureLivePart(runtime, part, delta) {
    const type = String(part?.type ?? "");
    if (type === "reasoning") {
      runtime.liveStage = "reasoning";
      const text = String(part?.text || delta || "");
      if (text.trim() !== "") {
        runtime.liveDetail = collapseLine(text);
      }
      return;
    }
    if (type === "text") {
      runtime.liveStage = "writing";
      const text = String(part?.text || delta || "");
      if (text.trim() !== "") {
        runtime.liveDetail = collapseLine(text);
      }
      return;
    }
    if (type === "tool") {
      const toolName = String(part?.tool || "tool");
      const toolStatus = String(part?.state?.status || "running");
      runtime.liveStage = `tool ${toolName} (${toolStatus})`;
      const title = String(part?.state?.title || "");
      const output = String(part?.state?.output || "");
      const detail = title || output;
      if (detail.trim() !== "") {
        runtime.liveDetail = collapseLine(detail);
      }
      return;
    }
    if (type === "step-start") {
      runtime.liveStage = "step started";
      return;
    }
    if (type === "step-finish") {
      runtime.liveStage = `step finished (${String(part?.reason || "ok")})`;
      return;
    }
    if (type === "patch") {
      runtime.liveStage = "applying patch";
      const files = Array.isArray(part?.files) ? part.files.map(String).slice(0, 3) : [];
      if (files.length > 0) {
        runtime.liveDetail = collapseLine(files.join(", "));
      }
      return;
    }
    if (type === "file") {
      runtime.liveStage = "file output";
      const fileName = String(part?.filename || "");
      if (fileName) {
        runtime.liveDetail = collapseLine(fileName);
      }
    }
  }
  async upsertProgress(binding, text) {
    const runtime = this.getRuntime(binding.sessionId);
    const normalized = text.trim();
    if (normalized === "") {
      return;
    }
    if (normalized === runtime.lastProgressText) {
      runtime.pendingProgressText = void 0;
      return;
    }
    runtime.pendingProgressText = normalized;
    const now = Date.now();
    if (runtime.progressBlockedUntil && now < runtime.progressBlockedUntil) {
      return;
    }
    const progressText = runtime.pendingProgressText;
    if (!progressText) {
      return;
    }
    if (runtime.progressMessageId) {
      if (runtime.nextProgressEditAt && now < runtime.nextProgressEditAt) {
        return;
      }
      try {
        await this.bot.editMessage({
          chatId: binding.chatId,
          messageId: runtime.progressMessageId,
          text: progressText
        });
        runtime.lastProgressText = progressText;
        runtime.pendingProgressText = void 0;
        runtime.nextProgressEditAt = Date.now() + LIVE_PROGRESS_MIN_EDIT_MS;
        runtime.progressBlockedUntil = void 0;
        return;
      } catch (error) {
        const meta = parseTelegramErrorMeta(error);
        if (isMessageNotModifiedMeta(meta)) {
          runtime.lastProgressText = progressText;
          runtime.pendingProgressText = void 0;
          runtime.nextProgressEditAt = Date.now() + LIVE_PROGRESS_MIN_EDIT_MS;
          return;
        }
        if (isFloodMeta(meta)) {
          const retryAfterMs = meta.retryAfterMs ?? LIVE_PROGRESS_MIN_EDIT_MS;
          const until = Date.now() + retryAfterMs + FLOOD_JITTER_MS;
          runtime.progressBlockedUntil = until;
          runtime.nextProgressEditAt = until;
          console.warn(
            `[Bridge] Progress edit rate-limited for ${Math.max(
              1,
              Math.ceil((until - Date.now()) / 1e3)
            )}s`
          );
          return;
        }
        runtime.progressMessageId = void 0;
      }
    }
    if (runtime.nextProgressSendAt && now < runtime.nextProgressSendAt) {
      return;
    }
    try {
      const sent = await this.bot.sendMessage({
        chatId: binding.chatId,
        threadId: binding.threadId,
        text: progressText
      });
      runtime.progressMessageId = sent.message_id;
      runtime.lastProgressText = progressText;
      runtime.pendingProgressText = void 0;
      runtime.nextProgressSendAt = Date.now() + LIVE_PROGRESS_MIN_SEND_MS;
      runtime.progressBlockedUntil = void 0;
    } catch (error) {
      const meta = parseTelegramErrorMeta(error);
      if (isFloodMeta(meta)) {
        const retryAfterMs = meta.retryAfterMs ?? LIVE_PROGRESS_MIN_SEND_MS;
        const until = Date.now() + retryAfterMs + FLOOD_JITTER_MS;
        runtime.progressBlockedUntil = until;
        runtime.nextProgressSendAt = until;
        console.warn(
          `[Bridge] Progress send rate-limited for ${Math.max(
            1,
            Math.ceil((until - Date.now()) / 1e3)
          )}s`
        );
        return;
      }
      console.error("[Bridge] Failed to send progress message:", error);
    }
  }
  async sendToSessionThread(binding, text, inlineKeyboard, format = "plain") {
    let payloadText = text;
    let parseMode;
    if (format === "markdown") {
      payloadText = renderMarkdownToTelegramHtml(text);
      parseMode = "HTML";
    }
    let attemptsLeft = 2;
    while (true) {
      try {
        await this.bot.sendMessage({
          chatId: binding.chatId,
          threadId: binding.threadId,
          text: payloadText,
          parseMode,
          inlineKeyboard
        });
        return;
      } catch (error) {
        const meta = parseTelegramErrorMeta(error);
        if (parseMode && isParseEntitiesMeta(meta)) {
          payloadText = text;
          parseMode = void 0;
          continue;
        }
        if (!isFloodMeta(meta) || attemptsLeft <= 0) {
          throw error;
        }
        attemptsLeft -= 1;
        const waitMs = (meta.retryAfterMs ?? 1e3) + FLOOD_JITTER_MS;
        console.warn(
          `[Bridge] sendMessage rate-limited, retry in ${Math.max(
            1,
            Math.ceil(waitMs / 1e3)
          )}s`
        );
        await sleep(waitMs);
      }
    }
  }
  async editMessageWithFloodRetry(params) {
    let attemptsLeft = 2;
    while (true) {
      try {
        await this.bot.editMessage({
          chatId: params.chatId,
          messageId: params.messageId,
          text: params.text,
          inlineKeyboard: params.inlineKeyboard
        });
        return true;
      } catch (error) {
        const meta = parseTelegramErrorMeta(error);
        if (isMessageNotModifiedMeta(meta)) {
          return true;
        }
        if (!isFloodMeta(meta) || attemptsLeft <= 0) {
          console.error("[Bridge] Failed to edit permission message:", error);
          return false;
        }
        attemptsLeft -= 1;
        const waitMs = (meta.retryAfterMs ?? 1e3) + FLOOD_JITTER_MS;
        await sleep(waitMs);
      }
    }
  }
  async sendPermissionRequestWithRetry(binding, permissionId, text) {
    let attemptsLeft = 3;
    while (true) {
      try {
        const sent = await this.bot.sendMessage({
          chatId: binding.chatId,
          threadId: binding.threadId,
          text,
          inlineKeyboard: this.buildPermissionKeyboard(permissionId)
        });
        return sent.message_id;
      } catch (error) {
        const meta = parseTelegramErrorMeta(error);
        if (isFloodMeta(meta) && attemptsLeft > 0) {
          attemptsLeft -= 1;
          const waitMs = (meta.retryAfterMs ?? 1e3) + FLOOD_JITTER_MS;
          console.warn(
            `[Bridge] Permission send rate-limited, retry in ${Math.max(
              1,
              Math.ceil(waitMs / 1e3)
            )}s`
          );
          await sleep(waitMs);
          continue;
        }
        console.error("[Bridge] Failed to send permission message:", error);
        try {
          await this.sendToSessionThread(
            binding,
            `${text}

Fallback: /oc perm ${permissionId} <once|always|reject>`
          );
        } catch (fallbackError) {
          console.error("[Bridge] Failed to send permission fallback:", fallbackError);
        }
        return void 0;
      }
    }
  }
  getRuntime(sessionId) {
    const existing = this.runtime.get(sessionId);
    if (existing) {
      return existing;
    }
    const created = {
      inFlight: false,
      pending: [],
      retriedAfterCompaction: false
    };
    this.runtime.set(sessionId, created);
    return created;
  }
  getClient(directory) {
    return this.clientFactory.getForDirectory(directory);
  }
  async runThreadLock(key, task) {
    const previous = this.threadLocks.get(key) ?? Promise.resolve();
    const current = previous.catch(() => void 0).then(task).finally(() => {
      if (this.threadLocks.get(key) === current) {
        this.threadLocks.delete(key);
      }
    });
    this.threadLocks.set(key, current);
    await current;
  }
  async expectData(resultPromise) {
    const result = await resultPromise;
    if (result?.error) {
      throw new Error(parseErrorPayload(result.error));
    }
    if (typeof result?.data === "undefined") {
      throw new Error("OpenCode API returned empty response data.");
    }
    return result.data;
  }
  async expectOk(resultPromise) {
    const result = await resultPromise;
    if (result?.error) {
      throw new Error(parseErrorPayload(result.error));
    }
  }
};

// src/config.ts
import { resolve as resolve2 } from "path";
import { config as loadEnv } from "dotenv";
loadEnv({ path: resolve2(process.cwd(), ".env") });
function parseNumberList(value) {
  if (!value || value.trim() === "") {
    return [];
  }
  return value.split(",").map((item) => item.trim()).filter(Boolean).map((item) => Number.parseInt(item, 10)).filter((item) => !Number.isNaN(item));
}
function parsePathList(value) {
  if (!value || value.trim() === "") {
    return [];
  }
  return value.split(",").map((item) => item.trim()).filter(Boolean).map((item) => resolve2(item));
}
function parseModel(value) {
  const fallback = {
    providerID: "openai",
    modelID: "gpt-5.3-codex"
  };
  if (!value || value.trim() === "") {
    return fallback;
  }
  const normalized = value.trim();
  const [providerID, modelID] = normalized.split("/");
  if (!providerID || !modelID) {
    return fallback;
  }
  return { providerID, modelID };
}
function loadConfig() {
  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  if (!botToken || botToken.trim() === "") {
    throw new Error("Missing required environment variable: TELEGRAM_BOT_TOKEN");
  }
  const allowedUserIds = parseNumberList(process.env.TELEGRAM_ALLOWED_USER_IDS);
  if (allowedUserIds.length === 0) {
    throw new Error(
      "Missing or invalid TELEGRAM_ALLOWED_USER_IDS (comma-separated numeric IDs)"
    );
  }
  const allowedChatIds = parseNumberList(process.env.TELEGRAM_ALLOWED_CHAT_IDS);
  const chatIdRaw = process.env.TELEGRAM_CHAT_ID;
  const parsedChatId = chatIdRaw ? Number.parseInt(chatIdRaw, 10) : Number.NaN;
  const chatId = Number.isNaN(parsedChatId) ? void 0 : parsedChatId;
  const forumChatIdRaw = process.env.TELEGRAM_FORUM_CHAT_ID;
  const parsedForumChatId = forumChatIdRaw ? Number.parseInt(forumChatIdRaw, 10) : Number.NaN;
  const forumChatId = Number.isNaN(parsedForumChatId) ? void 0 : parsedForumChatId;
  const allowedWorkspaceRoots = parsePathList(
    process.env.TELEGRAM_ALLOWED_WORKSPACE_ROOTS ?? "/home/opencode/Projects/EdgeRolls,/home/opencode/Projects/BoosterVpn,/home/opencode/Projects/TGtoMax"
  );
  const maxAttachmentBytesRaw = process.env.TELEGRAM_MAX_ATTACHMENT_BYTES ?? "6291456";
  const maxAttachmentBytes = Number.parseInt(maxAttachmentBytesRaw, 10);
  if (Number.isNaN(maxAttachmentBytes) || maxAttachmentBytes <= 0) {
    throw new Error("Invalid TELEGRAM_MAX_ATTACHMENT_BYTES value.");
  }
  const stateFilePath = process.env.TELEGRAM_BRIDGE_STATE_PATH ? resolve2(process.env.TELEGRAM_BRIDGE_STATE_PATH) : resolve2(
    process.env.HOME ?? process.cwd(),
    ".config/opencode/local-plugins/opencoder-telegram-plugin/state/topic-session-map.json"
  );
  const opencodeBaseUrl = process.env.TELEGRAM_OPENCODE_BASE_URL?.trim() || process.env.OPENCODE_BASE_URL?.trim() || process.env.OPENCODE_SERVER_URL?.trim() || "http://127.0.0.1:4097";
  const opencodeUsername = process.env.TELEGRAM_OPENCODE_USERNAME?.trim() || process.env.OPENCODE_SERVER_USERNAME?.trim() || "";
  const opencodePassword = process.env.TELEGRAM_OPENCODE_PASSWORD?.trim() || process.env.OPENCODE_SERVER_PASSWORD?.trim() || "";
  const hasUsername = opencodeUsername !== "";
  const hasPassword = opencodePassword !== "";
  if (hasUsername !== hasPassword) {
    throw new Error(
      "Incomplete OpenCode credentials. Set both username and password, or leave both empty."
    );
  }
  return {
    botToken,
    allowedUserIds,
    allowedChatIds,
    chatId,
    forumChatId,
    allowedWorkspaceRoots,
    defaultModel: parseModel(process.env.TELEGRAM_OPENCODE_MODEL),
    maxAttachmentBytes,
    stateFilePath,
    opencodeBaseUrl,
    opencodeUsername: hasUsername ? opencodeUsername : void 0,
    opencodePassword: hasPassword ? opencodePassword : void 0
  };
}

// src/telegram-remote.ts
var TelegramRemote = async () => {
  let config;
  try {
    config = loadConfig();
  } catch (error) {
    console.error("[TelegramRemote] Config load failed:", error);
    return {
      event: async () => {
      }
    };
  }
  let bridge;
  const bot = createTelegramBot(config, async (message) => {
    if (!bridge) {
      return;
    }
    await bridge.handleInboundMessage(message);
  });
  bridge = new TelegramForumBridge(config, bot);
  bot.start().catch((error) => {
    console.error("[TelegramRemote] Failed to start Telegram bot:", error);
  });
  let isShuttingDown = false;
  async function shutdown() {
    if (isShuttingDown) {
      return;
    }
    isShuttingDown = true;
    try {
      await bot.stop();
    } catch (error) {
      console.error("[TelegramRemote] Error while stopping bot:", error);
    }
  }
  process.on("SIGINT", () => {
    void shutdown();
  });
  process.on("SIGTERM", () => {
    void shutdown();
  });
  return {
    event: async ({ event }) => {
      await bridge?.handleEvent(event);
    }
  };
};
export {
  TelegramRemote
};
