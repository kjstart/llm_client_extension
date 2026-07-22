chrome.tabs.create({ url: chrome.runtime.getURL("chat.html") }, () => {
  window.close();
});
