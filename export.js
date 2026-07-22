"use strict";

// Builds and parses the self-contained HTML export/import format shared by
// "export current topic", "export all topics", and "import".
//
// The exported file embeds:
//   - chat.css and markdown.js, fetched verbatim at export time so the
//     exported page's look and its Markdown rendering never drift from the
//     live app.
//   - the topic data (title + raw messages only — no model/summaries/star,
//     which are internal bookkeeping that doesn't mean anything detached
//     from the app) as JSON in a #chat-export-data script tag. This is the
//     only thing import reads; everything else is just for human viewing.
//   - a small inline viewer script: a sidebar with title search when there's
//     more than one topic, otherwise just the message list.

async function fetchExtensionText(path) {
  const res = await fetch(chrome.runtime.getURL(path));
  return res.text();
}

// JSON embedded in an inline <script> tag must not contain a literal
// "</script" sequence, or the HTML parser will end the tag early. Escaping
// every "<" as its JSON unicode escape is the standard, fully safe fix.
function escapeJsonForInlineScript(value) {
  return JSON.stringify(value).replace(/</g, "\\u003c");
}

function sanitizeFilename(name) {
  return (name || "").replace(/[\\/:*?"<>|]+/g, "_").trim().slice(0, 80) || "untitled";
}

function downloadHtmlFile(filename, htmlContent) {
  const blob = new Blob([htmlContent], { type: "text/html" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function buildViewerScript(isMulti) {
  return `(function () {
    var data = JSON.parse(document.getElementById("chat-export-data").textContent);
    var activeIndex = 0;
    var messagesEl = document.getElementById("viewerMessages");
    var titleEl = document.getElementById("viewerTitle");

    function renderMessages(topic) {
      messagesEl.innerHTML = "";
      titleEl.textContent = topic.title;
      if (!topic.messages.length) {
        messagesEl.classList.add("is-empty");
        var empty = document.createElement("div");
        empty.className = "empty-state";
        empty.textContent = "（此对话没有消息）";
        messagesEl.appendChild(empty);
        return;
      }
      messagesEl.classList.remove("is-empty");
      topic.messages.forEach(function (msg) {
        var row = document.createElement("div");
        row.className = "message-row " + msg.role;
        var bubble = document.createElement("div");
        bubble.className = "bubble";
        if (msg.role === "assistant") {
          bubble.classList.add("markdown-body");
          bubble.innerHTML = mdRender(msg.content);
        } else {
          bubble.textContent = msg.content;
        }
        row.appendChild(bubble);
        messagesEl.appendChild(row);
      });
    }
    ${
      isMulti
        ? `
    var listEl = document.getElementById("viewerTopicList");
    var searchEl = document.getElementById("viewerSearch");
    function renderList(query) {
      listEl.innerHTML = "";
      var q = (query || "").trim().toLowerCase();
      data.forEach(function (topic, idx) {
        if (q && topic.title.toLowerCase().indexOf(q) === -1) return;
        var item = document.createElement("div");
        item.className = "topic-item" + (idx === activeIndex ? " active" : "");
        var titleSpan = document.createElement("span");
        titleSpan.className = "topic-title";
        titleSpan.textContent = topic.title;
        item.appendChild(titleSpan);
        item.addEventListener("click", function () {
          activeIndex = idx;
          renderList(searchEl.value);
          renderMessages(data[idx]);
        });
        listEl.appendChild(item);
      });
    }
    searchEl.addEventListener("input", function () {
      renderList(searchEl.value);
    });
    renderList("");
    `
        : ""
    }
    if (data.length) renderMessages(data[activeIndex]);
  })();`;
}

async function buildExportHtml(topicsData) {
  const [css, mdJs] = await Promise.all([
    fetchExtensionText("chat.css"),
    fetchExtensionText("markdown.js"),
  ]);

  const isMulti = topicsData.length > 1;
  const dataJson = escapeJsonForInlineScript(topicsData);
  const docTitle =
    topicsData.length === 1 ? topicsData[0].title : `LLM Chat 导出（${topicsData.length} 个对话）`;

  const sidebarMarkup = isMulti
    ? `<aside class="sidebar">
        <input type="search" class="topic-search-input" id="viewerSearch" placeholder="搜索对话…" />
        <div class="topic-list" id="viewerTopicList"></div>
      </aside>`
    : "";

  return `<!doctype html>
<html>
<head>
<meta charset="utf-8" />
<title>${mdEscapeHtml(docTitle)}</title>
<style>${css}</style>
</head>
<body>
  <div class="app">
    ${sidebarMarkup}
    <main class="chat-area">
      <header class="chat-header">
        <div class="header-left"><span id="viewerTitle"></span></div>
      </header>
      <div class="messages-wrapper">
        <div class="messages" id="viewerMessages"></div>
      </div>
    </main>
  </div>
  <script id="chat-export-data" type="application/json">${dataJson}</script>
  <script>${mdJs}</script>
  <script>${buildViewerScript(isMulti)}</script>
</body>
</html>`;
}

// Extracts and validates the topic data from a previously-exported file's
// text content. Throws a descriptive Error on any format problem; never
// attempts to parse arbitrary third-party HTML/Markdown.
function parseImportedHtml(text) {
  const doc = new DOMParser().parseFromString(text, "text/html");
  const scriptEl = doc.getElementById("chat-export-data");
  if (!scriptEl) {
    throw new Error(t("import.err_not_found"));
  }
  let data;
  try {
    data = JSON.parse(scriptEl.textContent);
  } catch (e) {
    throw new Error(t("import.err_parse", { msg: e.message }));
  }
  if (!Array.isArray(data)) {
    throw new Error(t("import.err_format"));
  }
  return data.map((entry) => ({
    title:
      entry && typeof entry.title === "string" && entry.title.trim()
        ? entry.title.trim()
        : t("topic.default_title"),
    messages: Array.isArray(entry && entry.messages)
      ? entry.messages
          .filter((m) => m && (m.role === "user" || m.role === "assistant") && typeof m.content === "string")
          .map((m) => ({ role: m.role, content: m.content }))
      : [],
  }));
}
