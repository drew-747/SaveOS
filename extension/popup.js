const $ = (id) => document.getElementById(id);
const logEl = $("log");
const pill = $("pill");
const OPTS_KEY = "saveos_opts";

function appendLog(msg) {
  const line = document.createElement("div");
  line.textContent = msg;
  logEl.appendChild(line);
  logEl.scrollTop = logEl.scrollHeight;
}

function segValue(id) {
  return $(id).querySelector("button.active")?.dataset.v;
}
function wireSeg(id) {
  $(id).addEventListener("click", (e) => {
    const btn = e.target.closest("button");
    if (!btn) return;
    $(id).querySelectorAll("button").forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");
    persist();
  });
}
["mediaFilter", "speed"].forEach(wireSeg);
["ownPosts", "saved", "skipDownloaded", "writeManifest"].forEach((id) =>
  $(id).addEventListener("change", persist)
);

function readOpts() {
  return {
    ownPosts: $("ownPosts").checked,
    saved: $("saved").checked,
    mediaFilter: segValue("mediaFilter"),
    speed: segValue("speed"),
    skipDownloaded: $("skipDownloaded").checked,
    writeManifest: $("writeManifest").checked,
  };
}
function persist() {
  chrome.storage.local.set({ [OPTS_KEY]: readOpts() });
}
async function restore() {
  const r = await chrome.storage.local.get(OPTS_KEY);
  const o = r[OPTS_KEY];
  if (!o) return;
  $("ownPosts").checked = o.ownPosts ?? true;
  $("saved").checked = o.saved ?? true;
  $("skipDownloaded").checked = o.skipDownloaded ?? true;
  $("writeManifest").checked = o.writeManifest ?? false;
  const setSeg = (id, v) => {
    const sel = $(id).querySelector(`button[data-v="${v}"]`);
    if (sel) { $(id).querySelectorAll("button").forEach((b) => b.classList.remove("active")); sel.classList.add("active"); }
  };
  if (o.mediaFilter) setSeg("mediaFilter", o.mediaFilter);
  if (o.speed) setSeg("speed", o.speed);
}
restore();

async function activeIgTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab || !/^https:\/\/www\.instagram\.com\//.test(tab.url || "")) return null;
  return tab;
}

function setRunning(isRunning, label) {
  $("start").disabled = isRunning;
  $("stop").disabled = !isRunning;
  document.body.classList.toggle("running", isRunning);
  pill.className = "pill" + (isRunning ? " run" : label === "done" ? " done" : "");
  pill.textContent = isRunning ? "Running" : label === "done" ? "Done" : "Idle";
}

function setStats(p) {
  if (typeof p.posts === "number") $("s-posts").textContent = p.posts;
  if (typeof p.files === "number") $("s-files").textContent = p.files;
  if (typeof p.skipped === "number") $("s-skipped").textContent = p.skipped;
  if (typeof p.failed === "number") $("s-failed").textContent = p.failed;
}

$("start").addEventListener("click", async () => {
  const tab = await activeIgTab();
  if (!tab) { appendLog("❌ Open & log into instagram.com in the active tab, then retry."); return; }
  const opts = readOpts();
  if (!opts.ownPosts && !opts.saved) { appendLog("❌ Pick at least one source."); return; }
  logEl.innerHTML = "";
  ["s-posts", "s-files", "s-skipped", "s-failed"].forEach((id) => ($(id).textContent = "0"));
  setRunning(true);
  try {
    await chrome.tabs.sendMessage(tab.id, { type: "START", opts });
  } catch {
    appendLog("❌ Couldn't reach the page. Reload the instagram.com tab and retry.");
    setRunning(false);
  }
});

$("stop").addEventListener("click", async () => {
  const tab = await activeIgTab();
  if (tab) chrome.tabs.sendMessage(tab.id, { type: "STOP" }).catch(() => {});
  appendLog("⏹️ Stopping after the current item…");
});

$("clear").addEventListener("click", async () => {
  await chrome.storage.local.remove("saveos_downloaded");
  appendLog("🗑️ Cleared download history — next run re-saves everything.");
});

chrome.runtime.onMessage.addListener((msg) => {
  if (msg.type === "LOG") appendLog(msg.msg);
  if (msg.type === "PROGRESS") {
    setStats(msg);
    if (msg.done) setRunning(false, "done");
  }
});
