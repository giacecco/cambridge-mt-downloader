#!/usr/bin/env bun
// Playwright version of cambridge-mt-download.ts — works on macOS and Linux.
// Requires: bunx playwright install chromium (run once before first use)
import { existsSync, mkdirSync } from "fs";
import { join, extname, basename } from "path";
import { $ } from "bun";
import { chromium, type Browser, type BrowserContext } from "playwright";

const BASE_DIR = "/Volumes/home/music/multitracks/The Mixing Secrets";
const CACHE_FILE = "/tmp/cambridge-mt-tracks-cache.json";
const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

const AUDIO_EXTENSIONS = new Set([".wav", ".aiff", ".aif", ".mp3", ".ogg", ".flac"]);

interface Track {
  artist: string;
  track: string;
  pt: "Full" | "Excerpt";
  url: string;
  previewUrl: string;
}

// Shared browser + context — opened once, reused for all requests.
// Keeping a single context preserves Cloudflare cookies across all requests.
let browser: Browser | null = null;
let context: BrowserContext | null = null;

async function getContext(): Promise<BrowserContext> {
  if (!browser) browser = await chromium.launch({
    headless: false,
    args: ["--disable-blink-features=AutomationControlled", "--mute-audio", "--window-position=99999,0", "--window-size=800,600"],
  });
  if (!context) context = await browser.newContext({ acceptDownloads: true });
  return context;
}

async function closeBrowser(): Promise<void> {
  if (context) { await context.close(); context = null; }
  if (browser) { await browser.close(); browser = null; }
}

function fixMojibake(str: string): string {
  try {
    const bytes = Buffer.from([...str].map(c => c.charCodeAt(0)));
    return new TextDecoder("utf-8").decode(bytes);
  } catch {
    return str;
  }
}

function decodeHtmlEntities(str: string): string {
  return str
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(parseInt(n)));
}

function cleanTrackTitle(raw: string): string {
  return raw.replace(/^['\u2018\u2019]|['\u2018\u2019]$/g, "").trim();
}

function sanitizeName(name: string): string {
  return name.replace(/[\/\\:*?"<>|]/g, "-").replace(/\s+/g, " ").trim();
}

function folderName(artist: string, track: string): string {
  return `${sanitizeName(artist)} - ${sanitizeName(track)}`;
}

async function fetchPageViaPlaywright(): Promise<string> {
  console.log("[scrape] fetching page via Playwright (bypassing Cloudflare)…");
  const ctx = await getContext();
  const page = await ctx.newPage();
  try {
    await page.goto("https://multitracksearch.cambridge-mt.com/ms-mtk-search-ads.htm", {
      waitUntil: "networkidle",
      timeout: 120000,
    });
    // Wait for Cloudflare challenge to clear (title changes from "Just a moment...")
    await page.waitForFunction(
      () => !document.title.includes("Just a moment"),
      { timeout: 60000 }
    );
    const html = await page.content();
    if (!html.includes("var projects")) throw new Error("Page loaded but data not found");
    return html;
  } finally {
    await page.close();
  }
}

function parseTracksFromHtml(html: string): Track[] {
  const tracks: Track[] = [];
  const seenUrls = new Set<string>();

  const blockRe = /\{"s"[\s\S]*?(?=\{"s"|\]\s*;)/g;
  const artistRe = /"a":\s*"([^"]+)"/;
  const trackRe = /"p":\s*"'([^']+)'"/;
  const ptRe = /"pt":\s*"([^"]+)"/;
  const pvRe = /"pv":\s*"([^"]+)"/;
  const dlRe = /href="([^"]*\.zip[^"]*)"/;

  for (const match of html.matchAll(blockRe)) {
    const block = match[0];

    const ptMatch = block.match(ptRe);
    if (!ptMatch || (ptMatch[1] !== "Full" && ptMatch[1] !== "Excerpt")) continue;

    const dlMatch = block.match(dlRe);
    if (!dlMatch) continue;

    const artistMatch = block.match(artistRe);
    const trackMatch = block.match(trackRe);
    if (!artistMatch || !trackMatch) continue;

    const artist = fixMojibake(decodeHtmlEntities(artistMatch[1].trim()));
    const track = cleanTrackTitle(fixMojibake(decodeHtmlEntities(trackMatch[1].trim())));
    const url = dlMatch[1];
    const previewUrl = block.match(pvRe)?.[1] ?? "";

    if (!artist || !track || !url) continue;
    if (seenUrls.has(url)) continue;
    seenUrls.add(url);

    tracks.push({ artist, track, pt: ptMatch[1] as "Full" | "Excerpt", url, previewUrl });
  }

  return tracks;
}

async function scrapeTrackList(): Promise<Track[]> {
  if (existsSync(CACHE_FILE)) {
    const cache = JSON.parse(await Bun.file(CACHE_FILE).text());
    if (Date.now() - cache.ts < CACHE_TTL_MS) {
      console.log(`[scrape] using cached track list (${cache.tracks.length} entries, expires in ${Math.round((CACHE_TTL_MS - (Date.now() - cache.ts)) / 3600000)}h)`);
      return cache.tracks;
    }
  }

  const html = await fetchPageViaPlaywright();
  const tracks = parseTracksFromHtml(html);

  const full = tracks.filter(t => t.pt === "Full").length;
  const excerpt = tracks.filter(t => t.pt === "Excerpt").length;
  console.log(`[scrape] found ${tracks.length} downloadable entries (${full} Full, ${excerpt} Excerpt)`);
  await Bun.write(CACHE_FILE, JSON.stringify({ ts: Date.now(), tracks }, null, 2));
  return tracks;
}

async function convertToFlac(dir: string): Promise<void> {
  const glob = new Bun.Glob("**/*");
  const files = [...glob.scanSync({ cwd: dir, absolute: true })];

  for (const file of files) {
    const ext = extname(file).toLowerCase();
    if (!AUDIO_EXTENSIONS.has(ext) || ext === ".flac") continue;

    const flacPath = file.slice(0, -ext.length) + ".flac";
    if (existsSync(flacPath)) {
      console.log(`    [skip] already flac: ${basename(flacPath)}`);
      continue;
    }

    console.log(`    [convert] ${basename(file)} → flac`);
    const result = await $`sox "${file}" "${flacPath}"`.quiet().nothrow();
    if (result.exitCode === 0) {
      await $`rm "${file}"`.quiet();
    } else {
      console.error(`    [error] sox failed on ${basename(file)}: ${result.stderr.toString()}`);
    }
  }
}

async function downloadViaPlaywright(url: string, dest: string): Promise<boolean> {
  console.log(`    [playwright] downloading: ${decodeURIComponent(url.split("/").pop()!.split("?")[0])}`);
  const ctx = await getContext();
  const isAudio = /\.(mp3|wav|ogg|flac|aiff?)(\?|$)/i.test(url);

  if (isAudio) {
    // Audio files play inline — capture via response event, no download event fires.
    const page = await ctx.newPage();
    try {
      let capturedBody: Buffer | null = null;
      const urlBase = url.split("?")[0];
      page.on("response", async resp => {
        if (resp.url().startsWith(urlBase) && resp.status() === 200) {
          try { capturedBody = Buffer.from(await resp.body()); } catch {}
        }
      });
      await page.goto(url, { timeout: 10 * 60 * 1000, waitUntil: "commit" }).catch(() => {});
      await page.waitForFunction(() => !document.title.includes("Just a moment"), { timeout: 60000 }).catch(() => {});
      await new Promise(r => setTimeout(r, 2000));
      if (capturedBody && capturedBody.length > 0) {
        await Bun.write(dest, capturedBody);
        return existsSync(dest);
      }
      // Fallback: request API (uses browser cookie jar)
      const response = await ctx.request.get(url, { timeout: 10 * 60 * 1000 });
      if (!response.ok()) { console.error(`    [error] HTTP ${response.status()} for ${url}`); return false; }
      await Bun.write(dest, await response.body());
      return existsSync(dest);
    } catch (e) {
      console.error(`    [error] Playwright download failed: ${e}`);
      return false;
    } finally {
      await page.close();
    }
  } else {
    // Zip files: use download event so the browser streams directly to disk (avoids OOM).
    const page = await ctx.newPage();
    try {
      const [download] = await Promise.all([
        page.waitForEvent("download", { timeout: 10 * 60 * 1000 }),
        page.goto(url, { timeout: 60000 }).catch(() => {}),
      ]);
      await download.saveAs(dest);
      return existsSync(dest);
    } catch (e) {
      console.error(`    [error] Playwright download failed: ${e}`);
      return false;
    } finally {
      await page.close();
    }
  }
}

async function downloadPreview(previewUrl: string, destDir: string, name: string): Promise<void> {
  if (!previewUrl) return;
  const ext = extname(previewUrl.split("?")[0]) || ".mp3";
  const destFile = join(destDir, name + ext);
  if (existsSync(destFile)) return;
  console.log(`    [preview] downloading ${name}${ext}`);
  const ok = await downloadViaPlaywright(previewUrl, destFile);
  if (!ok) console.error(`    [error] preview download failed: ${previewUrl}`);
}

async function downloadViaCurl(url: string, destZip: string): Promise<boolean> {
  const result = await $`curl -L -s -o "${destZip}" "${url}"`.nothrow();
  return result.exitCode === 0;
}

async function downloadAndExtractZip(track: Track, destDir: string): Promise<boolean> {
  const tmpZip = join(destDir, "_download.zip");

  // All URLs go through Playwright so Cloudflare is bypassed uniformly;
  // plain curl still works fine for the open CDNs (mtkdata, zenodo).
  const needsBrowser = track.url.includes("multitracks.cambridge-mt.com");
  const downloadOk = needsBrowser
    ? await downloadViaPlaywright(track.url, tmpZip)
    : await downloadViaCurl(track.url, tmpZip);

  if (!downloadOk) {
    console.error(`  [error] download failed`);
    return false;
  }

  console.log(`  [unzip]`);
  const unzipResult = await $`unzip -q -o "${tmpZip}" -d "${destDir}"`.nothrow();
  await $`rm "${tmpZip}"`.quiet();

  // Remove Mac/Windows junk
  await $`find "${destDir}" -name "__MACOSX" -exec rm -rf {} + 2>/dev/null; find "${destDir}" -name "._*" -delete 2>/dev/null; find "${destDir}" -name ".DS_Store" -delete 2>/dev/null; true`.quiet();

  // Flatten single top-level subdirectory
  const topEntries = await $`ls -1A "${destDir}"`.quiet().text();
  const entries = topEntries.trim().split("\n").filter(Boolean);
  if (entries.length === 1) {
    const singleEntry = join(destDir, entries[0]);
    const stat = await $`test -d "${singleEntry}"`.nothrow();
    if (stat.exitCode === 0) {
      await $`mv "${singleEntry}"/* "${destDir}/" 2>/dev/null; mv "${singleEntry}"/.[!.]* "${destDir}/" 2>/dev/null; rmdir "${singleEntry}"; true`.quiet();
    }
  }

  if (unzipResult.exitCode !== 0) {
    console.error(`  [error] unzip failed (bad zip or dead URL)`);
    return false;
  }

  return true;
}

async function processTrack(track: Track): Promise<void> {
  const folder = folderName(track.artist, track.track);
  const destDir = join(BASE_DIR, folder);
  if (existsSync(destDir)) {
    // Folder exists — add preview if missing.
    // For Excerpt tracks: only add if no rough mix exists (rough mix takes priority).
    const files = require("fs").readdirSync(destDir) as string[];
    const hasRoughMix = files.some((f: string) => f.startsWith("rough mix."));
    const previewName = (track.pt === "Excerpt" && hasRoughMix) ? null : (track.pt === "Full" ? "rough mix" : "excerpt");

    if (previewName && track.previewUrl) {
      const ext = extname(track.previewUrl.split("?")[0]) || ".mp3";
      if (!existsSync(join(destDir, previewName + ext))) {
        console.log(`[update] ${folder} — adding ${previewName}`);
        await downloadPreview(track.previewUrl, destDir, previewName);
        return;
      }
    }
    console.log(`[exists] ${folder}`);
    return;
  }

  const previewName = track.pt === "Full" ? "rough mix" : "excerpt";

  console.log(`[download] ${folder} (${track.pt})`);
  mkdirSync(destDir, { recursive: true });

  const ok = await downloadAndExtractZip(track, destDir);
  if (!ok) {
    await $`rm -rf "${destDir}"`.quiet();
    return;
  }

  console.log(`  [convert] converting audio to flac`);
  await convertToFlac(destDir);

  await downloadPreview(track.previewUrl, destDir, previewName);

  console.log(`  [done] ${folder}`);
}

const tracks = await scrapeTrackList();
// Sort: Full entries first so folders exist before matching Excerpt entries arrive
tracks.sort((a, b) => (a.pt === "Full" ? -1 : 1) - (b.pt === "Full" ? -1 : 1) || a.artist.localeCompare(b.artist));
console.log(`\nProcessing ${tracks.length} entries…\n`);

for (const track of tracks) {
  await processTrack(track);
}

await closeBrowser();
console.log("\nAll done!");
