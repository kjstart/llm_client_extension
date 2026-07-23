# LLM Chat Client

A lightweight, privacy-first Chrome extension that gives you a ChatGPT-like chat interface for any OpenAI-compatible LLM API (DeepSeek by default, but any compatible endpoint works). Everything runs locally in the browser — there is no backend server; your API key and conversations are stored only in `chrome.storage.local` on your machine, optionally encrypted with a password you set.

**[English](#english)** | **[中文](#中文)**

---

## English

### Features

- **Any OpenAI-compatible API** — point it at DeepSeek, OpenAI, or any self-hosted/compatible endpoint by changing the API host; configure multiple models and a default.
- **Multi-topic sidebar** — create, rename (double-click), search/filter by title, and delete conversations. Deleting requires two clicks (a "confirm" button appears next to "cancel", positioned so a reflexive double-click cancels instead of deleting). Topics generating in the background show a three-dot indicator in place of the star/delete buttons, and topics that finished generating while you weren't looking at them get a small unread dot — both fade away on hover to reveal the normal buttons.
- **Streaming responses** with a stop button, request timeout/stall detection, and a message queue — you can send another message in the same or a different topic while one is still generating; queued messages wait their turn (only one request runs device-wide at a time; queuing itself is tracked per topic).
- **User messages** render as blue chat bubbles; **assistant messages** render as plain text directly on the background (no bubble), fully Markdown-formatted — headings, bold/italic/strikethrough, lists, task list checkboxes, tables, images, inline code/code blocks, blockquotes, links, backslash-escapes, and lightweight footnote support.
- **Rolling auto-compression** — set a character threshold in Settings (default 96000, minimum 10000; roughly 64000 is suggested for lighter/"flash"-class models); when a topic's compressible history exceeds it, the client automatically asks the current model for a structured summary (goals, decisions & reasoning, rejected options, user preferences/constraints, open questions) before continuing, targeting a suggested length of ~2% of the threshold (clamped between 200–5000 characters). The most recent 2 messages are always kept verbatim rather than folded into the summary (skipped for conversations under 10 messages, where there's nothing to gain from protecting them yet), so the freshest exchange never gets blurred and the prefix sent to the model grows predictably between compressions. A permanent, collapsible "------ auto-summary ------" divider marks each checkpoint where it actually happened; only the latest summary plus newer messages are sent afterward. If a send would trigger compression, the message is queued (shown immediately, input cleared) while the summary runs in the background, then sent automatically once it's ready — no need to click send twice.
- **Starred topics as shared context** — star up to 5 topics (⭐, in each topic row) to inject their latest summaries as extra system-prompt context into every other topic's requests, a lightweight way to share background knowledge across conversations. Starring a topic with no summary yet triggers one immediately, even if it only has a message or two. Hidden and non-hidden topics have entirely separate star pools (5 each) that never inject into one another.
- **Export & import** — export the current conversation, or all conversations, as a single self-contained `.html` file (via a button in the chat header, or in Settings) that opens as a nicely styled, readable, fully offline page (with a searchable topic list for multi-topic exports) in any browser — the underlying data is embedded as JSON so it can be imported straight back into the app from Settings, restoring topics in file order at the top of your topic list, after a confirmation showing how many were found. Exports are never encrypted, regardless of your password settings.
- **Adjustable chat width** (60% / 80% / 100%, single toggle button) and **font size** (A-/A+).
- **Password protection** — optionally encrypt all settings and conversation history at rest with AES-256-GCM (key derived via PBKDF2); auto-locks after a configurable idle period, showing a lock screen that requires the password again.
- **Hidden messages mode** — an alternative to the classic lock screen for individual sensitive conversations, see below.
- **Bilingual UI** (简体中文 / English), auto-detected from the browser's language.
- **Custom request parameters** — set temperature, top-p, max tokens, frequency penalty, a system prompt, and arbitrary extra JSON parameters merged into every request body (for provider-specific options like `reasoning_effort` or `thinking`).

### Hidden messages mode

Enabled from Settings (requires password protection to already be on) via "Use hidden messages instead of a lock screen (data is still encrypted)". This trades the classic full-app lock screen for a more granular, per-conversation approach:

- With it on, the app **never shows a lock screen** on launch — everything opens normally, immediately.
- Each topic gets an eye button (left of the delete button, hover-revealed like the star/delete buttons, deliberately not shown in any "always-on" highlighted state so nothing hints at a glance that a topic is flagged). Toggling it flags that topic as hidden.
- Whenever the idle-lock timer fires, or the app is freshly opened, every topic flagged hidden disappears from the sidebar and from memory — nothing else is interrupted, whatever else you were doing keeps working. The disappeared topics remain safely stored, encrypted with AES-256-GCM under your password (kept continuously up to date on every save, not just at lock time, so nothing is lost even if the browser closes before the idle timer ever fires).
- To bring them back: triple-click the topic search box (a deliberately undocumented gesture) and enter your password. On success, every hidden topic is decrypted and merged back into the list at its original position, fully functional again, until the next lock event hides it again.
- Turning the feature back off requires entering your current password first, which decrypts and permanently restores every still-hidden topic before switching back to classic full-app encryption.
- A hidden topic's title renders in italics as a subtle (not stealthy) visual cue while it's visible in the list.
- Starring interacts with hiding exactly as described above: separate 5-slot pools, no cross-injection between hidden and non-hidden topics.

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
4. Optionally tune temperature/top-p/max tokens/frequency penalty, set a system prompt, enable password protection (and hidden messages mode), or set an auto-compression threshold.

### Project structure

| File | Purpose |
|---|---|
| `manifest.json` | Chrome extension manifest (MV3) |
| `opener.html` / `opener.js` | Toolbar popup that opens the chat in a full tab |
| `chat.html` / `chat.css` / `chat.js` | The chat UI, styling, and application logic |
| `crypto.js` | AES-256-GCM encryption helpers (WebCrypto + PBKDF2) for password protection and hidden messages mode |
| `markdown.js` | Dependency-free Markdown renderer for assistant messages |
| `export.js` | Builds/parses the self-contained HTML export/import format |
| `i18n.js` | Chinese/English string tables and the `t()` translation helper |

### Privacy & data storage

- All data (settings + conversations) lives in `chrome.storage.local` — nothing is sent to any third-party server except the LLM API host you configure, and only when you send a message.
- With password protection enabled (classic mode), everything is encrypted with AES-256-GCM before being persisted. With hidden messages mode enabled instead, only topics you've flagged hidden are encrypted; everything else is stored plain, since the app no longer gates access behind a lock screen. Without any password set, all data is stored in plain text locally.
- Exported `.html` files (single topic or all topics) are always plain text/unencrypted, regardless of your password settings — keep them somewhere safe.

### License

MIT — see [LICENSE](LICENSE).

---

## 中文

### 功能特性

- **兼容任意 OpenAI 风格 API** —— 默认使用 DeepSeek，也可以通过修改 API Host 指向 OpenAI 或任何自建/兼容服务；支持配置多个模型并设置默认模型。
- **多话题侧边栏** —— 创建、重命名（双击标题）、按标题搜索过滤、删除对话。删除需要二次确认（"确认删除"按钮出现在"取消"按钮旁边，取消按钮和原删除按钮位置重叠，误触连续双击会变成取消而不是真的删除）。正在后台生成回复的话题会在星标/删除按钮位置显示三个点的动画；生成完成但你没在看的话题会显示一个小的未读圆点——两者鼠标悬停时都会淡出，露出正常的按钮。
- **流式回复**，带停止生成按钮、请求超时/卡顿检测，以及消息排队机制 —— 在某个对话生成回复期间，你可以在同一个或另一个对话里继续发送消息，消息会按顺序排队等待（全局同一时间只会有一个请求在生成，但排队本身是按对话分别记录的）。
- **用户消息**以蓝色气泡显示；**AI 回复**不使用气泡，直接以完整 Markdown 渲染的纯文本显示在背景上——支持标题、粗体/斜体/删除线、列表、任务列表复选框、表格、图片、行内代码/代码块、引用块、链接、反斜杠转义，以及轻量级脚注支持。
- **滚动式自动压缩上下文** —— 在设置里填写字数阈值（默认 96000，最小 10000；轻量/flash 类模型建议约 64000），当某个对话可压缩的历史内容超过这个长度时，客户端会自动请求当前模型生成一段结构化摘要（讨论目的、已达成的结论与理由、被否决的方案、用户偏好/约束、待解决的问题），目标长度约为阈值的 2%（限制在 200～5000 字之间）。最近 2 条消息始终原样保留、不参与摘要（对话总数不足 10 条时不做这个保护，因为此时保护意义不大），保证最新的对话内容不会被摘要模糊掉，也让发给模型的前缀在两次压缩之间可预期地增长。对话记录中会在真正压缩发生的位置永久保留一条可展开/收起的"------ 自动摘要 ------"分割线；此后只会发送"最新摘要 + 之后的新消息"。如果发送消息会触发压缩，这条消息会先排队显示（输入框立即清空），摘要在后台生成，生成完成后自动发送——不需要重新点一次发送。
- **收藏对话作为共享上下文** —— 最多可以收藏 5 个对话（每个对话行上的 ⭐ 按钮），被收藏对话的最新摘要会作为额外的系统提示词，注入到其它所有对话的请求里，用于在多个对话之间共享背景知识。收藏一个还没有摘要的对话会立即触发一次摘要生成，哪怕只有一两条消息。隐藏对话和非隐藏对话的星标池完全独立（各自最多 5 个），互不注入。
- **导出与导入** —— 可以把当前对话或全部对话导出为一个自包含的 `.html` 文件（聊天界面右上角按钮，或在设置页），用任意浏览器打开就是一个排版好看、可离线阅读的页面（批量导出会带一个可搜索的话题列表）；底层数据以 JSON 形式内嵌在文件里，可以直接在设置页把它导入回应用——导入前会先提示解析到多少个对话，确认后按文件里的顺序插入到话题列表最上方。导出的文件永远不会加密，不管你有没有开启密码保护。
- **可调节的对话区域宽度**（60% / 80% / 100%，一个按钮循环切换）和**字体大小**（A- / A+）。
- **密码保护** —— 可选启用后，所有设置与对话记录会用 AES-256-GCM 加密存储（密钥通过 PBKDF2 派生）；支持无操作自动锁定，锁定时长可配置，触发后会显示需要重新输入密码的锁屏。
- **隐藏消息模式** —— 针对单个敏感对话的、区别于传统锁屏的另一种保护方式，见下文。
- **中英文双语界面**，根据浏览器语言自动检测。
- **自定义请求参数** —— 可设置 temperature、top-p、max tokens、frequency penalty、系统提示词，以及任意额外 JSON 参数（会合并进每次请求体，用于配置 provider 专属参数，比如 `reasoning_effort` 或 `thinking`）。

### 隐藏消息模式

在设置页开启（需要先启用密码保护），开关文案是"使用隐藏消息代替锁屏密码（数据也会被加密）"。这会把"整个应用锁屏"换成更细粒度的、按对话隔离的保护方式：

- 开启后，打开应用**不会再显示锁屏页面**——一切正常直接打开，不用输密码。
- 每个对话行上会出现一个眼睛按钮（在删除按钮左侧，和星标/删除按钮一样只在悬停时才显示，并且刻意不做任何"常亮"的高亮状态，所以光扫一眼列表看不出哪个对话被标记过）。点击它就把这个对话标记为"隐藏"。
- 每当空闲锁定计时器触发，或者重新打开应用时，所有被标记隐藏的对话会从侧边栏和内存里消失——其它一切都不受影响，你手头在做的事情照常继续。消失的对话仍然安全地保存着，用你的密码以 AES-256-GCM 加密（每次保存都会持续保持最新状态，不是只在锁定那一刻才加密，所以哪怕浏览器在空闲计时器触发之前就被关掉，也不会丢数据）。
- 找回它们：在话题搜索框上连续点击三下（一个刻意不写在界面说明里的手势），输入密码。成功后，所有隐藏对话会被解密，按原来的位置合并回话题列表，功能完全恢复正常，直到下一次锁定事件再次把它们隐藏。
- 关闭这个功能需要先输入当前密码，验证通过后会把所有还处于隐藏状态的对话解密并永久恢复，然后切回传统的整个应用加密模式。
- 一个对话被标记隐藏后，只要它还显示在列表里，标题就会用斜体展示，作为一个低调（但并非刻意隐蔽）的视觉提示。
- 星标和隐藏的交互如上文所述：两个池子各自独立 5 个名额，隐藏对话和非隐藏对话之间不会互相注入摘要。

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
4. 可选：调整 temperature/top-p/max tokens/frequency penalty、设置系统提示词、启用密码保护（以及隐藏消息模式）、设置自动压缩阈值。

### 项目结构

| 文件 | 说明 |
|---|---|
| `manifest.json` | Chrome 扩展清单（MV3） |
| `opener.html` / `opener.js` | 工具栏弹出窗口，用于在新标签页打开聊天界面 |
| `chat.html` / `chat.css` / `chat.js` | 聊天界面、样式与应用逻辑 |
| `crypto.js` | 密码保护与隐藏消息模式所用的 AES-256-GCM 加密工具（基于 WebCrypto + PBKDF2） |
| `markdown.js` | 用于渲染 AI 回复的无依赖 Markdown 渲染器 |
| `export.js` | 构建/解析自包含 HTML 导出导入格式 |
| `i18n.js` | 中英文字符串表以及 `t()` 翻译辅助函数 |

### 隐私与数据存储

- 所有数据（设置与对话记录）都保存在 `chrome.storage.local` 中 —— 除了你配置的 LLM API Host（仅在你发送消息时），不会向任何第三方服务器发送任何数据。
- 启用密码保护（传统模式）后，所有数据会在存储前用 AES-256-GCM 加密；如果启用的是隐藏消息模式，则只有被标记隐藏的对话会被加密，其余数据以明文存储（因为此时应用不再用锁屏挡住访问）；如果都没启用，所有数据都以明文形式存储在本地。
- 导出的 `.html` 文件（单个对话或全部对话）永远是明文、不加密的，不管你有没有开启密码保护——请自行妥善保管。

### 许可证

MIT —— 详见 [LICENSE](LICENSE)。
