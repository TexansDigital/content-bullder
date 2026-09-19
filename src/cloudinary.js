/**
 * Cloudinary delivery-URL builder.
 *
 * Deliberately credential-free: every URL here is constructed from a cloud name and a
 * public ID, both of which are public. No API key, no secret, no SDK, no network call.
 * That is the whole point — see docs/research/08-cloudinary-url-only.md.
 *
 * If the account has Strict Transformations enabled, the raw transformation strings below
 * will 404 and the named-transformation forms must be used instead. Set `named: true`.
 */

const BASE = (cloud) => `https://res.cloudinary.com/${cloud}/video/upload`;

/** Named transformations to register once in the Cloudinary console. */
export const NAMED = {
  player: 't_tx_feed_player',   // 9:16 HLS ladder
  poster: 't_tx_feed_poster',   // 9:16 still
  tile:   't_tx_feed_tile',     // 4:5 still
  tileLg: 't_tx_feed_tile_2x',  // 4:5 still, retina
};

/** The raw equivalents, so the console entries and the code can't drift apart. */
export const RAW = {
  player: 'f_auto,q_auto,c_fill,g_auto,ar_9:16/sp_auto',
  poster: 'so_1.5,f_auto,q_auto,c_fill,g_auto,ar_9:16,w_720',
  tile:   'so_1.5,f_auto,q_auto,c_fill,g_auto,ar_4:5,w_400',
  tileLg: 'so_1.5,f_auto,q_auto,c_fill,g_auto,ar_4:5,w_800',
};

/**
 * @param {object} cfg
 * @param {string} cfg.cloud   Cloudinary cloud name.
 * @param {boolean} [cfg.named] Use registered named transformations (required under
 *                              Strict Transformations).
 */
export function builder({ cloud, named = false }) {
  if (!cloud) throw new Error('cloudinary: cloud name is required');
  const t = (key) => (named ? NAMED[key] : RAW[key]);
  const url = (key, id, ext) => `${BASE(cloud)}/${t(key)}/${id}.${ext}`;

  return {
    /** Adaptive-bitrate HLS manifest. Production playback path. */
    hls: (id) => url('player', id, 'm3u8'),

    /**
     * Progressive MP4. Plays natively everywhere with no hls.js, at the cost of ABR.
     * Useful for prototypes and as a fallback where HLS is unavailable.
     */
    mp4: (id) => `${BASE(cloud)}/f_auto,q_auto,c_fill,g_auto,ar_9:16/${id}.mp4`,

    /** 9:16 still for the player's first frame. */
    poster: (id) => url('poster', id, 'jpg'),

    /** 4:5 still for the rail tile. `srcset` gives the 2x. */
    tile: (id) => url('tile', id, 'jpg'),
    tileSrcset: (id) => `${url('tile', id, 'jpg')} 1x, ${url('tileLg', id, 'jpg')} 2x`,

    /**
     * Caption track, if the upload preset was configured to run transcription.
     * Cloudinary writes it beside the video as a raw asset.
     */
    vtt: (id) => `https://res.cloudinary.com/${cloud}/raw/upload/${id}.transcript.vtt`,

    /**
     * `sp_auto` is lazy: the first request triggers transcoding and segments can buffer
     * for 10-30s. Warm it once at publish time with a plain GET — no credentials needed.
     */
    prewarm: (id) => fetch(url('player', id, 'm3u8'), { method: 'GET' }).catch(() => {}),
  };
}

/**
 * Accepts whatever editorial pastes in — a full delivery URL or a bare public ID — and
 * returns the public ID. Tolerant on purpose: the manifest is filled in by hand.
 */
export function publicId(input) {
  if (!input) return null;
  const s = String(input).trim();
  if (!s.includes('res.cloudinary.com')) return s.replace(/^\/+|\.[a-z0-9]+$/gi, '');
  const after = s.split('/upload/')[1];
  if (!after) return null;
  return after
    .split('/')
    .filter((seg) => !/^(v\d+|[a-z]{1,3}_[^/]*|t_[^/]*|sp_auto)$/i.test(seg))
    .join('/')
    .replace(/\.[a-z0-9]+$/i, '');
}
