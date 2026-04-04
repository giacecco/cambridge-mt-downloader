#!/usr/bin/env bun
// Fetches preview URLs for ALL tracks on cambridge-mt (including those without zip downloads)
// and adds missing previews to folders that already exist locally.
// Requires: bunx playwright install chromium (run once before first use)
import { existsSync } from "fs";
import { join, extname } from "path";
import { chromium, type Browser, type BrowserContext } from "playwright";

const BASE_DIR = "/Volumes/home/music/multitracks/The Mixing Secrets";

// Single non-headless browser kept tiny (1×1px) so it's invisible in practice.
// Cloudflare requires non-headless; the window size makes it unobtrusive.
let browser: Browser | null = null;
let context: BrowserContext | null = null;

async function getContext(): Promise<BrowserContext> {
  if (!browser) browser = await chromium.launch({
    headless: false,
    args: [
      "--disable-blink-features=AutomationControlled",
      "--mute-audio",
      "--window-position=99999,0",
      "--window-size=800,600",
    ],
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

interface PreviewEntry {
  folder: string;
  previewUrl: string;
  previewName: string;
}

async function fetchPageViaPlaywright(): Promise<string> {
  console.log("[scrape] fetching page via Playwright…");
  const ctx = await getContext();
  const page = await ctx.newPage();
  try {
    await page.goto("https://multitracksearch.cambridge-mt.com/ms-mtk-search-ads.htm", {
      waitUntil: "networkidle",
      timeout: 120000,
    });
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

function parseAllPreviews(html: string): PreviewEntry[] {
  const entries: PreviewEntry[] = [];
  const seen = new Set<string>();

  const blockRe = /\{"s"[\s\S]*?(?=\{"s"|\]\s*;)/g;
  const artistRe = /"a":\s*"([^"]+)"/;
  const trackQuotedRe = /"p":\s*"'([^']+)'"/;
  const trackPlainRe = /"p":\s*"([^"]+)"/;
  const ptRe = /"pt":\s*"([^"]+)"/;
  const pvRe = /"pv":\s*"([^"]+)"/;

  for (const match of html.matchAll(blockRe)) {
    const block = match[0];

    const ptMatch = block.match(ptRe);
    if (!ptMatch) continue;
    const pt = ptMatch[1];
    if (pt !== "Full" && pt !== "Excerpt") continue;

    const pvMatch = block.match(pvRe);
    if (!pvMatch || !pvMatch[1]) continue;

    const artistMatch = block.match(artistRe);
    if (!artistMatch) continue;

    const trackMatch = block.match(trackQuotedRe) ?? block.match(trackPlainRe);
    if (!trackMatch) continue;

    const artist = fixMojibake(decodeHtmlEntities(artistMatch[1].trim()));
    const track = cleanTrackTitle(fixMojibake(decodeHtmlEntities(trackMatch[1].trim())));
    if (!artist || !track) continue;

    const folder = folderName(artist, track);
    const previewUrl = pvMatch[1];
    const previewName = pt === "Excerpt" ? "excerpt" : "rough mix";
    const key = `${folder}::${previewName}`;
    if (seen.has(key)) continue;
    seen.add(key);

    entries.push({ folder, previewUrl, previewName });
  }

  return entries;
}

async function downloadViaPlaywright(url: string, dest: string): Promise<boolean> {
  const ctx = await getContext();
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
    await page.waitForFunction(
      () => !document.title.includes("Just a moment"),
      { timeout: 60000 }
    ).catch(() => {});
    await new Promise(r => setTimeout(r, 2000));

    if (capturedBody && capturedBody.length > 0) {
      await Bun.write(dest, capturedBody);
      return existsSync(dest);
    }
    const response = await ctx.request.get(url, { timeout: 10 * 60 * 1000 });
    if (!response.ok()) {
      console.error(`    [error] HTTP ${response.status()} for ${url}`);
      return false;
    }
    await Bun.write(dest, await response.body());
    return existsSync(dest);
  } catch (e) {
    console.error(`    [error] ${e}`);
    return false;
  } finally {
    await page.close();
  }
}

const html = await fetchPageViaPlaywright();
const entries = parseAllPreviews(html);
// Process rough mixes before excerpts so the "skip excerpt if rough mix exists" check is reliable
entries.sort((a, b) => (a.previewName === "rough mix" ? -1 : 1) - (b.previewName === "rough mix" ? -1 : 1));
console.log(`[scrape] found ${entries.length} preview entries on page\n`);

let added = 0, skipped = 0, missing = 0;

for (const entry of entries) {
  const destDir = join(BASE_DIR, entry.folder);
  if (!existsSync(destDir)) { missing++; continue; }

  // Skip excerpt if a rough mix already exists for this folder
  if (entry.previewName === "excerpt") {
    const files = require("fs").readdirSync(destDir) as string[];
    if (files.some((f: string) => f.startsWith("rough mix."))) { skipped++; continue; }
  }

  const ext = extname(entry.previewUrl.split("?")[0]) || ".mp3";
  const destFile = join(destDir, entry.previewName + ext);
  if (existsSync(destFile)) { skipped++; continue; }

  console.log(`[preview] ${entry.folder} — ${entry.previewName}`);
  const ok = await downloadViaPlaywright(entry.previewUrl, destFile);
  if (ok) { added++; } else { console.error(`  [error] failed: ${entry.previewUrl}`); }
}

await closeBrowser();
console.log(`\nDone. Added: ${added}, already had: ${skipped}, folder not found: ${missing}`);
