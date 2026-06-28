# SaveOS — Instagram Bulk Saver (Chrome Extension)

Download **all of your own Instagram posts/reels** and **everything you've Saved
(bookmarked)** in one go — no "Download your data" export, no re-login. It reuses
the Instagram session already open in your browser.

## How it works

The extension runs a small script on the `instagram.com` tab and calls the same
internal web API the site uses for itself, paginating through every post and saved
item and streaming each photo/video into your Downloads folder. Because it runs in
the page, your existing login cookies authenticate every request automatically.

## Install (Load Unpacked)

1. Open `chrome://extensions` in Chrome (or Edge: `edge://extensions`).
2. Toggle **Developer mode** on (top-right).
3. Click **Load unpacked** and select this `extension/` folder.
4. Pin the **SaveOS** icon to your toolbar.

## Use

1. Open **instagram.com** in a tab and make sure you're logged in.
2. Click the SaveOS toolbar icon.
3. Tick **My posts & reels** and/or **My Saved / bookmarked**.
4. Click **Start**. Watch the live log; click **Stop** anytime.

## Organized output

Everything goes under `Downloads/SaveOS_IG/`, and **each post gets its own dated
folder** so nothing is dumped loose:

```
Downloads/SaveOS_IG/
├─ MyPosts/
│  ├─ 2026-01-30_Cabc123/Cabc123.mp4          (a reel)
│  └─ 2026-01-12_Cdef456/                       (a carousel)
│        ├─ Cdef456_01.jpg
│        ├─ Cdef456_02.jpg
│        └─ Cdef456_03.jpg
├─ Saved/
│  └─ 2025-11-02_Cghi789/Cghi789.jpg
└─ manifest-2026-06-28-14-30-00.csv             (if enabled)
```

## Features

- **No scrolling** — walks Instagram's API cursors server-side; works for huge libraries.
- **Per-post folders**, prefixed with the post date for easy sorting.
- **Skip already-downloaded / resume** — interrupted runs pick up where they left off.
- **Media-type filter** — All / Photos / Videos/Reels.
- **Speed control** — Safe / Normal / Fast (trade speed vs. rate-limit safety).
- **Metadata manifest (CSV)** — optional export of code, type, date, caption, and link.
- **Live stats** — posts scanned, files saved, skipped, failed, with a progress bar.
- Options are remembered between runs; **Clear download history** resets the skip memory.

## Notes & limits

- **Your account only.** Intended for backing up your own content and the things
  you've saved. Don't point it at other people's private content.
- **Go gently.** Instagram rate-limits aggressive scraping. The extension already
  paces itself and backs off 30s on a `429`. If downloads stall, wait a few minutes.
- **Keep the popup open** if you want the live progress bar; downloads continue even
  if the popup closes, as long as the instagram.com tab stays open.
- If nothing happens, **reload the instagram.com tab** (so the content script loads)
  and try again.
- Instagram changes its internal API from time to time. If a feed stops returning
  items, the `X-IG-App-ID` or the `/api/v1/feed/...` paths may need updating in
  `content.js`.
