// DUSTLINE — main.ts
// The entry program for the gta6-01 bounty (program/v1). It copies the game
// and its screenshots into the output directory and writes the dossier the
// gate scores, using the kit's own buildDossier library, unchanged.
// Node 22 standard library only; no network; deterministic output.

import { buildDossier } from './vendor/makefun-game.ts';
import { cpSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const outDir = process.env.MAKEFUN_OUTPUT_DIR || '/output';

// Screenshot caps from the kit rules: 3-4 images, each a PNG/JPEG of at most
// 256 KiB, long side at most 1280 px, short side at least 480 px. Checking
// them here, before the copy, fails fast with a readable message instead of
// failing deep inside buildDossier after the output is half written.
const SHOT_MAX_BYTES = 262144;
const SHOT_MAX_LONG = 1280;
const SHOT_MIN_SHORT = 480;

// Read a JPEG's pixel dimensions from its SOF0/SOF2 marker. Node 22 stdlib
// only; no image library is available in the grader image.
function jpegSize(buf: Buffer): { w: number; h: number } {
  let i = 2;
  while (i + 8 < buf.length) {
    if (buf[i] !== 0xff) { i += 1; continue; }
    const marker = buf[i + 1];
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) { i += 2; continue; }
    const len = buf.readUInt16BE(i + 2);
    if (marker === 0xc0 || marker === 0xc2) {
      return { h: buf.readUInt16BE(i + 5), w: buf.readUInt16BE(i + 7) };
    }
    i += 2 + len;
  }
  throw new Error('no SOF marker found');
}

function checkScreenshots(dir: string): void {
  const files = readdirSync(dir).filter((f) => /\.(jpe?g|png)$/i.test(f)).sort();
  if (files.length < 3 || files.length > 4) {
    throw new Error(`screenshots: expected 3-4 images, found ${files.length}`);
  }
  for (const f of files) {
    const p = join(dir, f);
    const size = statSync(p).size;
    if (size > SHOT_MAX_BYTES) throw new Error(`screenshots/${f}: ${size} bytes > ${SHOT_MAX_BYTES}`);
    if (/\.jpe?g$/i.test(f)) {
      const { w, h } = jpegSize(readFileSync(p));
      const long = Math.max(w, h);
      const short = Math.min(w, h);
      if (long > SHOT_MAX_LONG) throw new Error(`screenshots/${f}: long side ${long}px > ${SHOT_MAX_LONG}`);
      if (short < SHOT_MIN_SHORT) throw new Error(`screenshots/${f}: short side ${short}px < ${SHOT_MIN_SHORT}`);
    }
  }
  console.log(`dustline: ${files.length} screenshots OK (${files.join(', ')})`);
}

function main() {
  checkScreenshots(join(here, 'screenshots'));
  mkdirSync(outDir, { recursive: true });
  // Start clean so a second run writes exactly the same bytes.
  rmSync(join(outDir, 'game'), { recursive: true, force: true });
  rmSync(join(outDir, 'screenshots'), { recursive: true, force: true });
  rmSync(join(outDir, 'dossier.json'), { force: true });
  cpSync(join(here, 'game'), join(outDir, 'game'), { recursive: true });
  cpSync(join(here, 'screenshots'), join(outDir, 'screenshots'), { recursive: true });
  const dossier = buildDossier(outDir, {
    text_max_bytes: 163840,
    screenshots: { max: 4, max_bytes: 262144 },
    game_max_files: 993,
    game_max_bytes: 50331648,
  });
  writeFileSync(join(outDir, 'dossier.json'), dossier);
  console.log(`dustline: wrote ${outDir} (dossier ${dossier.length} bytes)`);
}

main();
