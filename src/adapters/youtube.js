import { makeItem } from '../content.js';
import { normalize } from '../youtube.js';

/**
 * Metadata only — YouTube never returns the file and its terms require playback in its own
 * embedded player, so `media.kind = 'youtube'` means the feed hands that item to the iframe
 * rather than to our player. Everything else about the item behaves identically.
 */
export default {
  key: 'youtube',
  label: 'YouTube',
  needs: ['apiKey', 'channelId'],
  notes: 'Uploads playlist, not search — search.list silently omits Shorts.',

  async fetch({ apiKey, channelId, max = 100 }) {
    const api = async (path, params) => {
      const url = new URL(`https://www.googleapis.com/youtube/v3/${path}`);
      Object.entries({ ...params, key: apiKey }).forEach(
        ([k, v]) => v != null && url.searchParams.set(k, v));
      const j = await (await fetch(url)).json();
      if (j.error) throw new Error(`youtube ${path}: ${j.error.message}`);
      return j;
    };

    const ch = await api('channels', { part: 'contentDetails', id: channelId });
    const uploads = ch.items?.[0]?.contentDetails?.relatedPlaylists?.uploads;
    if (!uploads) throw new Error(`youtube: no uploads playlist for ${channelId}`);

    const ids = [];
    let pageToken;
    do {
      const page = await api('playlistItems', {
        part: 'contentDetails', playlistId: uploads, maxResults: 50, pageToken });
      ids.push(...(page.items || []).map((i) => i.contentDetails?.videoId).filter(Boolean));
      pageToken = page.nextPageToken;
    } while (pageToken && ids.length < max);

    // The paging loop fetches in 50s, so it overshoots `max`. Trim before spending quota
    // on details for videos the caller never asked for.
    ids.length = Math.min(ids.length, max);

    const items = [];
    for (let i = 0; i < ids.length; i += 50) {
      const page = await api('videos', {
        part: 'snippet,contentDetails,status,statistics',
        id: ids.slice(i, i + 50).join(',') });
      items.push(...(page.items || []));
    }

    return normalize({ items }).map((c) =>
      makeItem({
        id: c.id,
        source: 'youtube',
        collection: c.collection,
        headline: c.headline,
        caption: c.caption,
        media: { kind: 'youtube', youtubeId: c.youtubeId },
        poster: c.poster,
        durationSeconds: c.durationSeconds,
        publishedAt: c.publishedAt,
        links: { youtube: `https://www.youtube.com/watch?v=${c.youtubeId}` },
        flags: {
          vertical: c.flags.isShort,
          embeddable: c.flags.embeddable,
          hasCaptions: c.flags.hasCaptions,
          duplicate: !!c.liveDupe,
        },
      }));
  },
};
