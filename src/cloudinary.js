/**
 * Cloudinary delivery-URL builder.
 *
 * Credential-free by design: every URL is constructed from a base and a public ID, both
 * public. No API key, no secret, no SDK, no network call. See
 * docs/research/08-cloudinary-url-only.md.
 *
 * Two deployment shapes are supported:
 *   - shared CDN   https://res.cloudinary.com/<cloud>/<type>/upload/...
 *   - private CDN  https://static.clubs.nfl.com/<type>/upload/...   (no cloud segment;
 *                  the cloud is implied by the domain — this is what the NFL uses)
 */

/** Named transformations to register once in the Cloudinary console. */
export const NAMED = {
  player: 't_tx_feed_player',
  poster: 't_tx_feed_poster',
  tile:   't_tx_feed_tile',
  tileLg: 't_tx_feed_tile_2x',
};

/** Raw equivalents, so console entries and code can't drift. Order is significant. */
export const RAW = {
  player: 'f_auto,q_auto,c_fill,g_auto,ar_9:16',
  poster: 'so_1.5,f_auto,q_auto,c_fill,g_auto,ar_9:16,w_720',
  tile:   'so_1.5,f_auto,q_auto,c_fill,g_auto,ar_4:5,w_400',
  tileLg: 'so_1.5,f_auto,q_auto,c_fill,g_auto,ar_4:5,w_800',
};

/**
 * @param {object} cfg
 * @param {string} [cfg.baseUrl] Private-CDN origin, e.g. 'https://static.clubs.nfl.com'.
 * @param {string} [cfg.cloud]   Cloud name, for the shared res.cloudinary.com CDN.
 * @param {boolean} [cfg.named]  Use registered named transformations. Required when the
 *                               account has Strict Transformations enabled.
 */
export function builder({ baseUrl, cloud, named = false } = {}) {
  if (!baseUrl && !cloud) throw new Error('cloudinary: pass baseUrl or cloud');
  const origin = baseUrl
    ? String(baseUrl).replace(/\/+$/, '')
    : `https://res.cloudinary.com/${cloud}`;
  const t = (key) => (named ? NAMED[key] : RAW[key]);
  const at = (type, transform, id, ext) =>
    `${origin}/${type}/upload/${transform}/${id}.${ext}`;

  return {
    origin,

    /** Adaptive-bitrate HLS. `sp_auto` is appended after the transformation. */
    hls: (id) => at('video', `${t('player')}/sp_auto`, id, 'm3u8'),

    /** Progressive MP4 — plays natively everywhere, no hls.js, no ABR. */
    mp4: (id) => at('video', t('player'), id, 'mp4'),

    /** 9:16 still for the player's first frame. */
    poster: (id) => at('video', t('poster'), id, 'jpg'),

    /** 4:5 still for the rail tile, plus the retina srcset. */
    tile: (id) => at('video', t('tile'), id, 'jpg'),
    tileSrcset: (id) =>
      `${at('video', t('tile'), id, 'jpg')} 1x, ${at('video', t('tileLg'), id, 'jpg')} 2x`,

    /** Same crops against an image asset rather than a video. */
    imageTile: (id) => at('image', t('tile'), id, 'jpg'),
    imagePoster: (id) => at('image', t('poster'), id, 'jpg'),

    /** Caption track, if transcription ran at upload. */
    vtt: (id) => `${origin}/raw/upload/${id}.transcript.vtt`,

    /**
     * `sp_auto` is lazy — the first request triggers transcoding and segments can buffer
     * for 10-30s. Warm it once at publish with a plain GET. No credentials needed.
     */
    prewarm: (id) => fetch(at('video', `${t('player')}/sp_auto`, id, 'm3u8')).catch(() => {}),
  };
}

const SEGMENT = /^(v\d+|t_[^/]*|sp_auto|[a-z]{1,3}_[^/]*(,[a-z]{1,3}_[^/]*)*)$/i;

/**
 * Accepts whatever editorial pastes — a full delivery URL on either CDN shape, a URL that
 * already carries transformations, or a bare public ID — and returns the public ID.
 * Tolerant on purpose: the manifest is filled in by hand.
 */
export function publicId(input) {
  if (!input) return null;
  const s = String(input).trim();
  if (!/^https?:\/\//i.test(s)) return s.replace(/^\/+/, '').replace(/\.[a-z0-9]+$/i, '');
  const after = s.split(/\/(?:image|video|raw)\/upload\//)[1];
  if (!after) return null;
  return after
    .split('?')[0]
    .split('/')
    .filter((seg) => !SEGMENT.test(seg))
    .join('/')
    .replace(/\.[a-z0-9]+$/i, '');
}

/** Infers the delivery origin from a pasted URL, so editorial never has to state it. */
export function originOf(input) {
  const m = String(input || '').match(/^(https?:\/\/[^/]+)\/(?:image|video|raw)\/upload\//i);
  return m ? m[1] : null;
}
