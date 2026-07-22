"use strict";

const DEFAULT_SETTINGS = {
  apiHost: "https://api.deepseek.com",
  apiKey: "",
  models: ["deepseek-chat", "deepseek-reasoner"],
  defaultModel: "deepseek-chat",
  temperature: 1.0,
  topP: 1.0,
  maxTokens: 2048,
  freqPenalty: 0,
  systemPrompt: "",
  extraParams: "",
  chatFontSize: 14.5,
  sidebarCollapsed: false,
  autoLockMinutes: 2,
};

// Request-body keys the client always controls; extra params can never override them.
const PROTECTED_BODY_KEYS = ["model", "messages", "stream"];

const BOTTOM_THRESHOLD = 80;
const FONT_SIZE_MIN = 12;
const FONT_SIZE_MAX = 22;
const FONT_SIZE_STEP = 1;
// Abort if no response starts, or the stream stalls, within this window.
const REQUEST_TIMEOUT_MS = 60 * 1000;

let settings = { ...DEFAULT_SETTINGS };
let topics = [];
let activeTopicId = null;
let isStreaming = false;
let abortController = null;
// Why the current request was aborted: "user" (stop button) or "timeout".
let abortReason = null;
// Pending messages intentionally live only in memory. Refreshing the page clears them.
let queuedMessages = []; // { id: string, topicId: string, content: string }
let activeRequest = null; // { topicId: string, assistantText: string, bubble: HTMLElement|null }

// cryptoState is non-null only while a password-protected session is unlocked.
let cryptoState = null; // { key: CryptoKey, salt: Uint8Array }
let idleTimer = null;
let isAppLocked = false;
const composingInputs = new WeakSet();
const compositionJustEndedInputs = new WeakSet();

const el = {
  app: document.querySelector(".app"),
  topicList: document.getElementById("topicList"),
  newTopicBtn: document.getElementById("newTopicBtn"),
  settingsBtn: document.getElementById("settingsBtn"),
  chatTitle: document.getElementById("chatTitle"),
  sidebarToggleBtn: document.getElementById("sidebarToggleBtn"),
  fontDecreaseBtn: document.getElementById("fontDecreaseBtn"),
  fontIncreaseBtn: document.getElementById("fontIncreaseBtn"),
  modelSelect: document.getElementById("modelSelect"),
  messages: document.getElementById("messages"),
  scrollIndicatorBtn: document.getElementById("scrollIndicatorBtn"),
  input: document.getElementById("input"),
  sendBtn: document.getElementById("sendBtn"),

  settingsModal: document.getElementById("settingsModal"),
  closeSettingsBtn: document.getElementById("closeSettingsBtn"),
  saveSettingsBtn: document.getElementById("saveSettingsBtn"),
  apiHost: document.getElementById("apiHost"),
  apiKey: document.getElementById("apiKey"),
  modelList: document.getElementById("modelList"),
  defaultModel: document.getElementById("defaultModel"),
  temperature: document.getElementById("temperature"),
  topP: document.getElementById("topP"),
  maxTokens: document.getElementById("maxTokens"),
  freqPenalty: document.getElementById("freqPenalty"),
  systemPrompt: document.getElementById("systemPrompt"),
  extraParams: document.getElementById("extraParams"),
  extraParamsMsg: document.getElementById("extraParamsMsg"),
  autoLockMinutes: document.getElementById("autoLockMinutes"),

  passwordStatus: document.getElementById("passwordStatus"),
  passwordSetupForm: document.getElementById("passwordSetupForm"),
  passwordManageForm: document.getElementById("passwordManageForm"),
  newPassword1: document.getElementById("newPassword1"),
  newPassword2: document.getElementById("newPassword2"),
  enablePasswordBtn: document.getElementById("enablePasswordBtn"),
  currentPasswordForChange: document.getElementById("currentPasswordForChange"),
  changePassword1: document.getElementById("changePassword1"),
  changePassword2: document.getElementById("changePassword2"),
  changePasswordBtn: document.getElementById("changePasswordBtn"),
  disablePasswordBtn: document.getElementById("disablePasswordBtn"),
  passwordMsg: document.getElementById("passwordMsg"),

  lockScreen: document.getElementById("lockScreen"),
  unlockPassword: document.getElementById("unlockPassword"),
  unlockError: document.getElementById("unlockError"),
  unlockBtn: document.getElementById("unlockBtn"),
};

// ---------- Storage ----------

async function persistState() {
  if (cryptoState) {
    const vault = await encryptWithKey(cryptoState.key, { settings, topics });
    await chrome.storage.local.set({ vault });
    // Guards against a stale plaintext copy surviving an interrupted enable/change flow.
    await chrome.storage.local.remove(["settings", "topics"]);
  } else {
    await chrome.storage.local.set({ settings, topics });
  }
}

async function saveSettings() {
  await persistState();
}

async function saveTopics() {
  await persistState();
}

// ---------- Topics ----------

function genId() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

function createTopic() {
  const topic = {
    id: genId(),
    title: t("topic.default_title"),
    createdAt: Date.now(),
    model: settings.defaultModel,
    messages: [],
  };
  topics.unshift(topic);
  activeTopicId = topic.id;
  saveTopics();
  renderTopicList();
  renderMessages();
  updateHeader();
}

function getActiveTopic() {
  return topics.find((t) => t.id === activeTopicId) || null;
}

function selectTopic(id) {
  activeTopicId = id;
  renderTopicList();
  renderMessages();
  updateHeader();
}

function deleteTopic(id, evt) {
  evt.stopPropagation();
  const idx = topics.findIndex((t) => t.id === id);
  if (idx === -1) return;
  topics.splice(idx, 1);
  queuedMessages = queuedMessages.filter((message) => message.topicId !== id);
  if (activeTopicId === id) {
    activeTopicId = topics.length ? topics[0].id : null;
  }
  saveTopics();
  renderTopicList();
  renderMessages();
  updateHeader();
}

function renderTopicList() {
  el.topicList.innerHTML = "";
  for (const topic of topics) {
    const item = document.createElement("div");
    item.className = "topic-item" + (topic.id === activeTopicId ? " active" : "");

    // Defer single-click selection briefly so a following second click (dblclick) can
    // cancel it instead of racing a list re-render against the rename UI.
    let clickTimer = null;
    item.addEventListener("click", () => {
      if (clickTimer) return;
      clickTimer = setTimeout(() => {
        clickTimer = null;
        selectTopic(topic.id);
      }, 220);
    });

    const title = document.createElement("span");
    title.className = "topic-title";
    title.textContent = topic.title;
    title.addEventListener("dblclick", (e) => {
      e.stopPropagation();
      if (clickTimer) {
        clearTimeout(clickTimer);
        clickTimer = null;
      }
      startRenameTopic(topic, title);
    });

    const del = document.createElement("button");
    del.className = "topic-delete";
    del.textContent = "✕";
    del.title = t("topic.delete_title");
    del.addEventListener("click", (e) => deleteTopic(topic.id, e));

    item.appendChild(title);
    item.appendChild(del);
    el.topicList.appendChild(item);
  }
}

function startRenameTopic(topic, titleSpan) {
  const input = document.createElement("input");
  input.type = "text";
  input.className = "topic-rename-input";
  input.value = topic.title;
  installImeGuard(input);
  titleSpan.replaceWith(input);
  input.focus();
  input.select();

  let settled = false;

  const commit = () => {
    if (settled) return;
    settled = true;
    const newTitle = input.value.trim();
    if (newTitle) topic.title = newTitle;
    saveTopics();
    renderTopicList();
    updateHeader();
  };

  const cancel = () => {
    if (settled) return;
    settled = true;
    renderTopicList();
  };

  input.addEventListener("click", (e) => e.stopPropagation());
  input.addEventListener("dblclick", (e) => e.stopPropagation());
  input.addEventListener("blur", commit);
  input.addEventListener("keydown", (e) => {
    if (isImeConfirming(e)) return;
    if (e.key === "Enter") {
      e.preventDefault();
      commit();
    } else if (e.key === "Escape") {
      e.preventDefault();
      cancel();
    }
  });
}

function updateHeader() {
  const topic = getActiveTopic();
  el.chatTitle.textContent = topic ? topic.title : t("topic.default_title");
  populateModelSelect();
  if (topic) {
    el.modelSelect.value = topic.model || settings.defaultModel;
  }
}

// ---------- Sidebar collapse ----------

function applySidebarState() {
  el.app.classList.toggle("sidebar-collapsed", !!settings.sidebarCollapsed);
}

function toggleSidebar() {
  settings.sidebarCollapsed = !settings.sidebarCollapsed;
  applySidebarState();
  saveSettings();
}

// ---------- Font size ----------

function applyFontSize() {
  document.documentElement.style.setProperty("--chat-font-size", `${settings.chatFontSize}px`);
}

function adjustFontSize(delta) {
  const next = Math.min(FONT_SIZE_MAX, Math.max(FONT_SIZE_MIN, settings.chatFontSize + delta));
  if (next === settings.chatFontSize) return;
  settings.chatFontSize = next;
  applyFontSize();
  saveSettings();
}

function populateModelSelect() {
  const current = el.modelSelect.value;
  el.modelSelect.innerHTML = "";
  for (const m of settings.models) {
    const opt = document.createElement("option");
    opt.value = m;
    opt.textContent = m;
    el.modelSelect.appendChild(opt);
  }
  if (settings.models.includes(current)) {
    el.modelSelect.value = current;
  }
}

// ---------- Messages rendering ----------

function renderMessages() {
  el.messages.innerHTML = "";
  hideScrollIndicator();
  const topic = getActiveTopic();
  const topicQueue = topic
    ? queuedMessages.filter((message) => message.topicId === topic.id)
    : [];
  const hasActiveRequest = Boolean(topic && isStreaming && activeRequest?.topicId === topic.id);
  if (!topic || (topic.messages.length === 0 && topicQueue.length === 0 && !hasActiveRequest)) {
    el.messages.classList.add("is-empty");
    const empty = document.createElement("div");
    empty.className = "empty-state";
    empty.textContent = t("chat.empty");
    el.messages.appendChild(empty);
    return;
  }
  el.messages.classList.remove("is-empty");
  for (const msg of topic.messages) {
    appendMessageBubble(msg.role, msg.content);
  }
  if (hasActiveRequest) {
    activeRequest.bubble = appendMessageBubble("assistant", activeRequest.assistantText);
  } else if (activeRequest) {
    activeRequest.bubble = null;
  }
  for (const message of topicQueue) {
    appendQueuedMessageBubble(message);
  }
  el.messages.scrollTop = el.messages.scrollHeight;
}

function hideScrollIndicator() {
  el.scrollIndicatorBtn.classList.add("hidden");
}

function isNearBottom() {
  const distance = el.messages.scrollHeight - el.messages.scrollTop - el.messages.clientHeight;
  return distance < BOTTOM_THRESHOLD;
}

// Never moves the scrollbar itself — only reflects current state as dots (generating)
// or a down-arrow (done) whenever the user isn't already at the bottom.
function refreshScrollIndicator() {
  if (isNearBottom()) {
    el.scrollIndicatorBtn.classList.add("hidden");
    return;
  }
  el.scrollIndicatorBtn.classList.remove("hidden");
  el.scrollIndicatorBtn.classList.toggle("generating", isStreaming);
  el.scrollIndicatorBtn.classList.toggle("done", !isStreaming);
}

function renderBubbleContent(bubble, role, content) {
  if (role === "assistant") {
    if (!content) {
      // Waiting for the first streamed token: show an enlarged typing bubble.
      bubble.classList.remove("markdown-body");
      bubble.classList.add("typing");
      bubble.innerHTML =
        '<span class="typing-dots"><span class="dot"></span><span class="dot"></span><span class="dot"></span></span>';
      return;
    }
    bubble.classList.remove("typing");
    bubble.classList.add("markdown-body");
    bubble.innerHTML = mdRender(content);
  } else {
    bubble.classList.remove("markdown-body", "typing");
    bubble.textContent = content;
  }
}

function appendMessageBubble(role, content) {
  const row = document.createElement("div");
  row.className = `message-row ${role}`;
  const bubble = document.createElement("div");
  bubble.className = "bubble";
  renderBubbleContent(bubble, role, content);
  row.appendChild(bubble);
  el.messages.appendChild(row);
  return bubble;
}

function appendQueuedMessageBubble(message) {
  const row = document.createElement("div");
  row.className = "message-row queued";
  row.dataset.queueId = message.id;

  const bubble = document.createElement("div");
  bubble.className = "bubble queued-bubble";

  const text = document.createElement("span");
  text.className = "queued-text";
  text.textContent = message.content;

  const deleteBtn = document.createElement("button");
  deleteBtn.type = "button";
  deleteBtn.className = "queued-delete-btn";
  deleteBtn.title = t("queue.delete_title");
  deleteBtn.setAttribute("aria-label", t("queue.delete_title"));
  deleteBtn.innerHTML =
    '<svg viewBox="0 0 24 24" width="17" height="17" aria-hidden="true">' +
    '<path d="M4 7h16M9 7V4h6v3m-8 0 1 13h8l1-13M10 11v5m4-5v5" ' +
    'fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  deleteBtn.addEventListener("click", () => deleteQueuedMessage(message.id));

  bubble.append(text, deleteBtn);
  row.appendChild(bubble);
  el.messages.appendChild(row);
  return row;
}

function deleteQueuedMessage(id) {
  const index = queuedMessages.findIndex((message) => message.id === id);
  if (index === -1) return;
  queuedMessages.splice(index, 1);
  renderMessages();
}

// ---------- Sending ----------

function enqueueMessage(text) {
  let topic = getActiveTopic();
  if (!topic) {
    createTopic();
    topic = getActiveTopic();
  }

  const message = { id: genId(), topicId: topic.id, content: text };
  queuedMessages.push(message);
  el.input.value = "";
  autoResizeInput();

  el.messages.classList.remove("is-empty");
  const empty = el.messages.querySelector(".empty-state");
  if (empty) empty.remove();
  appendQueuedMessageBubble(message);
  el.messages.scrollTop = el.messages.scrollHeight;
}

function submitComposerMessage() {
  const text = el.input.value.trim();
  if (!text) return;
  if (isStreaming || queuedMessages.length > 0) {
    enqueueMessage(text);
    drainMessageQueue();
    return;
  }
  void sendMessage(text);
}

function drainMessageQueue() {
  if (isAppLocked || isStreaming || queuedMessages.length === 0) return;
  const next = queuedMessages[0];
  void sendMessage(next.content, next.id);
}

async function sendMessage(text, queuedId = null) {
  if (!text || isStreaming) return;

  if (!settings.apiKey) {
    openSettings();
    return;
  }

  const queuedMessage = queuedId
    ? queuedMessages.find((message) => message.id === queuedId)
    : null;
  if (queuedId && !queuedMessage) return;

  let topic = queuedMessage
    ? topics.find((candidate) => candidate.id === queuedMessage.topicId)
    : getActiveTopic();
  if (!topic) {
    createTopic();
    topic = getActiveTopic();
  }

  if (topic.messages.length === 0) {
    topic.title = text.slice(0, 30);
  }
  topic.model = topic.id === activeTopicId
    ? (el.modelSelect.value || settings.defaultModel)
    : (topic.model || settings.defaultModel);

  topic.messages.push({ role: "user", content: text });
  if (queuedMessage) {
    queuedMessages.splice(queuedMessages.indexOf(queuedMessage), 1);
  } else {
    el.input.value = "";
    autoResizeInput();
  }

  isStreaming = true;
  abortReason = null;
  abortController = new AbortController();
  activeRequest = { topicId: topic.id, assistantText: "", bubble: null };
  setComposerStreaming(true);

  renderMessages();
  renderTopicList();
  hideScrollIndicator();
  // Jump to bottom once, as a direct result of the user's own send action.
  // Nothing below this point moves the scrollbar on its own.
  el.messages.scrollTop = el.messages.scrollHeight;

  // Aborts the request if it never responds or the stream stalls.
  let timeoutId = null;
  const armTimeout = () => {
    clearTimeout(timeoutId);
    timeoutId = setTimeout(() => {
      abortReason = "timeout";
      if (abortController) abortController.abort();
    }, REQUEST_TIMEOUT_MS);
  };

  const apiMessages = [];
  if (settings.systemPrompt && settings.systemPrompt.trim()) {
    apiMessages.push({ role: "system", content: settings.systemPrompt.trim() });
  }
  for (const m of topic.messages) {
    apiMessages.push({ role: m.role, content: m.content });
  }

  const requestBody = buildRequestBody(
    { model: topic.model, messages: apiMessages, stream: true },
    {
      temperature: Number(settings.temperature),
      top_p: Number(settings.topP),
      max_tokens: Number(settings.maxTokens),
      frequency_penalty: Number(settings.freqPenalty),
    },
    parseExtraParams(settings.extraParams).value
  );

  let assistantText = "";
  try {
    await saveTopics();
    armTimeout();
    const url = joinUrl(settings.apiHost, "/chat/completions");
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${settings.apiKey}`,
      },
      body: JSON.stringify(requestBody),
      signal: abortController.signal,
    });

    if (!res.ok || !res.body) {
      const errText = await safeReadText(res);
      throw new Error(formatHttpError(res.status, res.statusText, errText));
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder("utf-8");
    let buffer = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      armTimeout(); // reset stall timer on each chunk
      buffer += decoder.decode(value, { stream: true });

      const lines = buffer.split("\n");
      buffer = lines.pop();

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed.startsWith("data:")) continue;
        const data = trimmed.slice(5).trim();
        if (data === "[DONE]") continue;
        let json;
        try {
          json = JSON.parse(data);
        } catch (e) {
          continue; // ignore malformed SSE fragment
        }
        // Some providers deliver errors mid-stream as a JSON error object.
        if (json.error) {
          throw new Error(extractApiError(json.error));
        }
        const delta = json.choices?.[0]?.delta?.content;
        if (delta) {
          assistantText += delta;
          activeRequest.assistantText = assistantText;
          if (activeRequest.bubble) {
            renderBubbleContent(activeRequest.bubble, "assistant", assistantText);
          }
          refreshScrollIndicator();
        }
      }
    }

    if (!assistantText) {
      throw new Error(t("err.empty_response"));
    }

    topic.messages.push({ role: "assistant", content: assistantText });
    await saveTopics();
  } catch (err) {
    // Auto-lock aborts the request without rendering or persisting a response
    // after the decrypted session has already been cleared.
    if (err.name === "AbortError" && abortReason === "lock") return;
    let message;
    if (err.name === "AbortError") {
      message = abortReason === "timeout"
        ? t("err.timeout", { sec: REQUEST_TIMEOUT_MS / 1000 })
        : t("err.stopped");
    } else {
      message = t("err.request_failed", { msg: err.message });
    }
    // Keep whatever was already streamed, then append the status note.
    if (assistantText) {
      if (activeRequest.bubble) {
        renderBubbleContent(activeRequest.bubble, "assistant", assistantText);
        const note = document.createElement("div");
        note.className = "bubble-note";
        note.textContent = message;
        activeRequest.bubble.appendChild(note);
      }
      topic.messages.push({ role: "assistant", content: assistantText });
      await saveTopics();
    } else if (activeRequest.bubble) {
      activeRequest.bubble.classList.remove("typing", "markdown-body");
      activeRequest.bubble.parentElement.classList.add("error");
      activeRequest.bubble.textContent = message;
    }
  } finally {
    clearTimeout(timeoutId);
    isStreaming = false;
    abortReason = null;
    abortController = null;
    activeRequest = null;
    setComposerStreaming(false);
    refreshScrollIndicator();
    drainMessageQueue();
  }
}

function stopGeneration() {
  if (!isStreaming || !abortController) return;
  abortReason = "user";
  abortController.abort();
}

function safeReadText(res) {
  return res.text().catch(() => "");
}

// Extracts a human-readable message from an OpenAI-style error object.
function extractApiError(error) {
  if (!error) return t("err.unknown");
  if (typeof error === "string") return error;
  return error.message || error.code || error.type || JSON.stringify(error);
}

// Builds a readable message for a non-2xx HTTP response, parsing a JSON error
// body (e.g. token-limit / invalid-request errors) when present.
function formatHttpError(status, statusText, bodyText) {
  let detail = "";
  if (bodyText) {
    try {
      const parsed = JSON.parse(bodyText);
      detail = extractApiError(parsed.error || parsed);
    } catch (e) {
      detail = bodyText.slice(0, 300);
    }
  }
  const label = statusText ? `${status} ${statusText}` : `${status}`;
  return detail ? `HTTP ${label} — ${detail}` : `HTTP ${label}`;
}

function joinUrl(host, path) {
  const trimmedHost = host.replace(/\/+$/, "");
  if (trimmedHost.endsWith("/v1")) return trimmedHost + path;
  return trimmedHost + "/v1" + path;
}

// Parses the extra-params JSON string. Returns { ok, value, error }.
// Empty input is valid and yields an empty object.
function parseExtraParams(text) {
  const trimmed = (text || "").trim();
  if (!trimmed) return { ok: true, value: {} };
  let parsed;
  try {
    parsed = JSON.parse(trimmed);
  } catch (e) {
    return { ok: false, error: t("err.json_parse", { msg: e.message }) };
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    return { ok: false, error: t("err.extra_not_object") };
  }
  return { ok: true, value: parsed };
}

// Merges standard params + user extra params into a final request body, then
// force-restores the protected keys so streaming/model/messages stay intact.
// A key set to null in extra params is dropped so callers can omit a standard param.
function buildRequestBody(coreProtected, standardParams, extraParams) {
  const body = { ...standardParams, ...extraParams };
  for (const key of Object.keys(body)) {
    if (body[key] === null) delete body[key];
  }
  Object.assign(body, coreProtected);
  return body;
}

function autoResizeInput() {
  el.input.style.height = "auto";
  el.input.style.height = Math.min(el.input.scrollHeight, 200) + "px";
}

// Tracks text composition per input so Enter used to accept an IME candidate
// never leaks into an Enter-based application shortcut.
function installImeGuard(input) {
  input.addEventListener("compositionstart", () => {
    composingInputs.add(input);
    compositionJustEndedInputs.delete(input);
  });
  input.addEventListener("compositionend", () => {
    composingInputs.delete(input);
    // Some IME/browser combinations dispatch compositionend immediately before
    // the confirming keydown. Preserve the guard through the current task.
    compositionJustEndedInputs.add(input);
    setTimeout(() => compositionJustEndedInputs.delete(input), 0);
  });
  input.addEventListener("blur", () => {
    composingInputs.delete(input);
    compositionJustEndedInputs.delete(input);
  });
}

function isImeConfirming(event) {
  const input = event.currentTarget;
  // keyCode 229 is deprecated, but remains a useful Chrome compatibility
  // signal for key events whose value is being handled by an IME.
  return event.isComposing ||
    composingInputs.has(input) ||
    compositionJustEndedInputs.has(input) ||
    event.keyCode === 229;
}

// Toggles the send button into a stop control (square icon) while generating.
function setComposerStreaming(streaming) {
  el.sendBtn.classList.toggle("is-stop", streaming);
  el.sendBtn.title = streaming ? t("composer.stop_title") : t("composer.send_title");
  if (streaming) {
    el.sendBtn.innerHTML =
      '<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">' +
      '<rect x="4.5" y="4.5" width="15" height="15" rx="3" fill="currentColor"/></svg>';
  } else {
    el.sendBtn.textContent = t("composer.send");
  }
}

// ---------- Settings modal ----------

function openSettings() {
  el.apiHost.value = settings.apiHost;
  el.apiKey.value = settings.apiKey;
  el.modelList.value = settings.models.join(", ");
  el.temperature.value = settings.temperature;
  el.topP.value = settings.topP;
  el.maxTokens.value = settings.maxTokens;
  el.freqPenalty.value = settings.freqPenalty;
  el.systemPrompt.value = settings.systemPrompt;
  el.extraParams.value = settings.extraParams || "";
  el.extraParamsMsg.textContent = "";
  el.autoLockMinutes.value = settings.autoLockMinutes || DEFAULT_SETTINGS.autoLockMinutes;
  populateDefaultModelSelect(settings.models, settings.defaultModel);
  refreshPasswordUI();
  el.settingsModal.classList.remove("hidden");
}

function populateDefaultModelSelect(models, selected) {
  el.defaultModel.innerHTML = "";
  for (const m of models) {
    const opt = document.createElement("option");
    opt.value = m;
    opt.textContent = m;
    el.defaultModel.appendChild(opt);
  }
  if (models.includes(selected)) el.defaultModel.value = selected;
}

function closeSettings() {
  el.settingsModal.classList.add("hidden");
}

async function handleSaveSettings() {
  const extraRaw = el.extraParams.value;
  const parsedExtra = parseExtraParams(extraRaw);
  if (!parsedExtra.ok) {
    el.extraParamsMsg.textContent = parsedExtra.error;
    el.extraParams.focus();
    return;
  }
  const protectedHit = Object.keys(parsedExtra.value).find((k) =>
    PROTECTED_BODY_KEYS.includes(k)
  );
  if (protectedHit) {
    el.extraParamsMsg.textContent = t("err.protected_key", { key: protectedHit });
    el.extraParams.focus();
    return;
  }
  el.extraParamsMsg.textContent = "";

  const models = el.modelList.value
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  settings = {
    ...settings,
    apiHost: el.apiHost.value.trim() || DEFAULT_SETTINGS.apiHost,
    apiKey: el.apiKey.value.trim(),
    models: models.length ? models : DEFAULT_SETTINGS.models,
    defaultModel: el.defaultModel.value || models[0] || DEFAULT_SETTINGS.defaultModel,
    temperature: Number(el.temperature.value),
    topP: Number(el.topP.value),
    maxTokens: Number(el.maxTokens.value),
    freqPenalty: Number(el.freqPenalty.value),
    systemPrompt: el.systemPrompt.value,
    extraParams: extraRaw.trim(),
    autoLockMinutes: Math.min(
      1440,
      Math.max(1, Number(el.autoLockMinutes.value) || DEFAULT_SETTINGS.autoLockMinutes)
    ),
  };

  await saveSettings();
  populateModelSelect();
  updateHeader();
  closeSettings();
  resetIdleTimer();
  drainMessageQueue();
}

// ---------- Password protection ----------

function refreshPasswordUI() {
  el.passwordMsg.textContent = "";
  if (cryptoState) {
    el.passwordStatus.textContent = t("pwd.status_enabled");
    el.passwordSetupForm.classList.add("hidden");
    el.passwordManageForm.classList.remove("hidden");
    el.currentPasswordForChange.value = "";
    el.changePassword1.value = "";
    el.changePassword2.value = "";
  } else {
    el.passwordStatus.textContent = t("pwd.status_disabled");
    el.passwordSetupForm.classList.remove("hidden");
    el.passwordManageForm.classList.add("hidden");
    el.newPassword1.value = "";
    el.newPassword2.value = "";
  }
}

function showPasswordMsg(text) {
  el.passwordMsg.textContent = text;
}

async function handleEnablePassword() {
  const p1 = el.newPassword1.value;
  const p2 = el.newPassword2.value;
  if (!p1 || p1.length < 4) {
    showPasswordMsg(t("pwd.min_len"));
    return;
  }
  if (p1 !== p2) {
    showPasswordMsg(t("pwd.mismatch"));
    return;
  }

  const salt = randomBytes(16);
  const key = await deriveKeyFromPassword(p1, salt);
  cryptoState = { key, salt };

  await chrome.storage.local.set({ vaultSalt: bufToBase64(salt) });
  await persistState();

  resetIdleTimer();
  showPasswordMsg(t("pwd.enabled_msg"));
  refreshPasswordUI();
}

async function verifyCurrentPassword(password) {
  const data = await chrome.storage.local.get(["vault"]);
  if (!data.vault) return false;
  try {
    const testKey = await deriveKeyFromPassword(password, cryptoState.salt);
    await decryptWithKey(testKey, data.vault.iv, data.vault.ciphertext);
    return true;
  } catch (e) {
    return false;
  }
}

async function handleChangePassword() {
  const oldP = el.currentPasswordForChange.value;
  const newP1 = el.changePassword1.value;
  const newP2 = el.changePassword2.value;

  if (!(await verifyCurrentPassword(oldP))) {
    showPasswordMsg(t("pwd.current_wrong"));
    return;
  }
  if (!newP1) {
    showPasswordMsg(t("pwd.enter_new"));
    return;
  }
  if (newP1.length < 4) {
    showPasswordMsg(t("pwd.new_min_len"));
    return;
  }
  if (newP1 !== newP2) {
    showPasswordMsg(t("pwd.new_mismatch"));
    return;
  }

  const newSalt = randomBytes(16);
  const newKey = await deriveKeyFromPassword(newP1, newSalt);
  cryptoState = { key: newKey, salt: newSalt };
  await chrome.storage.local.set({ vaultSalt: bufToBase64(newSalt) });
  await persistState();

  showPasswordMsg(t("pwd.changed_msg"));
  refreshPasswordUI();
}

async function handleDisablePassword() {
  const oldP = el.currentPasswordForChange.value;
  if (!(await verifyCurrentPassword(oldP))) {
    showPasswordMsg(t("pwd.current_wrong"));
    return;
  }

  cryptoState = null;
  await chrome.storage.local.set({ settings, topics });
  await chrome.storage.local.remove(["vault", "vaultSalt"]);
  clearTimeout(idleTimer);

  showPasswordMsg(t("pwd.disabled_msg"));
  refreshPasswordUI();
}

// ---------- Lock screen ----------

function showLockScreen() {
  isAppLocked = true;
  el.lockScreen.classList.remove("hidden");
  el.app.classList.add("hidden");
  el.unlockError.textContent = "";
  el.unlockPassword.value = "";
  el.unlockPassword.focus();
}

function hideLockScreen() {
  isAppLocked = false;
  el.lockScreen.classList.add("hidden");
  el.app.classList.remove("hidden");
}

function lockApp() {
  if (!cryptoState) return;
  if (isStreaming && abortController) {
    abortReason = "lock";
    abortController.abort();
  }
  cryptoState = null;
  settings = { ...DEFAULT_SETTINGS };
  topics = [];
  activeTopicId = null;
  el.messages.innerHTML = "";
  el.topicList.innerHTML = "";
  hideScrollIndicator();
  closeSettings();
  clearTimeout(idleTimer);
  showLockScreen();
}

async function handleUnlock() {
  const password = el.unlockPassword.value;
  const data = await chrome.storage.local.get(["vaultSalt", "vault"]);
  if (!data.vaultSalt || !data.vault) {
    el.unlockError.textContent = t("unlock.no_data");
    return;
  }
  try {
    const salt = new Uint8Array(base64ToBuf(data.vaultSalt));
    const key = await deriveKeyFromPassword(password, salt);
    const payload = await decryptWithKey(key, data.vault.iv, data.vault.ciphertext);
    settings = { ...DEFAULT_SETTINGS, ...(payload.settings || {}) };
    topics = payload.topics || [];
    cryptoState = { key, salt };
    hideLockScreen();
    startApp();
    drainMessageQueue();
  } catch (e) {
    el.unlockError.textContent = t("unlock.wrong");
  }
}

function resetIdleTimer() {
  clearTimeout(idleTimer);
  if (!cryptoState) return;
  const minutes = Math.min(
    1440,
    Math.max(1, Number(settings.autoLockMinutes) || DEFAULT_SETTINGS.autoLockMinutes)
  );
  idleTimer = setTimeout(lockApp, minutes * 60 * 1000);
}

["click", "keydown", "mousemove", "input"].forEach((evt) => {
  document.addEventListener(evt, resetIdleTimer, { passive: true });
});
// Scroll events from nested scroll containers do not bubble. Capture them so
// scrolling the message list or settings modal also resets the idle timer.
document.addEventListener("scroll", resetIdleTimer, { passive: true, capture: true });

// ---------- Events ----------

el.newTopicBtn.addEventListener("click", createTopic);
el.settingsBtn.addEventListener("click", openSettings);
el.sidebarToggleBtn.addEventListener("click", toggleSidebar);
el.fontDecreaseBtn.addEventListener("click", () => adjustFontSize(-FONT_SIZE_STEP));
el.fontIncreaseBtn.addEventListener("click", () => adjustFontSize(FONT_SIZE_STEP));
el.closeSettingsBtn.addEventListener("click", closeSettings);
el.saveSettingsBtn.addEventListener("click", handleSaveSettings);
el.settingsModal.addEventListener("click", (e) => {
  if (e.target === el.settingsModal) closeSettings();
});
el.modelList.addEventListener("input", () => {
  const models = el.modelList.value
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  populateDefaultModelSelect(models, el.defaultModel.value);
});

el.enablePasswordBtn.addEventListener("click", handleEnablePassword);
el.changePasswordBtn.addEventListener("click", handleChangePassword);
el.disablePasswordBtn.addEventListener("click", handleDisablePassword);

el.unlockBtn.addEventListener("click", handleUnlock);
installImeGuard(el.unlockPassword);
el.unlockPassword.addEventListener("keydown", (e) => {
  if (isImeConfirming(e)) return;
  if (e.key === "Enter") {
    e.preventDefault();
    handleUnlock();
  }
});

el.sendBtn.addEventListener("click", () => {
  if (isStreaming) {
    stopGeneration();
  } else {
    submitComposerMessage();
  }
});
installImeGuard(el.input);
el.input.addEventListener("keydown", (e) => {
  // During IME composition, Enter confirms/converts the current candidate; it
  // must never be interpreted as the chat's send shortcut. keyCode 229 is a
  // deprecated but still useful Chrome fallback for certain IME integrations.
  if (isImeConfirming(e)) return;
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    submitComposerMessage();
  }
});
el.input.addEventListener("input", autoResizeInput);

el.messages.addEventListener("scroll", refreshScrollIndicator);

el.scrollIndicatorBtn.addEventListener("click", () => {
  el.messages.scrollTo({ top: el.messages.scrollHeight, behavior: "smooth" });
});

el.modelSelect.addEventListener("change", () => {
  const topic = getActiveTopic();
  if (topic) {
    topic.model = el.modelSelect.value;
    saveTopics();
  }
});

// ---------- Init ----------

function startApp() {
  applySidebarState();
  applyFontSize();
  populateModelSelect();
  renderTopicList();

  if (topics.length === 0) {
    createTopic();
  } else {
    activeTopicId = topics[0].id;
    renderMessages();
    updateHeader();
  }

  if (!settings.apiKey) {
    openSettings();
  }

  resetIdleTimer();
}

(async function init() {
  applyI18n();
  const data = await chrome.storage.local.get(["vaultSalt", "vault", "settings", "topics"]);
  if (data.vaultSalt && data.vault) {
    showLockScreen();
    return;
  }
  settings = { ...DEFAULT_SETTINGS, ...(data.settings || {}) };
  topics = data.topics || [];
  hideLockScreen();
  startApp();
})();
