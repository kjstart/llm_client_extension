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
  chatWidthLevel: "normal", // "narrow" (60%) | "normal" (80%) | "wide" (100%)
  autoLockMinutes: 2,
  autoCompressThreshold: "96000", // raw string; "" = auto-compression disabled
  // Replaces the classic full-app lock screen with per-topic hiding: the app
  // never shows a lock screen, but topics flagged `hidden` disappear (and are
  // encrypted separately) whenever the idle-lock timer fires or on launch.
  hiddenMessagesEnabled: false,
};

// Request-body keys the client always controls; extra params can never override them.
const PROTECTED_BODY_KEYS = ["model", "messages", "stream"];

const BOTTOM_THRESHOLD = 80;
const CHAT_WIDTH_LEVELS = ["narrow", "normal", "wide"];
const FONT_SIZE_MIN = 12;
const FONT_SIZE_MAX = 22;
const FONT_SIZE_STEP = 1;
// Abort if no response starts, or the stream stalls, within this window.
const REQUEST_TIMEOUT_MS = 60 * 1000;
const MAX_STARRED_TOPICS = 5;
// 2% of the user's configured auto-compress threshold, clamped to a sane
// range — used as a target length so the summary itself doesn't grow
// unbounded. Falls back to a mid-range default if no threshold is set
// (e.g. a star-triggered compression on a topic with auto-compress off).
function suggestedSummaryLength() {
  const threshold = Number(settings.autoCompressThreshold);
  const base = threshold > 0 ? threshold * 0.02 : 1000;
  return Math.round(Math.min(5000, Math.max(200, base)));
}

function buildSummarySystemInstruction() {
  return (
    "请将以下对话内容压缩为一段结构化摘要，用于替代原始对话历史。请按以下几点整理（没有对应内容可省略该点）：\n" +
    "1. 这段对话在讨论什么，用户的目的/需求是什么\n" +
    "2. 已经得出的结论、决定，以及做出这些决定的原因\n" +
    "3. 被提出但最终被否决的方案，以及原因\n" +
    "4. 用户明确表达过的偏好、约束或背景信息\n" +
    "5. 还没有解决的问题，或者后续可能要接着聊的方向\n" +
    "删除寒暄、重复内容和无关的过渡语。请使用当前对话所使用的语言生成摘要。" +
    `摘要正文请控制在约 ${suggestedSummaryLength()} 字左右。只输出摘要正文，不要加标题或额外说明。`
  );
}

let settings = { ...DEFAULT_SETTINGS };
let topics = [];
let activeTopicId = null;
// Topic mid-delete-confirmation, if any: its delete button has been replaced
// by a "cancel" button (same spot) plus a "confirm" button to its left.
let confirmingDeleteTopicId = null;
let topicSearchQuery = "";
// Topics whose generation finished while they weren't the one being viewed.
// Intentionally in-memory only — never persisted, cleared by a page reload.
let unreadTopicIds = new Set();
// True while a compressTopic() call (auto-triggered or star-triggered) is in
// flight; disables all star buttons and blocks new sends until it settles.
let isSummarizing = false;
// Topic whose message list should show a "compressing..." placeholder divider.
let pendingSummaryTopicId = null;
let isStreaming = false;
let abortController = null;
// Why the current request was aborted: "user" (stop button) or "timeout".
let abortReason = null;
// Pending messages intentionally live only in memory. Refreshing the page clears them.
let queuedMessages = []; // { id: string, topicId: string, content: string }
let activeRequest = null; // { topicId: string, assistantText: string, bubble: HTMLElement|null }

// cryptoState is non-null only while a password-protected session is unlocked.
let cryptoState = null; // { key: CryptoKey, salt: Uint8Array }
// Whether a password is currently configured at all — distinct from
// cryptoState, which in hidden-messages mode may be null (no key cached yet
// this session) even though a password has genuinely been set up.
let passwordIsSet = false;
let idleTimer = null;
let isAppLocked = false;
const composingInputs = new WeakSet();
const compositionJustEndedInputs = new WeakSet();

const el = {
  app: document.querySelector(".app"),
  topicList: document.getElementById("topicList"),
  topicSearchInput: document.getElementById("topicSearchInput"),
  newTopicBtn: document.getElementById("newTopicBtn"),
  settingsBtn: document.getElementById("settingsBtn"),
  chatTitle: document.getElementById("chatTitle"),
  sidebarToggleBtn: document.getElementById("sidebarToggleBtn"),
  fontDecreaseBtn: document.getElementById("fontDecreaseBtn"),
  fontIncreaseBtn: document.getElementById("fontIncreaseBtn"),
  widthToggleBtn: document.getElementById("widthToggleBtn"),
  exportTopicBtn: document.getElementById("exportTopicBtn"),
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
  autoCompressThreshold: document.getElementById("autoCompressThreshold"),

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
  hiddenMessagesToggle: document.getElementById("hiddenMessagesToggle"),

  exportAllBtn: document.getElementById("exportAllBtn"),
  importBtn: document.getElementById("importBtn"),
  importFileInput: document.getElementById("importFileInput"),
  importStatus: document.getElementById("importStatus"),

  lockScreen: document.getElementById("lockScreen"),
  unlockPassword: document.getElementById("unlockPassword"),
  unlockError: document.getElementById("unlockError"),
  unlockBtn: document.getElementById("unlockBtn"),

  toast: document.getElementById("toast"),

  hiddenUnlockModal: document.getElementById("hiddenUnlockModal"),
  closeHiddenUnlockBtn: document.getElementById("closeHiddenUnlockBtn"),
  hiddenUnlockPassword: document.getElementById("hiddenUnlockPassword"),
  hiddenUnlockError: document.getElementById("hiddenUnlockError"),
  hiddenUnlockConfirmBtn: document.getElementById("hiddenUnlockConfirmBtn"),
};

// ---------- Storage ----------

async function persistState() {
  if (settings.hiddenMessagesEnabled) {
    await persistHiddenMode();
    return;
  }
  if (cryptoState) {
    const vault = await encryptWithKey(cryptoState.key, { settings, topics });
    await chrome.storage.local.set({ vault });
    // Guards against a stale plaintext copy surviving an interrupted enable/change flow.
    await chrome.storage.local.remove(["settings", "topics"]);
  } else {
    await chrome.storage.local.set({ settings, topics });
  }
}

// Hidden-messages mode: settings + non-hidden topics are always stored
// plain (the lock screen is never shown, so there's no password-derived key
// available at launch to decrypt anything with). Hidden-flagged topics are
// swept into an encrypted hiddenVault on *every* save — not just when the
// idle-lock timer fires — so on-disk storage never has a hidden topic
// sitting in plaintext, even if the browser closes before that timer ever
// gets a chance to run. They stay fully visible/editable in the live
// `topics` array in memory until lockHiddenMessages() actually removes them.
async function persistHiddenMode() {
  const hiddenTopics = topics.filter((t) => t.hidden);
  const visibleTopics = topics.filter((t) => !t.hidden);

  if (hiddenTopics.length === 0 || !cryptoState) {
    // Nothing to encrypt yet (no key cached this session means no topic can
    // have been flagged hidden yet either — that always requires the key).
    await chrome.storage.local.set({ settings, topics: visibleTopics });
    return;
  }

  const data = await chrome.storage.local.get(["hiddenVault"]);
  let combined = hiddenTopics;
  if (data.hiddenVault) {
    try {
      const existing = await decryptWithKey(cryptoState.key, data.hiddenVault.iv, data.hiddenVault.ciphertext);
      // A topic can be both "already vaulted from a previous save" and
      // "currently live" (e.g. it was revealed, then re-hidden, then edited)
      // — keep the live version for those, plus whatever else was vaulted.
      const liveIds = new Set(hiddenTopics.map((topic) => topic.id));
      combined = existing.filter((topic) => !liveIds.has(topic.id)).concat(hiddenTopics);
    } catch (e) {
      // Same key that encrypted it, so this shouldn't happen; if it does,
      // don't let it block saving the current session's hidden topics.
    }
  }
  const hiddenVault = await encryptWithKey(cryptoState.key, combined);
  await chrome.storage.local.set({ hiddenVault, settings, topics: visibleTopics });
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

// Backfills fields introduced after a topic may have already been persisted.
function normalizeTopic(topic) {
  if (!Array.isArray(topic.summaries)) topic.summaries = [];
  if (typeof topic.starred !== "boolean") topic.starred = false;
  if (typeof topic.starredAt !== "number") topic.starredAt = null;
  if (typeof topic.hidden !== "boolean") topic.hidden = false;
  return topic;
}

function createTopic() {
  const topic = {
    id: genId(),
    title: t("topic.default_title"),
    createdAt: Date.now(),
    model: settings.defaultModel,
    messages: [],
    summaries: [],
    starred: false,
    starredAt: null,
    hidden: false,
  };
  topics.unshift(topic);
  activeTopicId = topic.id;
  markTopicRead(topic.id);
  saveTopics();
  renderTopicList();
  renderMessages();
  updateHeader();
}

function getActiveTopic() {
  return topics.find((t) => t.id === activeTopicId) || null;
}

// A topic stops being "unread" the moment it becomes the one being viewed,
// however that happened (explicit selection, or a fallback after deleting
// the topic that was active) — called right before the render that would
// otherwise still show its badge.
function markTopicRead(id) {
  unreadTopicIds.delete(id);
}

function selectTopic(id) {
  activeTopicId = id;
  markTopicRead(id);
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
  unreadTopicIds.delete(id);
  if (activeTopicId === id) {
    activeTopicId = topics.length ? topics[0].id : null;
    if (activeTopicId) markTopicRead(activeTopicId);
  }
  if (confirmingDeleteTopicId === id) confirmingDeleteTopicId = null;
  saveTopics();
  renderTopicList();
  renderMessages();
  updateHeader();
}

function requestDeleteTopic(id, evt) {
  evt.stopPropagation();
  confirmingDeleteTopicId = id;
  renderTopicList();
}

function cancelDeleteTopic(evt) {
  evt.stopPropagation();
  confirmingDeleteTopicId = null;
  renderTopicList();
}

function renderTopicList() {
  el.topicList.innerHTML = "";
  const query = topicSearchQuery.trim().toLowerCase();
  const visibleTopics = query
    ? topics.filter((topic) => topic.title.toLowerCase().includes(query))
    : topics;
  for (const topic of visibleTopics) {
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

    item.addEventListener("mouseleave", (e) => {
      if (confirmingDeleteTopicId === topic.id) cancelDeleteTopic(e);
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

    item.appendChild(title);

    if (confirmingDeleteTopicId === topic.id) {
      item.classList.add("confirming-delete");

      const confirmBtn = document.createElement("button");
      confirmBtn.className = "topic-delete-confirm";
      confirmBtn.innerHTML = '<span class="confirm-glyph">✓</span>';
      confirmBtn.title = t("topic.delete_confirm_title");
      confirmBtn.addEventListener("click", (e) => deleteTopic(topic.id, e));

      // Same position the delete button occupies (leftmost of the pair), so a
      // second rapid click (double-click) lands here and cancels instead of
      // confirming. Confirm sits to its right, where the star button normally
      // is, so confirming requires a deliberate mouse move.
      const cancelBtn = document.createElement("button");
      cancelBtn.className = "topic-delete";
      cancelBtn.textContent = "↩";
      cancelBtn.title = t("topic.delete_cancel_title");
      cancelBtn.addEventListener("click", (e) => cancelDeleteTopic(e));

      item.appendChild(cancelBtn);
      item.appendChild(confirmBtn);
    } else {
      const del = document.createElement("button");
      del.className = "topic-delete";
      del.title = t("topic.delete_title");
      del.innerHTML =
        '<svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true">' +
        '<path d="M4 7h16M9 7V4h6v3m-8 0 1 13h8l1-13M10 11v5m4-5v5" ' +
        'fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>';
      del.addEventListener("click", (e) => requestDeleteTopic(topic.id, e));

      const starBtn = document.createElement("button");
      starBtn.className = "topic-star" + (topic.starred ? " starred" : "");
      starBtn.innerHTML = '<span class="star-glyph">★</span>';
      starBtn.title = t(topic.starred ? "topic.unstar_title" : "topic.star_title");
      starBtn.disabled = isStreaming || isSummarizing;
      starBtn.addEventListener("click", (e) => toggleStarTopic(topic.id, e));

      const actions = document.createElement("div");
      actions.className = "topic-actions";

      if (settings.hiddenMessagesEnabled) {
        const hideBtn = document.createElement("button");
        hideBtn.className = "topic-hidden-toggle" + (topic.hidden ? " active" : "");
        hideBtn.title = t(topic.hidden ? "hidden.unhide_title" : "hidden.hide_title");
        // Same inherited color as the other buttons in both states — a
        // colored icon would be invisible against the active/blue row
        // background. "Hidden" is conveyed only by the slash, not by color.
        hideBtn.innerHTML = topic.hidden
          ? '<svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true">' +
            '<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>' +
            '<circle cx="12" cy="12" r="2.6" fill="none" stroke="currentColor" stroke-width="1.6"/>' +
            '<line x1="3" y1="3" x2="21" y2="21" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>'
          : '<svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true">' +
            '<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>' +
            '<circle cx="12" cy="12" r="2.6" fill="none" stroke="currentColor" stroke-width="1.6"/></svg>';
        hideBtn.addEventListener("click", (e) => toggleHiddenTopic(topic.id, e));
        actions.appendChild(hideBtn);
      }

      actions.append(del, starBtn);

      // While this topic is generating (even in the background, not the one
      // currently viewed), overlay a dots indicator on top of the star/delete
      // slot; hovering the row hides it and reveals the normal buttons underneath.
      if (isStreaming && activeRequest?.topicId === topic.id) {
        const dots = document.createElement("div");
        dots.className = "topic-generating-dots";
        dots.innerHTML = '<span class="dot"></span><span class="dot"></span><span class="dot"></span>';
        actions.appendChild(dots);
      } else if (unreadTopicIds.has(topic.id)) {
        const unreadBadge = document.createElement("div");
        unreadBadge.className = "topic-unread-badge";
        unreadBadge.innerHTML = '<span class="unread-dot"></span>';
        actions.appendChild(unreadBadge);
      }

      item.appendChild(actions);
    }

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
    // A topic's model is only "locked in" once it has actually sent a message
    // (see sendMessage); before that, it should keep tracking the current
    // default so changing the default in Settings is reflected immediately.
    const effectiveModel = topic.messages.length > 0 ? topic.model : settings.defaultModel;
    el.modelSelect.value = effectiveModel || settings.defaultModel;
  }
  // The active topic just (potentially) changed — the send button must reflect
  // whether *this* topic is generating, not whatever topic is streaming globally.
  refreshComposerStreamingUI();
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

// ---------- Chat width ----------

function applyChatWidth() {
  const level = CHAT_WIDTH_LEVELS.includes(settings.chatWidthLevel) ? settings.chatWidthLevel : "normal";
  el.app.classList.toggle("chat-width-narrow", level === "narrow");
  el.app.classList.toggle("chat-width-wide", level === "wide");
  el.widthToggleBtn.dataset.widthState = level;
}

function cycleChatWidth() {
  const current = CHAT_WIDTH_LEVELS.includes(settings.chatWidthLevel) ? settings.chatWidthLevel : "normal";
  const next = CHAT_WIDTH_LEVELS[(CHAT_WIDTH_LEVELS.indexOf(current) + 1) % CHAT_WIDTH_LEVELS.length];
  settings.chatWidthLevel = next;
  applyChatWidth();
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
  const hasPendingSummary = Boolean(topic && pendingSummaryTopicId === topic.id);
  if (
    !topic ||
    (topic.messages.length === 0 && topicQueue.length === 0 && !hasActiveRequest && !hasPendingSummary)
  ) {
    el.messages.classList.add("is-empty");
    const empty = document.createElement("div");
    empty.className = "empty-state";
    empty.textContent = t("chat.empty");
    el.messages.appendChild(empty);
    return;
  }
  el.messages.classList.remove("is-empty");

  // Displayed 2 messages later than the real afterMessageIndex cutoff: that
  // lands the divider right where it first appeared as the pending "在生成
  // 摘要..." placeholder (right under the newest message at the moment
  // compression was triggered, since the cutoff itself excludes the last 2
  // messages) — it then stays fixed there rather than jumping once the
  // summary finishes. The stored afterMessageIndex itself (used by
  // getTailMessages/getCompressibleMessages) is unaffected by this — this
  // is purely a display offset.
  let summaryIdx = 0;
  topic.messages.forEach((msg, index) => {
    while (summaryIdx < topic.summaries.length && topic.summaries[summaryIdx].afterMessageIndex + 2 === index) {
      appendSummaryDivider(topic.summaries[summaryIdx]);
      summaryIdx += 1;
    }
    appendMessageBubble(msg.role, msg.content);
  });
  while (summaryIdx < topic.summaries.length) {
    appendSummaryDivider(topic.summaries[summaryIdx]);
    summaryIdx += 1;
  }
  if (hasPendingSummary) {
    appendPendingSummaryDivider();
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
  // isStreaming is global (only one request runs at a time, see sendMessage),
  // but the in-flight request may belong to a topic other than the one
  // currently being viewed — only show "generating" for its own topic.
  const isGeneratingHere = isStreaming && activeRequest?.topicId === activeTopicId;
  el.scrollIndicatorBtn.classList.remove("hidden");
  el.scrollIndicatorBtn.classList.toggle("generating", isGeneratingHere);
  el.scrollIndicatorBtn.classList.toggle("done", !isGeneratingHere);
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

// Clickable divider marking a compression checkpoint; expands to show the
// stored summary text. Expand/collapse state resets on the next re-render,
// consistent with this app's full-rerender pattern elsewhere.
function appendSummaryDivider(summary) {
  const wrapper = document.createElement("div");
  wrapper.className = "summary-divider";

  const line = document.createElement("button");
  line.type = "button";
  line.className = "summary-divider-line";
  line.textContent = `------ ${t("summary.divider_label")} ------`;

  const content = document.createElement("div");
  content.className = "summary-divider-content hidden";
  content.textContent = summary.text;

  line.addEventListener("click", () => content.classList.toggle("hidden"));

  wrapper.append(line, content);
  el.messages.appendChild(wrapper);
  return wrapper;
}

// Shown while a compressTopic() call is in flight, so a slow reply after
// sending is self-explanatory. Never stored — removed on the next re-render.
function appendPendingSummaryDivider() {
  const wrapper = document.createElement("div");
  wrapper.className = "summary-divider pending";
  const line = document.createElement("div");
  line.className = "summary-divider-line";
  line.textContent = `------ ${t("summary.pending_label")} ------`;
  wrapper.appendChild(line);
  el.messages.appendChild(wrapper);
  return wrapper;
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

// ---------- Toast ----------

let toastTimer = null;

function showToast(message) {
  el.toast.textContent = message;
  el.toast.classList.remove("hidden");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.toast.classList.add("hidden"), 2500);
}

// ---------- Auto-compression & starred context ----------

function getLatestSummary(topic) {
  return topic.summaries.length ? topic.summaries[topic.summaries.length - 1] : null;
}

// The "active tail": messages not yet folded into a summary. This is what
// actually gets sent, alongside the latest summary (if any) — always
// including the last 2 raw messages verbatim, since those are deliberately
// kept out of compression (see getCompressibleMessages).
function getTailMessages(topic) {
  const latest = getLatestSummary(topic);
  return latest ? topic.messages.slice(latest.afterMessageIndex) : topic.messages;
}

// The portion of the tail that's actually eligible to be folded into a new
// summary: everything except the last 2 raw messages. Those 2 are always
// left out of compression and sent verbatim, so the most recent exchange
// never gets blurred by summarization, and the prefix sent to the model
// only grows by one message per turn between compressions (better prefix
// cache reuse) instead of being rebuilt up to the very latest message.
// Skipped entirely for short conversations (<10 messages total) — there's
// no rolling-cache benefit to protect yet, and always excluding 2 messages
// would otherwise permanently block a brand-new topic from ever getting a
// summary (e.g. when starring it).
function getCompressibleMessages(topic) {
  const tail = getTailMessages(topic);
  if (topic.messages.length < 10) return tail;
  return tail.length > 2 ? tail.slice(0, tail.length - 2) : [];
}

function compressibleContentLength(topic) {
  return getCompressibleMessages(topic).reduce((sum, m) => sum + (m.content ? m.content.length : 0), 0);
}

// Hidden and non-hidden topics have entirely separate star pools: a hidden
// topic's summary is only ever injected into other hidden topics, and a
// non-hidden topic's only into other non-hidden ones — never across the
// boundary, so a starred sensitive/hidden topic can't leak its content into
// the context of an ordinary, fully-visible conversation.
function starredTopicsForInjection(currentTopic) {
  return topics
    .filter(
      (cand) =>
        cand.starred &&
        cand.id !== currentTopic.id &&
        cand.hidden === currentTopic.hidden &&
        getLatestSummary(cand)
    )
    .sort((a, b) => (a.starredAt || 0) - (b.starredAt || 0));
}

// Assembles the full messages array for a real chat request: user's system
// prompt, other starred topics' summaries, this topic's own rolling summary
// (if any), then the raw tail messages (including the just-pushed new one).
function buildApiMessages(topic) {
  const apiMessages = [];
  if (settings.systemPrompt && settings.systemPrompt.trim()) {
    apiMessages.push({ role: "system", content: settings.systemPrompt.trim() });
  }
  for (const starredTopic of starredTopicsForInjection(topic)) {
    const summary = getLatestSummary(starredTopic);
    apiMessages.push({
      role: "system",
      content: `以下是【${starredTopic.title}】的背景摘要：\n${summary.text}`,
    });
  }
  const ownSummary = getLatestSummary(topic);
  if (ownSummary) {
    apiMessages.push({ role: "system", content: `以下是本对话较早内容的摘要：\n${ownSummary.text}` });
  }
  for (const m of getTailMessages(topic)) {
    apiMessages.push({ role: m.role, content: m.content });
  }
  return apiMessages;
}

// Summarizes a topic's compressible tail — everything since the last summary
// except the most recent 2 raw messages, which stay untouched (see
// getCompressibleMessages) — rolled on top of the previous summary, if any,
// via one non-streaming request to its own model, then stores the result as
// a new checkpoint. Used both by the auto-compress threshold check and by
// star-triggering a topic with no summary yet.
// `force: true` ignores the last-2-messages exclusion and summarizes the
// entire tail instead — used when starring a topic that's too short (<=2
// messages) for the normal rule to ever produce anything compressible,
// which would otherwise permanently block it from ever getting a summary.
async function compressTopic(topic, { force = false } = {}) {
  if (!settings.apiKey) {
    openSettings();
    return false;
  }
  const tail = force ? getTailMessages(topic) : getCompressibleMessages(topic);
  if (tail.length === 0) return false;

  isSummarizing = true;
  pendingSummaryTopicId = topic.id;
  renderTopicList();
  if (topic.id === activeTopicId) renderMessages();

  // Leaves the last 2 messages out of this checkpoint — renderMessages
  // interleaves the finalized divider by this index, so it lands right
  // before them, not at the very end (only the in-progress placeholder
  // shows at the bottom, via hasPendingSummary in renderMessages). When
  // forced, there's nothing left deliberately raw — everything just got
  // folded in, so the divider correctly lands at the very end instead.
  const cutoff = force ? topic.messages.length : topic.messages.length - 2;
  const priorSummary = getLatestSummary(topic);
  let sourceText = "";
  if (priorSummary) {
    sourceText += `【之前的摘要】\n${priorSummary.text}\n\n`;
  }
  sourceText +=
    "【新增对话内容】\n" +
    tail.map((m) => `${m.role === "user" ? "用户" : "助手"}：${m.content}`).join("\n\n");

  const requestBody = buildRequestBody(
    {
      model: topic.model || settings.defaultModel,
      messages: [
        { role: "system", content: buildSummarySystemInstruction() },
        { role: "user", content: sourceText },
      ],
      stream: false,
    },
    {},
    parseExtraParams(settings.extraParams).value
  );

  let success = false;
  try {
    const url = joinUrl(settings.apiHost, "/chat/completions");
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${settings.apiKey}`,
      },
      body: JSON.stringify(requestBody),
    });
    if (!res.ok) throw new Error("summary request failed");
    const json = await res.json();
    const text = json.choices?.[0]?.message?.content?.trim();
    if (!text) throw new Error("empty summary");

    topic.summaries.push({ afterMessageIndex: cutoff, text, createdAt: Date.now() });
    await saveTopics();
    success = true;
  } catch (e) {
    success = false;
  } finally {
    isSummarizing = false;
    pendingSummaryTopicId = null;
    renderTopicList();
    if (topic.id === activeTopicId) renderMessages();
  }
  return success;
}

async function toggleStarTopic(topicId, evt) {
  evt.stopPropagation();
  if (isStreaming || isSummarizing) return;
  const topic = topics.find((cand) => cand.id === topicId);
  if (!topic) return;

  if (topic.starred) {
    topic.starred = false;
    topic.starredAt = null;
    saveTopics();
    renderTopicList();
    return;
  }

  // Separate cap per pool (hidden vs. non-hidden) — starring a hidden topic
  // doesn't compete with the 5 slots used by ordinary starred topics.
  const starredCount = topics.filter((cand) => cand.starred && cand.hidden === topic.hidden).length;
  if (starredCount >= MAX_STARRED_TOPICS) {
    showToast(t("star.max_reached"));
    return;
  }

  // Always (re)generate before starring if there's compressible tail content,
  // rather than only when no summary exists yet — in a long conversation the
  // user may star it well after the last checkpoint, and a stale summary would
  // silently miss everything said since. If the refresh attempt fails, fall
  // back to an existing summary (if any) rather than blocking the star.
  if (getCompressibleMessages(topic).length > 0) {
    const ok = await compressTopic(topic);
    if (!ok && !getLatestSummary(topic)) return;
  } else if (!getLatestSummary(topic)) {
    // Short topic (<=2 messages): the normal -2 rule leaves nothing
    // compressible, which would otherwise permanently block starring a
    // brand-new conversation. Force a one-off summary of everything it has
    // instead of refusing.
    if (getTailMessages(topic).length === 0) return; // truly empty, nothing to summarize
    const ok = await compressTopic(topic, { force: true });
    if (!ok) return;
  }

  topic.starred = true;
  topic.starredAt = Date.now();
  saveTopics();
  renderTopicList();
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
  if (isAppLocked || isStreaming || isSummarizing || queuedMessages.length === 0) return;
  const next = queuedMessages[0];
  void sendMessage(next.content, next.id);
}

async function sendMessage(text, queuedId = null) {
  if (!text || isStreaming || isSummarizing) return;

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

  const compressThreshold = Number(settings.autoCompressThreshold);
  const needsAutoCompress =
    settings.autoCompressThreshold && compressThreshold > 0 && compressibleContentLength(topic) > compressThreshold;

  // Fresh send (not a queue replay) that needs compressing first: park the
  // message in the per-topic send queue right away — same queued-bubble UI
  // used elsewhere — instead of blocking here, so the user doesn't have to
  // re-click send once the summary finishes. Compress in the background and
  // drain the queue when it settles. A replay never re-enters this branch
  // (even if compression failed and the tail is still over threshold), so a
  // failed attempt falls back to sending with the existing context once,
  // rather than retrying forever.
  if (!queuedMessage && needsAutoCompress) {
    enqueueMessage(text);
    void compressTopic(topic).then(() => drainMessageQueue());
    return;
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
  refreshComposerStreamingUI();

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

  const apiMessages = buildApiMessages(topic);

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
    // Flag as unread if this finished somewhere other than the topic the
    // user is currently looking at (regardless of success, error, or
    // timeout) — cleared the moment they actually open it.
    if (topic.id !== activeTopicId) unreadTopicIds.add(topic.id);
    refreshComposerStreamingUI();
    refreshScrollIndicator();
    renderTopicList();
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

const INPUT_MAX_HEIGHT = 200;

function autoResizeInput() {
  el.input.style.height = "auto";
  const contentHeight = el.input.scrollHeight;
  el.input.style.height = Math.min(contentHeight, INPUT_MAX_HEIGHT) + "px";
  // Only scroll once content genuinely exceeds the cap — otherwise a fresh
  // single-line textarea can show a spurious scrollbar from sub-pixel
  // scrollHeight/clientHeight rounding differences.
  el.input.style.overflowY = contentHeight > INPUT_MAX_HEIGHT ? "auto" : "hidden";
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

// isStreaming/activeRequest are global (only one request runs at a time — see
// sendMessage's mutex), but the in-flight request may belong to a topic other
// than the one currently being viewed. This is what the send button and the
// send-vs-stop click behavior must key off, not the raw isStreaming flag.
function isGeneratingActiveTopic() {
  return isStreaming && activeRequest?.topicId === activeTopicId;
}

function refreshComposerStreamingUI() {
  setComposerStreaming(isGeneratingActiveTopic());
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
  el.autoCompressThreshold.value = settings.autoCompressThreshold || "";
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

  const rawThreshold = el.autoCompressThreshold.value.trim();
  const thresholdNum = Number(rawThreshold);
  const autoCompressThreshold = rawThreshold && thresholdNum > 0 ? String(Math.floor(thresholdNum)) : "";

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
    autoCompressThreshold,
  };

  await saveSettings();
  populateModelSelect();
  updateHeader();
  closeSettings();
  resetIdleTimer();
  drainMessageQueue();
}

// ---------- Export / Import ----------

function topicToExportData(topic) {
  return {
    title: topic.title,
    messages: topic.messages.map((m) => ({ role: m.role, content: m.content })),
  };
}

async function exportCurrentTopic() {
  const topic = getActiveTopic();
  if (!topic) return;
  const html = await buildExportHtml([topicToExportData(topic)]);
  downloadHtmlFile(sanitizeFilename(topic.title) + ".html", html);
}

async function exportAllTopics() {
  if (topics.length === 0) {
    showToast(t("data.no_topics"));
    return;
  }
  const html = await buildExportHtml(topics.map(topicToExportData));
  const dateStr = new Date().toISOString().slice(0, 10);
  downloadHtmlFile(`llm-chat-export-${dateStr}.html`, html);
}

// Parsed import data awaiting user confirmation before it's committed to `topics`.
let pendingImportData = null;

function clearImportStatus() {
  el.importStatus.classList.remove("error");
  el.importStatus.innerHTML = "";
}

function showImportError(message) {
  pendingImportData = null;
  el.importStatus.classList.add("error");
  el.importStatus.textContent = message;
}

function showImportConfirm(count) {
  clearImportStatus();
  const msg = document.createElement("span");
  msg.textContent = t("data.import_found", { count });

  const confirmBtn = document.createElement("button");
  confirmBtn.className = "primary-btn small-btn";
  confirmBtn.textContent = t("data.import_confirm");
  confirmBtn.addEventListener("click", commitImport);

  const cancelBtn = document.createElement("button");
  cancelBtn.className = "secondary-btn small-btn";
  cancelBtn.textContent = t("data.import_cancel");
  cancelBtn.addEventListener("click", clearImportStatus);

  el.importStatus.append(msg, confirmBtn, cancelBtn);
}

function commitImport() {
  if (!pendingImportData) return;
  const newTopics = pendingImportData.map((entry) => ({
    id: genId(),
    title: entry.title,
    createdAt: Date.now(),
    model: settings.defaultModel,
    messages: entry.messages,
    summaries: [],
    starred: false,
    starredAt: null,
  }));
  // Prepended as a whole batch, in file order, so the file's first topic ends
  // up at the very top, above every existing topic.
  topics = [...newTopics, ...topics];
  const count = newTopics.length;
  pendingImportData = null;
  clearImportStatus();
  saveTopics();
  renderTopicList();
  showToast(t("data.import_success", { count }));
}

async function handleImportFileSelected() {
  const file = el.importFileInput.files[0];
  el.importFileInput.value = ""; // allow re-selecting the same file later
  if (!file) return;
  clearImportStatus();
  try {
    const text = await file.text();
    const parsed = parseImportedHtml(text);
    if (parsed.length === 0) {
      showImportError(t("data.import_none_found"));
      return;
    }
    pendingImportData = parsed;
    showImportConfirm(parsed.length);
  } catch (e) {
    showImportError(e.message);
  }
}

// ---------- Password protection ----------

function refreshPasswordUI() {
  el.passwordMsg.textContent = "";
  // passwordIsSet (not cryptoState) decides which form to show: in hidden-
  // messages mode a password can be fully configured while cryptoState is
  // still null (no key cached this session yet), and this form must still
  // read as "protection enabled", not prompt to set up a new password.
  if (passwordIsSet) {
    el.passwordStatus.textContent = t("pwd.status_enabled");
    el.passwordSetupForm.classList.add("hidden");
    el.passwordManageForm.classList.remove("hidden");
    el.currentPasswordForChange.value = "";
    el.changePassword1.value = "";
    el.changePassword2.value = "";
    el.hiddenMessagesToggle.checked = !!settings.hiddenMessagesEnabled;
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
  passwordIsSet = true;

  const passwordCheck = await encryptWithKey(key, { check: true });
  await chrome.storage.local.set({ vaultSalt: bufToBase64(salt), passwordCheck });
  await persistState();

  resetIdleTimer();
  showPasswordMsg(t("pwd.enabled_msg"));
  refreshPasswordUI();
}

// Mode-agnostic password check: tests against a small dedicated encrypted
// blob rather than the full vault, since in hidden-messages mode the vault
// may not exist at all (settings/topics are stored plain, only hiddenVault
// is encrypted, and that may not exist yet either). Reads vaultSalt fresh
// from storage rather than relying on cryptoState already being populated,
// since callers may run before any key has been cached this session.
async function verifyCurrentPassword(password) {
  const data = await chrome.storage.local.get(["vaultSalt", "passwordCheck"]);
  if (!data.vaultSalt || !data.passwordCheck) return false;
  try {
    const salt = new Uint8Array(base64ToBuf(data.vaultSalt));
    const testKey = await deriveKeyFromPassword(password, salt);
    await decryptWithKey(testKey, data.passwordCheck.iv, data.passwordCheck.ciphertext);
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

  // Carry the hidden vault forward (if any) so it stays decryptable after the
  // password/salt rotate below — otherwise any not-yet-revealed hidden topics
  // would become permanently unrecoverable.
  let migratedHiddenTopics = null;
  if (settings.hiddenMessagesEnabled) {
    const data = await chrome.storage.local.get(["vaultSalt", "hiddenVault"]);
    if (data.hiddenVault) {
      const oldSalt = new Uint8Array(base64ToBuf(data.vaultSalt));
      const oldKey = await deriveKeyFromPassword(oldP, oldSalt);
      migratedHiddenTopics = await decryptWithKey(oldKey, data.hiddenVault.iv, data.hiddenVault.ciphertext);
    }
  }

  const newSalt = randomBytes(16);
  const newKey = await deriveKeyFromPassword(newP1, newSalt);
  cryptoState = { key: newKey, salt: newSalt };
  const passwordCheck = await encryptWithKey(newKey, { check: true });
  const updates = { vaultSalt: bufToBase64(newSalt), passwordCheck };
  if (migratedHiddenTopics) {
    updates.hiddenVault = await encryptWithKey(newKey, migratedHiddenTopics);
  }
  await chrome.storage.local.set(updates);
  await persistState();

  showPasswordMsg(t("pwd.changed_msg"));
  refreshPasswordUI();
}

async function handleDisablePassword() {
  if (settings.hiddenMessagesEnabled) {
    showPasswordMsg(t("pwd.disable_requires_hidden_off"));
    return;
  }

  const oldP = el.currentPasswordForChange.value;
  if (!(await verifyCurrentPassword(oldP))) {
    showPasswordMsg(t("pwd.current_wrong"));
    return;
  }

  cryptoState = null;
  passwordIsSet = false;
  await chrome.storage.local.set({ settings, topics });
  await chrome.storage.local.remove(["vault", "vaultSalt", "passwordCheck"]);
  clearTimeout(idleTimer);

  showPasswordMsg(t("pwd.disabled_msg"));
  refreshPasswordUI();
}

// ---------- Hidden messages mode ----------

// Enabling requires no extra prompt: reaching Settings in classic mode
// already means the app was unlocked (cryptoState is populated), and this
// just changes how persistState()/idle-lock behave going forward.
async function handleEnableHiddenMessages() {
  if (!cryptoState) {
    el.hiddenMessagesToggle.checked = false;
    return;
  }
  settings.hiddenMessagesEnabled = true;
  // Switch off the whole-app vault immediately — from here on, persistState()
  // stores settings/topics plain and only hidden-flagged topics get encrypted.
  await chrome.storage.local.set({ settings, topics });
  await chrome.storage.local.remove(["vault"]);
  showPasswordMsg(t("hidden.enabled_msg"));
  renderTopicList();
}

// Disabling requires proving the current password (reusing the same field
// used for changing/disabling password protection) and decrypts+restores
// every still-hidden topic before turning the feature off, so nothing is
// ever silently stranded behind a disabled feature.
async function handleDisableHiddenMessages() {
  const password = el.currentPasswordForChange.value;
  if (!password) {
    showPasswordMsg(t("hidden.enter_password_to_disable"));
    el.hiddenMessagesToggle.checked = true;
    return;
  }
  if (!(await verifyCurrentPassword(password))) {
    showPasswordMsg(t("pwd.current_wrong"));
    el.hiddenMessagesToggle.checked = true;
    return;
  }

  const data = await chrome.storage.local.get(["vaultSalt", "hiddenVault"]);
  const salt = new Uint8Array(base64ToBuf(data.vaultSalt));
  const key = await deriveKeyFromPassword(password, salt);
  cryptoState = { key, salt };

  if (data.hiddenVault) {
    const restored = (await decryptWithKey(key, data.hiddenVault.iv, data.hiddenVault.ciphertext)).map(
      normalizeTopic
    );
    const existingIds = new Set(topics.map((topic) => topic.id));
    topics = topics.concat(restored.filter((topic) => !existingIds.has(topic.id)));
  }
  for (const topic of topics) topic.hidden = false;
  topics.sort((a, b) => b.createdAt - a.createdAt);
  await chrome.storage.local.remove(["hiddenVault"]);

  settings.hiddenMessagesEnabled = false;
  await persistState(); // now re-encrypts settings+topics into the classic vault

  renderTopicList();
  renderMessages();
  updateHeader();
  resetIdleTimer();
  showPasswordMsg(t("hidden.disabled_msg"));
}

// ---------- Eye toggle + hidden-unlock modal ----------

// Resolves once the user confirms or cancels the password prompt.
let hiddenUnlockResolve = null;
// "verify": just prove the password and cache the key (used when marking a
// topic hidden for the first time this session — nothing to merge back).
// "reveal": also decrypts hiddenVault and merges its topics back into view
// (used by the triple-click gesture on the search box).
let hiddenUnlockPurpose = null;

function promptHiddenUnlock(purpose) {
  return new Promise((resolve) => {
    hiddenUnlockPurpose = purpose;
    hiddenUnlockResolve = resolve;
    el.hiddenUnlockPassword.value = "";
    el.hiddenUnlockError.textContent = "";
    el.hiddenUnlockModal.classList.remove("hidden");
    el.hiddenUnlockPassword.focus();
  });
}

function closeHiddenUnlockModal(result) {
  el.hiddenUnlockModal.classList.add("hidden");
  const resolve = hiddenUnlockResolve;
  hiddenUnlockResolve = null;
  hiddenUnlockPurpose = null;
  if (resolve) resolve(result);
}

async function handleHiddenUnlockConfirm() {
  const password = el.hiddenUnlockPassword.value;
  const data = await chrome.storage.local.get(["vaultSalt", "passwordCheck", "hiddenVault"]);
  if (!data.vaultSalt || !data.passwordCheck) {
    el.hiddenUnlockError.textContent = t("unlock.no_data");
    return;
  }
  const salt = new Uint8Array(base64ToBuf(data.vaultSalt));
  const key = await deriveKeyFromPassword(password, salt);
  try {
    await decryptWithKey(key, data.passwordCheck.iv, data.passwordCheck.ciphertext);
  } catch (e) {
    el.hiddenUnlockError.textContent = t("unlock.wrong");
    return;
  }

  cryptoState = { key, salt };

  if (hiddenUnlockPurpose === "reveal" && data.hiddenVault) {
    const restored = (await decryptWithKey(key, data.hiddenVault.iv, data.hiddenVault.ciphertext)).map(
      normalizeTopic
    );
    // Defensive: never end up with two entries for the same id, however that
    // might happen.
    const existingIds = new Set(topics.map((topic) => topic.id));
    topics = topics.concat(restored.filter((topic) => !existingIds.has(topic.id)));
    topics.sort((a, b) => b.createdAt - a.createdAt);
    // Persist immediately: this re-encrypts the still-hidden topics (their
    // `hidden` flag is untouched by revealing — they stay visible for the
    // rest of this session but will be swept away again at the next lock)
    // into a fresh hiddenVault via persistHiddenMode(). Not calling this
    // here was the bug — it left the old hiddenVault deleted with nothing
    // written back yet, so anything revealed but not otherwise re-saved
    // (e.g. by sending a message) before the next lock event was lost for
    // good.
    await saveTopics();
    renderTopicList();
    renderMessages();
    updateHeader();
  }

  resetIdleTimer();
  closeHiddenUnlockModal(true);
}

async function toggleHiddenTopic(topicId, evt) {
  evt.stopPropagation();
  const topic = topics.find((cand) => cand.id === topicId);
  if (!topic) return;

  if (topic.hidden) {
    topic.hidden = false;
    saveTopics();
    renderTopicList();
    return;
  }

  if (!cryptoState) {
    const ok = await promptHiddenUnlock("verify");
    if (!ok) return;
  }

  topic.hidden = true;
  saveTopics();
  renderTopicList();
  resetIdleTimer();
}

// Triple-click (3 clicks within ~600ms) on the topic search box is the
// secret gesture to reveal hidden topics — deliberately not surfaced
// anywhere else in the UI.
let searchClickCount = 0;
let searchClickTimer = null;
function handleSearchBoxClick() {
  if (!settings.hiddenMessagesEnabled) return;
  searchClickCount += 1;
  clearTimeout(searchClickTimer);
  searchClickTimer = setTimeout(() => {
    searchClickCount = 0;
  }, 600);
  if (searchClickCount >= 3) {
    searchClickCount = 0;
    clearTimeout(searchClickTimer);
    void promptHiddenUnlock("reveal");
  }
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
    topics = (payload.topics || []).map(normalizeTopic);
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
  const handler = settings.hiddenMessagesEnabled ? lockHiddenMessages : lockApp;
  idleTimer = setTimeout(handler, minutes * 60 * 1000);
}

// Hidden-messages mode's equivalent of lockApp(): no lock screen, nothing
// else interrupted. Hidden-flagged topics are already kept encrypted in
// hiddenVault by every persistState() call, so this just needs to drop them
// from the live `topics` array and clear the cached key — no re-encryption
// necessary here.
function lockHiddenMessages() {
  clearTimeout(idleTimer);
  if (!cryptoState) return;
  const hiddenIds = new Set(topics.filter((t) => t.hidden).map((t) => t.id));
  if (hiddenIds.size === 0) {
    cryptoState = null;
    return;
  }
  if (isStreaming && abortController && activeRequest && hiddenIds.has(activeRequest.topicId)) {
    abortReason = "lock";
    abortController.abort();
  }
  topics = topics.filter((t) => !hiddenIds.has(t.id));
  // Always land on the first remaining topic once hiding triggers, rather
  // than only when the topic being viewed happened to be one of the hidden
  // ones — keeps the post-hide state predictable regardless of what was on
  // screen at the time.
  activeTopicId = topics.length ? topics[0].id : null;
  cryptoState = null;
  renderTopicList();
  renderMessages();
  updateHeader();
}

["click", "keydown", "mousemove", "input"].forEach((evt) => {
  document.addEventListener(evt, resetIdleTimer, { passive: true });
});
// Scroll events from nested scroll containers do not bubble. Capture them so
// scrolling the message list or settings modal also resets the idle timer.
document.addEventListener("scroll", resetIdleTimer, { passive: true, capture: true });

// ---------- Events ----------

el.newTopicBtn.addEventListener("click", createTopic);
el.topicSearchInput.addEventListener("input", () => {
  topicSearchQuery = el.topicSearchInput.value;
  renderTopicList();
});
el.topicSearchInput.addEventListener("click", handleSearchBoxClick);
el.settingsBtn.addEventListener("click", openSettings);
el.sidebarToggleBtn.addEventListener("click", toggleSidebar);
el.fontDecreaseBtn.addEventListener("click", () => adjustFontSize(-FONT_SIZE_STEP));
el.fontIncreaseBtn.addEventListener("click", () => adjustFontSize(FONT_SIZE_STEP));
el.widthToggleBtn.addEventListener("click", cycleChatWidth);
el.exportTopicBtn.addEventListener("click", () => void exportCurrentTopic());
el.exportAllBtn.addEventListener("click", () => void exportAllTopics());
el.importBtn.addEventListener("click", () => el.importFileInput.click());
el.importFileInput.addEventListener("change", () => void handleImportFileSelected());
el.closeSettingsBtn.addEventListener("click", closeSettings);
el.saveSettingsBtn.addEventListener("click", handleSaveSettings);
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
el.hiddenMessagesToggle.addEventListener("change", () => {
  if (el.hiddenMessagesToggle.checked) {
    void handleEnableHiddenMessages();
  } else {
    void handleDisableHiddenMessages();
  }
});

el.unlockBtn.addEventListener("click", handleUnlock);
installImeGuard(el.unlockPassword);
el.unlockPassword.addEventListener("keydown", (e) => {
  if (isImeConfirming(e)) return;
  if (e.key === "Enter") {
    e.preventDefault();
    handleUnlock();
  }
});

el.hiddenUnlockConfirmBtn.addEventListener("click", handleHiddenUnlockConfirm);
el.closeHiddenUnlockBtn.addEventListener("click", () => closeHiddenUnlockModal(false));
installImeGuard(el.hiddenUnlockPassword);
el.hiddenUnlockPassword.addEventListener("keydown", (e) => {
  if (isImeConfirming(e)) return;
  if (e.key === "Enter") {
    e.preventDefault();
    handleHiddenUnlockConfirm();
  }
});

el.sendBtn.addEventListener("click", () => {
  // isStreaming alone isn't enough here: it's global, but a background topic
  // may be the one generating while this button is drawn for a different,
  // idle topic — in that case a click should queue a message, not abort
  // whatever the other topic is doing.
  if (isGeneratingActiveTopic()) {
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
  applyChatWidth();
  populateModelSelect();
  autoResizeInput();

  if (topics.length === 0) {
    createTopic(); // sets activeTopicId and renders the topic list itself
  } else {
    activeTopicId = topics[0].id;
    renderTopicList();
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
  passwordIsSet = !!data.vaultSalt;
  if (data.vaultSalt && data.vault) {
    showLockScreen();
    return;
  }
  settings = { ...DEFAULT_SETTINGS, ...(data.settings || {}) };
  topics = (data.topics || []).map(normalizeTopic);
  hideLockScreen();
  startApp();
})();
