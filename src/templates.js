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

export const findTemplate = (key) => TEMPLATES.find((t) => t.key === key) || null;

/** Presets, stripped of ids so each application makes fresh blocks. */
export function templatePatch(key) {
  const t = findTemplate(key);
  if (!t) return null;
  return JSON.parse(JSON.stringify(t.apply));
}
