/**
 * Card layouts. A template is a preset of overlays, fit, pacing and chrome — the media stays
 * whatever it was. Applying one is how a promo becomes "pick a layout, swap the art, change
 * the words" instead of composing from scratch every time.
 *
 * Positions are percentages of the frame. Text is placeholder: it is meant to be overwritten.
 */
const ov = (o) => ({ align: 'center', size: 'lg', style: 'plain', color: 'white', x: 50, ...o });

export const TEMPLATES = [
  {
    key: 'clean',
    name: 'Clean',
    note: 'No blocks. The default headline block does the work.',
    apply: { fit: 'cover', chrome: 'on', advance: { mode: 'auto', seconds: 6 }, overlays: [] },
  },
  {
    key: 'title',
    name: 'Title card',
    note: 'Big statement over the art. Good for a hype frame.',
    apply: {
      fit: 'cover', chrome: 'off', advance: { mode: 'auto', seconds: 5 },
      overlays: [
        ov({ type: 'text', text: 'Headline goes here', y: 44, size: 'xl' }),
        ov({ type: 'text', text: 'Supporting line', y: 58, size: 'md', color: 'white' }),
      ],
    },
  },
  {
    key: 'promo',
    name: 'Promo + CTA',
    note: 'Band up top, tappable button at the bottom. The workhorse.',
    apply: {
      fit: 'cover', chrome: 'off', advance: { mode: 'manual', seconds: 8 },
      overlays: [
        ov({ type: 'text', text: 'Announcement', y: 16, size: 'lg', style: 'band', color: 'red' }),
        ov({ type: 'link', text: 'Get tickets', url: '', y: 84, size: 'md', style: 'box', color: 'white' }),
      ],
    },
  },
  {
    key: 'letterbox',
    name: 'Graphic + text',
    note: 'Art in the middle, type above and below it. Nothing covers the design.',
    apply: {
      fit: 'contain', chrome: 'off', advance: { mode: 'manual', seconds: 8 },
      overlays: [
        ov({ type: 'text', text: 'Headline', y: 13, size: 'xl' }),
        ov({ type: 'text', text: 'One supporting line', y: 25, size: 'sm', style: 'band', color: 'red' }),
        ov({ type: 'link', text: 'Learn more', url: '', y: 88, size: 'md', style: 'box', color: 'white' }),
      ],
    },
  },
  {
    key: 'quote',
    name: 'Quote',
    note: 'Pull a line out of a presser. Attribution underneath.',
    apply: {
      fit: 'cover', chrome: 'off', advance: { mode: 'auto', seconds: 8 },
      overlays: [
        ov({ type: 'text', text: '“We finish what we start.”', y: 42, size: 'lg', align: 'left', x: 46 }),
        ov({ type: 'text', text: 'Head Coach // Postgame', y: 58, size: 'sm', align: 'left', x: 46, color: 'red' }),
      ],
    },
  },
  {
    key: 'sponsor',
    name: 'Sponsor slate',
    note: 'Presented-by lockup with room for a partner mark.',
    apply: {
      fit: 'contain', chrome: 'off', advance: { mode: 'auto', seconds: 5 },
      overlays: [
        ov({ type: 'text', text: 'Presented by', y: 12, size: 'sm', style: 'band', color: 'blue' }),
        ov({ type: 'link', text: 'See the offer', url: '', y: 88, size: 'md', style: 'box', color: 'blue' }),
      ],
    },
  },
];

export const findTemplate = (key, custom = []) =>
  [...TEMPLATES, ...custom].find((t) => t.key === key) || null;

/** Presets, stripped of ids so each application makes fresh blocks. */
export function templatePatch(key, custom = []) {
  const t = findTemplate(key, custom);
  if (!t) return null;
  const patch = JSON.parse(JSON.stringify(t.apply));
  // Ids are regenerated on makeItem, but strip them so two cards from one layout never
  // share a block id.
  patch.overlays = (patch.overlays || []).map(({ id, ...rest }) => rest);
  return patch;
}

const slug = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-')
  .replace(/^-|-$/g, '').slice(0, 40);

/**
 * Turns a card into a reusable layout. Only the presentation travels — media, headline,
 * collection and links stay with the card it came from, since those are what change between
 * uses. Block text is kept, because a saved layout's wording is usually most of its value.
 */
export function templateFromItem(item, name, taken = new Set()) {
  // Two names that slug alike would otherwise overwrite each other with no warning.
  const base = `custom-${slug(name) || Date.now().toString(36)}`;
  let key = base;
  for (let n = 2; taken.has(key); n++) key = `${base}-${n}`;
  return {
    key,
    name: String(name).slice(0, 40) || 'Untitled layout',
    note: `Saved from "${String(item.headline).slice(0, 40)}"`,
    custom: true,
    apply: {
      fit: item.fit,
      chrome: item.chrome,
      advance: { ...item.advance },
      overlays: (item.overlays || []).map(({ id, ...o }) => ({
        ...o,
        // A saved link keeps its wording but drops the destination — the next card it is
        // applied to is going somewhere else, and a stale URL is worse than an empty one.
        url: o.type === 'link' ? '' : null,
      })),
    },
  };
}
