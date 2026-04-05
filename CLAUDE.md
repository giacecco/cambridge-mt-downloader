# Cambridge-MT Multitracks Downloader

## Source
https://multitracksearch.cambridge-mt.com/ms-mtk-search-ads.htm

## Destination
`/Volumes/home/music/multitracks/The Mixing Secrets`

## Scripts

### `cambridge-mt-download-playwright.ts`
Main download script. For each track that has a stems zip:
- Creates `Artist - Track` folder
- Downloads and extracts the zip
- Converts all audio to FLAC using `sox`
- Downloads the preview (`rough mix.mp3` for Full tracks, `excerpt.mp3` for Excerpt tracks — excerpt only if no rough mix exists for that folder)
- Caches the track list for 24h at `/tmp/cambridge-mt-tracks-cache.json`

## Legacy Scripts

- `legacy/cambridge-mt-fill-previews.ts` — one-time utility to add missing previews (main script now handles this)
- `legacy/flatten_multitracks.ts` — one-time migration to flatten `Artist/Track` structure

## Prerequisites

```bash
bunx playwright install chromium   # once
brew install sox
```

## Running

```bash
bun cambridge-mt-download-playwright.ts   # download new tracks + add missing previews
```

## Key Technical Notes

- **Cloudflare bypass**: `headless: false` is required for the search page. `cf_clearance` cookies are bound to the browser fingerprint, so the same browser instance must be used throughout — a headless instance cannot reuse cookies from a non-headless one.
- **Chromium window**: positioned off-screen (`--window-position=99999,0`) and muted (`--mute-audio`). Focus steal on macOS cannot be prevented via Chrome flags alone.
- **`waitUntil: "networkidle"`**: required to capture all 1400+ entries; `"load"` only captures ~35 because the page builds its JS data lazily.
- **Audio preview downloads**: browsers play MP3 inline — no `download` event fires. Previews are captured via `page.on("response")` body interception, with a fallback to `context.request.get()`.
- **Zip downloads**: use `waitForEvent("download")` + `download.saveAs()` to stream directly to disk, avoiding OOM on large zips.
- **Preview priority**: `Full` tracks → `rough mix.*`; `Excerpt` tracks → `excerpt.*` only if no rough mix exists. Entries are sorted rough-mixes-first so the skip check is reliable.
- **Track types**: `Full` (stems + rough mix preview), `Excerpt` (stems + excerpt preview), `Mstr` (master only — ignored entirely, no stems).
- **Mojibake**: artist/track names in the embedded JS are UTF-8 bytes stored as Latin-1 code points. `fixMojibake()` re-encodes each character as a byte then decodes as UTF-8.
