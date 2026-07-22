# LLM Chat Client

A lightweight, privacy-first Chrome extension that gives you a ChatGPT-like chat interface for any OpenAI-compatible LLM API (DeepSeek by default, but any compatible endpoint works). Everything runs locally in the browser — there is no backend server; your API key and conversations are stored only in `chrome.storage.local` on your machine, optionally encrypted with a password you set.

**[English](#english)** | **[中文](#中文)**

---

## English

### Features

- **Any OpenAI-compatible API** — point it at DeepSeek, OpenAI, or any self-hosted/compatible endpoint by changing the API host; configure multiple models and a default.
- **Multi-topic sidebar** — create, rename (double-click), search/filter, and delete conversations. Deleting requires two clicks (a "confirm" button appears to the side of "cancel", so a reflexive double-click cancels instead of deleting).
- **Streaming responses** with a stop button, request timeout/stall detection, and a message queue — you can send another message in the same or a different topic while one is still generating; queued messages wait their turn (only one request runs at a time; queuing is per-topic).
- **User messages** render as blue chat bubbles; **assistant messages** render as plain text directly on the background (no bubble), Markdown-formatted.
- **Auto-compression (rolling summarization)** — set a character threshold in Settings; when a topic's un-summarized history exceeds it, the client automatically asks the current model to produce a structured summary (goals, decisions & reasoning, rejected options, user preferences/constraints, open questions) before continuing. A permanent, collapsible "------ auto-summary ------" divider marks each checkpoint in the transcript, and only the latest summary + newer messages are sent afterward, keeping token usage from growing unbounded.
- **Starred topics as shared context** — star up to 5 topics (⭐, next to each topic's delete button) to inject their latest summaries as extra system-prompt context into every other topic's requests — a lightweight way to share background knowledge across conversations. Starring a topic with no summary yet triggers one immediately.
- **Adjustable chat width** (60% / 80% / 100%, single toggle button) and **font size** (A- / A+).
- **Password protection** — optionally encrypt all settings and conversation history at rest with AES-256-GCM (key derived via PBKDF2); auto-locks after a configurable idle period.
- **Bilingual UI** (简体中文 / English), auto-detected from the browser's language.
- **Custom request parameters** — set temperature, top-p, max tokens, frequency penalty, a system prompt, and arbitrary extra JSON parameters merged into every request body (for provider-specific options like `reasoning_effort` or `thinking`).

### Installation

1. Clone or download this repository.
2. Open `chrome://extensions` in Chrome (or any Chromium-based browser).
3. Enable **Developer mode** (top-right toggle).
4. Click **Load unpacked** and select this project's folder.
5. Click the extension icon to open the chat in a new tab.

### Setup

On first launch (or whenever no API key is configured) the Settings panel opens automatically:

1. **API Host** — e.g. `https://api.deepseek.com` (default), or any OpenAI-compatible base URL.
2. **API Key** — your provider's API key. Stored locally only; never sent anywhere except your configured API host.
3. **Models** — comma-separated list (e.g. `deepseek-chat, deepseek-reasoner`), plus a default model.
4. Optionally tune temperature/top-p/max tokens/frequency penalty, set a system prompt, enable password protection, or set an auto-compression threshold.

### Project structure

| File | Purpose |
|---|---|
| `manifest.json` | Chrome extension manifest (MV3) |
| `opener.html` / `opener.js` | Toolbar popup that opens the chat in a full tab |
| `chat.html` / `chat.css` / `chat.js` | The chat UI, styling, and application logic |
| `crypto.js` | AES-256-GCM encryption helpers (WebCrypto + PBKDF2) for password protection |
| `markdown.js` | Minimal Markdown renderer for assistant messages |
| `i18n.js` | Chinese/English string tables and the `t()` translation helper |

### Privacy & data storage

- All data (settings + conversations) lives in `chrome.storage.local` — nothing is sent to any third-party server except the LLM API host you configure, and only when you send a message.
- With password protection enabled, everything is encrypted with AES-256-GCM before being persisted; without it, data is stored in plain text locally.

### License

MIT — see [LICENSE](LICENSE).

---

## 中文

### 功能特性

- **兼容任意 OpenAI 风格 API** —— 默认使用 DeepSeek，也可以通过修改 API Host 指向 OpenAI 或任何自建/兼容服务；支持配置多个模型并设置默认模型。
- **多话题侧边栏** —— 创建、重命名（双击标题）、搜索过滤、删除对话。删除需要二次确认（"确认删除"按钮出现在"取消"按钮旁边，取消按钮和原删除按钮位置重叠，误触连续双击会变成取消而不是真的删除）。
- **流式回复**，带停止生成按钮、请求超时/卡顿检测，以及消息排队机制 —— 在某个对话生成回复期间，你可以在同一个或另一个对话里继续发送消息，消息会按顺序排队等待（同一时间只会有一个请求在生成，但排队是按对话分别记录的）。
- **用户消息**以蓝色气泡显示；**AI 回复**不使用气泡，直接以 Markdown 渲染的纯文本显示在背景上。
- **自动摘要压缩上下文** —— 在设置里填写字数阈值，当某个对话未压缩的历史内容超过这个长度时，客户端会自动请求当前模型生成一段结构化摘要（讨论目的、已达成的结论与理由、被否决的方案、用户偏好/约束、待解决的问题），再继续发送。对话记录中会永久保留一条可展开/收起的"------ 自动摘要 ------"分割线作为标记；此后只会发送"最新摘要 + 之后的新消息"，避免上下文随着对话变长无限膨胀。
- **收藏对话作为共享上下文** —— 最多可以收藏 5 个对话（对话行右侧的 ⭐ 按钮），被收藏对话的最新摘要会作为额外的系统提示词，注入到其它所有对话的请求里，用于在多个对话之间共享背景知识。收藏一个还没有摘要的对话会立即触发一次摘要生成。
- **可调节的对话区域宽度**（60% / 80% / 100%，一个按钮循环切换）和**字体大小**（A- / A+）。
- **密码保护** —— 可选启用后，所有设置与对话记录会用 AES-256-GCM 加密存储（密钥通过 PBKDF2 派生）；支持无操作自动锁定，锁定时长可配置。
- **中英文双语界面**，根据浏览器语言自动检测。
- **自定义请求参数** —— 可设置 temperature、top-p、max tokens、frequency penalty、系统提示词，以及任意额外 JSON 参数（会合并进每次请求体，用于配置 provider 专属参数，比如 `reasoning_effort` 或 `thinking`）。

### 安装方法

1. 克隆或下载本仓库。
2. 在 Chrome（或任意 Chromium 内核浏览器）中打开 `chrome://extensions`。
3. 打开右上角的 **开发者模式**。
4. 点击 **加载已解压的扩展程序**，选择本项目的文件夹。
5. 点击扩展图标即可在新标签页中打开聊天界面。

### 初次配置

首次启动（或尚未配置 API Key 时）会自动弹出设置面板：

1. **API Host** —— 例如 `https://api.deepseek.com`（默认值），或任意兼容 OpenAI 接口的地址。
2. **API Key** —— 你的服务商 API Key，仅保存在本地，只会发送给你配置的 API Host，不会发往其他任何地方。
3. **模型列表** —— 逗号分隔（例如 `deepseek-chat, deepseek-reasoner`），并设置一个默认模型。
4. 可选：调整 temperature/top-p/max tokens/frequency penalty、设置系统提示词、启用密码保护、设置自动压缩阈值。

### 项目结构

| 文件 | 说明 |
|---|---|
| `manifest.json` | Chrome 扩展清单（MV3） |
| `opener.html` / `opener.js` | 工具栏弹出窗口，用于在新标签页打开聊天界面 |
| `chat.html` / `chat.css` / `chat.js` | 聊天界面、样式与应用逻辑 |
| `crypto.js` | 密码保护所用的 AES-256-GCM 加密工具（基于 WebCrypto + PBKDF2） |
| `markdown.js` | 用于渲染 AI 回复的轻量级 Markdown 渲染器 |
| `i18n.js` | 中英文字符串表以及 `t()` 翻译辅助函数 |

### 隐私与数据存储

- 所有数据（设置与对话记录）都保存在 `chrome.storage.local` 中 —— 除了你配置的 LLM API Host（仅在你发送消息时），不会向任何第三方服务器发送任何数据。
- 启用密码保护后，所有数据会在存储前用 AES-256-GCM 加密；未启用时则以明文形式存储在本地。

### 许可证

MIT —— 详见 [LICENSE](LICENSE)。
