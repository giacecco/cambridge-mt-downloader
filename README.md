# Cambridge-MT Multitracks Downloader

## Why this exists

The multitrack library at cambridge-mt.com is an invaluable, freely shared educational resource. It is also one that could disappear at any time — websites go down, maintainers move on, hosting lapses. These scripts exist to create a local backup of that library for preservation and personal use.

It is worth noting that building these scripts was far harder than it needed to be. The site sits behind Cloudflare challenges, serves data through obfuscated JavaScript, and offers no API or structured feed. In an era where AI makes sophisticated automation accessible to anyone, these barriers do not meaningfully prevent downloading — they merely make it tedious. A simple, well-documented download mechanism (an RSS feed, a public API, even a plain file listing) would have made this entire repository unnecessary. Publishers of freely available resources have everything to gain and nothing to lose by making their content easy to access programmatically.

---

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
