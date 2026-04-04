import { readdirSync, statSync, renameSync, rmdirSync, unlinkSync } from "fs";
import { join } from "path";

const ROOT = "/Volumes/home/music/multitracks/The Mixing Secrets";
const DRY_RUN = process.argv[2] !== "--run";

if (DRY_RUN) {
  console.log("=== DRY RUN (pass --run to execute) ===\n");
}

function isMacJunk(name: string): boolean {
  return name === ".DS_Store" || name.startsWith("._");
}

function cleanMacJunk(dir: string) {
  for (const entry of readdirSync(dir)) {
    if (isMacJunk(entry)) {
      const fullPath = join(dir, entry);
      console.log(`DELETE macOS junk: ${fullPath}`);
      if (!DRY_RUN) {
        try {
          unlinkSync(fullPath);
        } catch {
          try { rmdirSync(fullPath); } catch {
            console.log(`  SKIP (permission denied): ${fullPath}`);
          }
        }
      }
    }
  }
}

// Clean root-level junk
cleanMacJunk(ROOT);

const entries = readdirSync(ROOT);
let moveCount = 0;
let skipCount = 0;
let deleteCount = 0;

for (const artistName of entries) {
  const artistPath = join(ROOT, artistName);

  if (!statSync(artistPath).isDirectory()) continue;

  // Clean junk inside artist folder
  cleanMacJunk(artistPath);

  const tracks = readdirSync(artistPath).filter((t) =>
    statSync(join(artistPath, t)).isDirectory()
  );

  if (tracks.length === 0) {
    console.log(`SKIP (no track subfolders): ${artistName}`);
    skipCount++;
    continue;
  }

  for (const trackName of tracks) {
    const trackPath = join(artistPath, trackName);

    // Clean junk inside track folder
    cleanMacJunk(trackPath);

    const destName = `${artistName} - ${trackName}`;
    const dest = join(ROOT, destName);

    console.log(`MOVE: ${artistName}/${trackName}  →  ${destName}`);
    if (!DRY_RUN) {
      renameSync(trackPath, dest);
    }
    moveCount++;
  }

  if (!DRY_RUN) {
    const remaining = readdirSync(artistPath);
    if (remaining.length === 0) {
      rmdirSync(artistPath);
      console.log(`REMOVED empty folder: ${artistName}`);
    } else {
      console.log(`WARNING: folder not empty after move, left in place: ${artistName}`);
    }
  }
}

console.log(`\n${DRY_RUN ? "Would move" : "Moved"}: ${moveCount} folders, skipped: ${skipCount}, deleted macOS junk files throughout`);
