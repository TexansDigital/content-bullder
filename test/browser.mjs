/**
 * Where chromium is, discovered rather than hardcoded.
 *
 * Every suite used to carry a literal
 * `/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell`. When that
 * install was replaced, all seven failed at launch — and not only had the version changed,
 * so had the directory layout and the binary's name
 * (`chrome-headless-shell-linux64/chrome-headless-shell`). So this looks for the executable
 * instead of predicting its path.
 */
import { readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.env.PLAYWRIGHT_BROWSERS_PATH || '/opt/pw-browsers';
const NAMES = ['chrome-headless-shell', 'headless_shell', 'chrome'];

function findBinary(dir, depth = 0) {
  if (depth > 3) return null;
  let entries;
  try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return null; }
  for (const name of NAMES) {
    const hit = entries.find((e) => e.name === name && e.isFile());
    // `.real` siblings exist next to a launcher of the same name; the launcher is the one.
    if (hit) { try { statSync(join(dir, name)); return join(dir, name); } catch { /* keep looking */ } }
  }
  for (const e of entries) {
    if (!e.isDirectory()) continue;
    const found = findBinary(join(dir, e.name), depth + 1);
    if (found) return found;
  }
  return null;
}

/** Newest install first, so a box holding two builds uses the one just installed. */
export function headlessShell() {
  let dirs;
  try { dirs = readdirSync(ROOT); }
  catch { throw new Error(`no browser directory at ${ROOT} — set PLAYWRIGHT_BROWSERS_PATH`); }

  const ranked = dirs
    .filter((d) => /^chromium(_headless_shell)?-\d+$/.test(d))
    .sort((a, b) => {
      const headless = (x) => (x.includes('headless') ? 1 : 0);
      return headless(b) - headless(a)
        || Number(b.split('-').pop()) - Number(a.split('-').pop());
    });

  for (const d of ranked) {
    const found = findBinary(join(ROOT, d));
    if (found) return found;
  }
  throw new Error(`found no chromium executable under ${ROOT} (looked in: ${ranked.join(', ') || 'nothing'})`);
}
