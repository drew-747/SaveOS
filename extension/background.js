// SaveOS background service worker — handles the actual file writes.

function startDownload(opts, sendResponse) {
  chrome.downloads.download(opts, (downloadId) => {
    if (chrome.runtime.lastError) {
      chrome.runtime
        .sendMessage({ type: "LOG", msg: "⚠️ Download failed: " + chrome.runtime.lastError.message })
        .catch(() => {});
      sendResponse({ ok: false, error: chrome.runtime.lastError.message });
    } else {
      sendResponse({ ok: true, downloadId });
    }
  });
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.type === "DOWNLOAD") {
    startDownload(
      { url: msg.url, filename: msg.filename, conflictAction: "uniquify", saveAs: false },
      sendResponse
    );
    return true;
  }
  if (msg.type === "SAVE_TEXT") {
    // Write a generated text file (e.g. the CSV manifest) via a data URL.
    const dataUrl = `data:${msg.mime || "text/plain"};charset=utf-8,` + encodeURIComponent(msg.content);
    startDownload({ url: dataUrl, filename: msg.filename, conflictAction: "uniquify", saveAs: false }, sendResponse);
    return true;
  }
});
