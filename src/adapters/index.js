/**
 * Source adapters. Each one turns something external into ContentItem[]. The feed, the
 * studio and the embed never learn which source an item came from — adding a platform is a
 * new file here, nothing else.
 *
 * An adapter is: { key, label, needs, fetch(config) -> ContentItem[] }
 *   needs — what it must be given before it can run, surfaced in the studio.
 */
import youtube from './youtube.js';
import cloudinary from './cloudinary.js';
import rss from './rss.js';
import manual from './manual.js';
import upload from './upload.js';

export const ADAPTERS = { upload, youtube, cloudinary, rss, manual };

export const listAdapters = () =>
  Object.values(ADAPTERS).map(({ key, label, needs, notes }) => ({ key, label, needs, notes }));

export async function pull(key, config = {}) {
  const a = ADAPTERS[key];
  if (!a) throw new Error(`no such adapter: ${key}`);
  const missing = (a.needs || []).filter((n) => !config[n]);
  if (missing.length) throw new Error(`${key}: missing ${missing.join(', ')}`);
  return a.fetch(config);
}
