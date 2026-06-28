// SaveOS content script — runs in the instagram.com page context so every
// request automatically carries your logged-in session cookies.

const IG_APP_ID = "936619743392459"; // public web app id used by instagram.com itself

// Speed presets: [delay between API pages, delay between downloads] in ms.
const SPEEDS = {
  safe:   [2500, 600],
  normal: [1500, 400],
  fast:   [700, 150],
};

const STORE_KEY = "saveos_downloaded"; // map of filename -> 1, for skip/resume

let running = false;
let cancelRequested = false;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function getCookie(name) {
  const m = document.cookie.match(new RegExp("(?:^|; )" + name + "=([^;]*)"));
  return m ? decodeURIComponent(m[1]) : null;
}

function log(msg) {
  chrome.runtime.sendMessage({ type: "LOG", msg }).catch(() => {});
}
function progress(update) {
  chrome.runtime.sendMessage({ type: "PROGRESS", ...update }).catch(() => {});
}

async function loadDownloaded() {
  try {
    const r = await chrome.storage.local.get(STORE_KEY);
    return new Set(Object.keys(r[STORE_KEY] || {}));
  } catch {
    return new Set();
  }
}
async function saveDownloaded(set) {
  const map = {};
  for (const k of set) map[k] = 1;
  try { await chrome.storage.local.set({ [STORE_KEY]: map }); } catch {}
}

async function apiGet(url) {
  const res = await fetch(url, {
    method: "GET",
    headers: {
      "X-IG-App-ID": IG_APP_ID,
      "X-Requested-With": "XMLHttpRequest",
      Accept: "*/*",
    },
    credentials: "include",
  });
  if (res.status === 429) throw new Error("RATE_LIMIT");
  if (!res.ok) throw new Error("HTTP " + res.status + " for " + url);
  return res.json();
}

function bestImage(media) {
  const c = media?.image_versions2?.candidates;
  if (!c || !c.length) return null;
  return c.reduce((a, b) => (a.width * a.height >= b.width * b.height ? a : b)).url;
}
function bestVideo(media) {
  const v = media?.video_versions;
  if (!v || !v.length) return null;
  return v.reduce((a, b) => (a.width * a.height >= b.width * b.height ? a : b)).url;
}

// Turn one media item into download tasks, honoring the media-type filter.
// Every post gets its OWN dated subfolder so nothing is dumped loose:
//   SaveOS_IG/MyPosts/2026-01-30_<shortcode>/<shortcode>_01.jpg
function extractFiles(media, folder, filter) {
  const files = [];
  const code = media.code || media.pk || media.id || "media";
  const datePrefix = media.taken_at
    ? new Date(media.taken_at * 1000).toISOString().slice(0, 10) + "_"
    : "";
  const postFolder = `${folder}/${datePrefix}${code}`;

  const pushOne = (m, suffix) => {
    const video = bestVideo(m);
    const isVideo = !!video;
    if (filter === "photos" && isVideo) return;
    if (filter === "videos" && !isVideo) return;
    if (isVideo) {
      files.push({ url: video, filename: `${postFolder}/${code}${suffix}.mp4` });
    } else {
      const img = bestImage(m);
      if (img) files.push({ url: img, filename: `${postFolder}/${code}${suffix}.jpg` });
    }
  };
  if (media.media_type === 8 && Array.isArray(media.carousel_media)) {
    media.carousel_media.forEach((child, i) =>
      pushOne(child, "_" + String(i + 1).padStart(2, "0"))
    );
  } else {
    pushOne(media, ""); // single-media post: <postFolder>/<code>.ext
  }
  return files;
}

function permalink(media) {
  const code = media.code || "";
  const isReel = media.product_type === "clips" || media.media_type === 2;
  return `https://www.instagram.com/${isReel ? "reel" : "p"}/${code}/`;
}

function manifestRow(media, fileCount) {
  const type =
    media.media_type === 8 ? "carousel" :
    media.media_type === 2 ? "video/reel" : "photo";
  const taken = media.taken_at ? new Date(media.taken_at * 1000).toISOString() : "";
  const caption = (media.caption?.text || "").replace(/\s+/g, " ").trim();
  const user = media.user?.username || "";
  return { code: media.code || "", type, user, taken, files: fileCount, caption, url: permalink(media) };
}

function toCSV(rows) {
  const esc = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  const head = ["code", "type", "user", "taken_at", "files", "caption", "url"];
  const lines = [head.join(",")];
  for (const r of rows) lines.push(head.map((h) => esc(r[h])).join(","));
  return lines.join("\r\n");
}

async function harvestFeed({ buildUrl, unwrap, folder, label, opts, ctx }) {
  const [pageDelay, dlDelay] = SPEEDS[opts.speed] || SPEEDS.normal;
  let maxId = null, more = true;

  while (more && !cancelRequested) {
    let data;
    try {
      data = await apiGet(buildUrl(maxId));
    } catch (e) {
      if (e.message === "RATE_LIMIT") {
        log("⚠️ Rate-limited by Instagram. Waiting 30s…");
        await sleep(30000);
        continue;
      }
      throw e;
    }

    for (const entry of data.items || []) {
      if (cancelRequested) break;
      const media = unwrap(entry);
      if (!media) continue;
      ctx.posts++;

      const files = extractFiles(media, folder, opts.mediaFilter);
      if (opts.writeManifest && files.length) ctx.manifest.push(manifestRow(media, files.length));

      for (const f of files) {
        if (cancelRequested) break;
        if (opts.skipDownloaded && ctx.downloaded.has(f.filename)) {
          ctx.skipped++;
          progress({ ...counts(ctx), label });
          continue;
        }
        const resp = await chrome.runtime.sendMessage({
          type: "DOWNLOAD", url: f.url, filename: f.filename,
        });
        if (resp && resp.ok) {
          ctx.files++;
          ctx.downloaded.add(f.filename);
          if (ctx.files % 20 === 0) saveDownloaded(ctx.downloaded);
        } else {
          ctx.failed++;
        }
        progress({ ...counts(ctx), label });
        await sleep(dlDelay);
      }
    }

    more = !!data.more_available;
    maxId = data.next_max_id || null;
    if (!maxId) more = false;
    log(`${label}: ${ctx.posts} posts scanned · ${ctx.files} saved · ${ctx.skipped} skipped`);
    if (more) await sleep(pageDelay);
  }
}

const counts = (ctx) => ({
  posts: ctx.posts, files: ctx.files, skipped: ctx.skipped, failed: ctx.failed,
});

async function run(opts) {
  if (running) return;
  running = true;
  cancelRequested = false;

  const userId = getCookie("ds_user_id");
  if (!userId) {
    log("❌ No login session found. Log into instagram.com in this tab first.");
    progress({ done: true });
    running = false;
    return;
  }

  const ctx = {
    posts: 0, files: 0, skipped: 0, failed: 0,
    downloaded: opts.skipDownloaded ? await loadDownloaded() : new Set(),
    manifest: [],
  };

  try {
    if (opts.ownPosts) {
      log("▶️ Collecting YOUR posts & reels…");
      await harvestFeed({
        buildUrl: (m) =>
          `https://www.instagram.com/api/v1/feed/user/${userId}/?count=33` +
          (m ? `&max_id=${encodeURIComponent(m)}` : ""),
        unwrap: (e) => e,
        folder: "SaveOS_IG/MyPosts",
        label: "My Posts",
        opts, ctx,
      });
    }
    if (opts.saved && !cancelRequested) {
      log("▶️ Collecting your SAVED items…");
      await harvestFeed({
        buildUrl: (m) =>
          `https://www.instagram.com/api/v1/feed/saved/posts/?count=33` +
          (m ? `&max_id=${encodeURIComponent(m)}` : ""),
        unwrap: (e) => e.media || e,
        folder: "SaveOS_IG/Saved",
        label: "Saved",
        opts, ctx,
      });
    }

    await saveDownloaded(ctx.downloaded);

    if (opts.writeManifest && ctx.manifest.length) {
      const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
      await chrome.runtime.sendMessage({
        type: "SAVE_TEXT",
        content: toCSV(ctx.manifest),
        mime: "text/csv",
        filename: `SaveOS_IG/manifest-${stamp}.csv`,
      });
      log(`🧾 Saved metadata manifest (${ctx.manifest.length} posts).`);
    }

    const tail = `${ctx.files} saved · ${ctx.skipped} skipped · ${ctx.failed} failed (${ctx.posts} posts)`;
    log(cancelRequested ? `⏹️ Stopped. ${tail}` : `✅ Done! ${tail}. See Downloads/SaveOS_IG.`);
  } catch (e) {
    log("❌ Error: " + e.message);
  } finally {
    progress({ ...counts(ctx), done: true });
    running = false;
  }
}

chrome.runtime.onMessage.addListener((msg, _s, sendResponse) => {
  if (msg.type === "START") { run(msg.opts); sendResponse({ ok: true }); }
  else if (msg.type === "STOP") { cancelRequested = true; sendResponse({ ok: true }); }
  else if (msg.type === "PING") { sendResponse({ ok: true, loggedIn: !!getCookie("ds_user_id") }); }
  return true;
});
