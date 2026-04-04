# Cambridge-MT Multitracks Downloader

Scripts for downloading the free multitracks library from [cambridge-mt.com](https://multitracksearch.cambridge-mt.com/ms-mtk-search-ads.htm) into a local collection.

## Requirements

- [Bun](https://bun.sh)
- Chromium via Playwright: `bunx playwright install chromium`
- `sox`: `brew install sox`

## Usage

Download all new tracks and add missing previews:

```bash
bun cambridge-mt-download-playwright.ts
```

Add missing previews to already-downloaded folders (faster — no zip downloads):

```bash
bun cambridge-mt-fill-previews.ts
```

## What it does

- Scrapes ~1400 tracks from the cambridge-mt search page (bypasses Cloudflare using a non-headless Chromium)
- Downloads stems zips, extracts them, and converts all audio to FLAC
- Downloads a preview for each track: `rough mix.mp3` (Full tracks) or `excerpt.mp3` (Excerpt tracks, only if no rough mix exists)
- Skips tracks already downloaded; re-running is safe

## Output structure

```
/Volumes/home/music/multitracks/The Mixing Secrets/
  Artist Name - Track Title/
    stem1.flac
    stem2.flac
    ...
    rough mix.mp3
```
