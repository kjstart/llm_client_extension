"use strict";

// Lightweight bilingual (zh / en) i18n. Language is auto-detected from the
// browser's preferred languages; zh-* → Chinese, everything else → English.

const MESSAGES = {
  zh: {
    "lock.hint": "数据已加密，请输入密码解锁",
    "lock.password_placeholder": "密码",
    "lock.unlock": "解锁",

    "sidebar.new_chat": "新对话",
    "sidebar.settings": "设置",
    "sidebar.toggle_title": "收起/展开侧边栏",

    "topic.default_title": "新对话",
    "topic.delete_title": "删除对话",

    "chat.empty": "开始新的对话吧",
    "chat.scroll_title": "滚动到最新消息",
    "queue.delete_title": "删除排队消息",

    "composer.placeholder": "输入消息，Enter 发送，Shift+Enter 换行…",
    "composer.send": "发送",
    "composer.stop_title": "停止生成",
    "composer.send_title": "发送",

    "font.decrease_title": "缩小字体",
    "font.increase_title": "放大字体",

    "width.toggle_title": "切换聊天区域宽度（80% / 100%）",

    "settings.title": "设置",
    "settings.api_host": "API Host",
    "settings.api_key": "API Key",
    "settings.model_list": "模型列表（逗号分隔）",
    "settings.default_model": "默认模型",
    "settings.temperature": "Temperature",
    "settings.top_p": "Top P",
    "settings.max_tokens": "Max Tokens",
    "settings.freq_penalty": "Frequency Penalty",
    "settings.system_prompt": "System Prompt（可选）",
    "settings.system_prompt_placeholder": "你是一个乐于助人的助手。",
    "settings.extra_params": "额外参数 / Extra Params（JSON，可选）",
    "settings.extra_params_hint":
      "合并进请求体，支持任意 OpenAI 兼容参数。<code>model</code>/<code>messages</code>/<code>stream</code> 由客户端管理无法覆盖；将某个标准参数设为 <code>null</code>（如 <code>{\"temperature\": null}</code>）可在本次请求中省略它。",
    "settings.password": "密码保护",
    "settings.auto_lock": "无操作自动锁定（分钟）",
    "settings.auto_lock_hint": "点击、输入、鼠标移动和滚动都会重新开始计时；仅在启用密码保护后生效。",
    "settings.save": "保存",

    "pwd.status_disabled": "未启用——数据以明文存储在本地",
    "pwd.status_enabled": "已启用——对话记录与设置已用 AES-256-GCM 加密存储",
    "pwd.new_placeholder1": "设置密码（至少 4 位）",
    "pwd.new_placeholder2": "确认密码",
    "pwd.enable": "启用密码保护",
    "pwd.current_placeholder": "当前密码",
    "pwd.change_placeholder1": "新密码（留空则不修改密码）",
    "pwd.change_placeholder2": "确认新密码",
    "pwd.change_btn": "修改密码",
    "pwd.disable_btn": "关闭密码保护",
    "pwd.min_len": "密码至少 4 位",
    "pwd.mismatch": "两次密码不一致",
    "pwd.enabled_msg": "密码保护已启用",
    "pwd.current_wrong": "当前密码不正确",
    "pwd.enter_new": "请输入新密码",
    "pwd.new_min_len": "新密码至少 4 位",
    "pwd.new_mismatch": "两次新密码不一致",
    "pwd.changed_msg": "密码已修改",
    "pwd.disabled_msg": "密码保护已关闭",

    "unlock.no_data": "未找到加密数据",
    "unlock.wrong": "密码错误，请重试",

    "err.timeout": "请求超时（{sec}s 无响应），已中止。",
    "err.stopped": "已停止生成。",
    "err.request_failed": "请求失败：{msg}",
    "err.empty_response": "服务器返回了空响应，未生成任何内容。",
    "err.json_parse": "JSON 解析失败：{msg}",
    "err.extra_not_object": "额外参数必须是一个 JSON 对象，例如 {\"reasoning_effort\": \"high\"}",
    "err.protected_key": "不能覆盖受保护的参数 \"{key}\"（model/messages/stream 由客户端管理）。",
    "err.unknown": "未知错误",
  },

  en: {
    "lock.hint": "Data is encrypted. Enter your password to unlock.",
    "lock.password_placeholder": "Password",
    "lock.unlock": "Unlock",

    "sidebar.new_chat": "New chat",
    "sidebar.settings": "Settings",
    "sidebar.toggle_title": "Collapse / expand sidebar",

    "topic.default_title": "New chat",
    "topic.delete_title": "Delete chat",

    "chat.empty": "Start a new conversation",
    "chat.scroll_title": "Scroll to latest message",
    "queue.delete_title": "Delete queued message",

    "composer.placeholder": "Type a message. Enter to send, Shift+Enter for a new line…",
    "composer.send": "Send",
    "composer.stop_title": "Stop generating",
    "composer.send_title": "Send",

    "font.decrease_title": "Decrease font size",
    "font.increase_title": "Increase font size",

    "width.toggle_title": "Toggle chat area width (80% / 100%)",

    "settings.title": "Settings",
    "settings.api_host": "API Host",
    "settings.api_key": "API Key",
    "settings.model_list": "Models (comma-separated)",
    "settings.default_model": "Default model",
    "settings.temperature": "Temperature",
    "settings.top_p": "Top P",
    "settings.max_tokens": "Max Tokens",
    "settings.freq_penalty": "Frequency Penalty",
    "settings.system_prompt": "System Prompt (optional)",
    "settings.system_prompt_placeholder": "You are a helpful assistant.",
    "settings.extra_params": "Extra Params (JSON, optional)",
    "settings.extra_params_hint":
      "Merged into the request body — any OpenAI-compatible parameter works. <code>model</code>/<code>messages</code>/<code>stream</code> are client-managed and cannot be overridden; set a standard param to <code>null</code> (e.g. <code>{\"temperature\": null}</code>) to omit it for the request.",
    "settings.password": "Password protection",
    "settings.auto_lock": "Auto-lock after inactivity (minutes)",
    "settings.auto_lock_hint": "Clicking, typing, moving the pointer, or scrolling restarts the timer. Only applies when password protection is enabled.",
    "settings.save": "Save",

    "pwd.status_disabled": "Disabled — data is stored locally in plain text.",
    "pwd.status_enabled": "Enabled — chats and settings are encrypted with AES-256-GCM.",
    "pwd.new_placeholder1": "Set a password (at least 4 characters)",
    "pwd.new_placeholder2": "Confirm password",
    "pwd.enable": "Enable password protection",
    "pwd.current_placeholder": "Current password",
    "pwd.change_placeholder1": "New password (leave blank to keep current)",
    "pwd.change_placeholder2": "Confirm new password",
    "pwd.change_btn": "Change password",
    "pwd.disable_btn": "Disable protection",
    "pwd.min_len": "Password must be at least 4 characters",
    "pwd.mismatch": "Passwords do not match",
    "pwd.enabled_msg": "Password protection enabled",
    "pwd.current_wrong": "Current password is incorrect",
    "pwd.enter_new": "Enter a new password",
    "pwd.new_min_len": "New password must be at least 4 characters",
    "pwd.new_mismatch": "New passwords do not match",
    "pwd.changed_msg": "Password changed",
    "pwd.disabled_msg": "Password protection disabled",

    "unlock.no_data": "No encrypted data found",
    "unlock.wrong": "Wrong password, please try again",

    "err.timeout": "Request timed out (no response for {sec}s), aborted.",
    "err.stopped": "Generation stopped.",
    "err.request_failed": "Request failed: {msg}",
    "err.empty_response": "The server returned an empty response with no content.",
    "err.json_parse": "JSON parse error: {msg}",
    "err.extra_not_object": "Extra params must be a JSON object, e.g. {\"reasoning_effort\": \"high\"}",
    "err.protected_key": "Cannot override the protected parameter \"{key}\" (model/messages/stream are client-managed).",
    "err.unknown": "Unknown error",
  },
};

function detectLang() {
  const langs =
    navigator.languages && navigator.languages.length
      ? navigator.languages
      : [navigator.language || "en"];
  for (const l of langs) {
    if (/^zh/i.test(l)) return "zh";
    if (/^en/i.test(l)) return "en";
  }
  return "en";
}

let CURRENT_LANG = detectLang();

function t(key, vars) {
  const table = MESSAGES[CURRENT_LANG] || MESSAGES.en;
  let str = table[key];
  if (str == null) str = MESSAGES.en[key];
  if (str == null) return key;
  if (vars) {
    for (const k of Object.keys(vars)) {
      str = str.replace(new RegExp("\\{" + k + "\\}", "g"), vars[k]);
    }
  }
  return str;
}

// Applies translations to elements tagged with data-i18n* attributes.
function applyI18n(root) {
  const scope = root || document;
  scope.querySelectorAll("[data-i18n]").forEach((el) => {
    el.textContent = t(el.getAttribute("data-i18n"));
  });
  scope.querySelectorAll("[data-i18n-placeholder]").forEach((el) => {
    el.setAttribute("placeholder", t(el.getAttribute("data-i18n-placeholder")));
  });
  scope.querySelectorAll("[data-i18n-title]").forEach((el) => {
    el.setAttribute("title", t(el.getAttribute("data-i18n-title")));
  });
  scope.querySelectorAll("[data-i18n-html]").forEach((el) => {
    el.innerHTML = t(el.getAttribute("data-i18n-html"));
  });
  document.documentElement.lang = CURRENT_LANG === "zh" ? "zh-CN" : "en";
}
