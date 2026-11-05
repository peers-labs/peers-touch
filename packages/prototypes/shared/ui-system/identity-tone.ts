/**
 * Identity tone — deterministic avatar background colors.
 *
 * Letter-tile avatars need per-person HUE: a single near-black tile for
 * everyone reads as a graveyard of identical stones. The viewer keeps the
 * brand pine exclusively (self is the only green); every other person gets a
 * curated medium-dark hue (white glyph via Avatar's luminance rule). Group
 * composites keep the neutral ink, which also keeps "a group" visually
 * distinct from a person. Unknown names hash onto the same palette so the
 * look stays consistent for unseeded actors.
 */

export const IDENTITY_INK = '#3d434a';
export const IDENTITY_PINE = '#2f6a50';
export const VIEWER_TONE = IDENTITY_PINE;

/** Curated cast tones: muted north-star hues, distinct from self pine. */
const PERSON_TONES: Record<string, string> = {
  陈屿: '#46588f', // slate indigo
  周禾: '#9f6a2c', // ochre
  苏禾: '#a6513c', // terracotta
  林晚: '#2f7f8b', // teal
  老周: '#7c5a40', // warm brown
  阿砚: '#7451a0', // plum
  河埠头: '#50708c', // steel blue
  青衫: '#3f6f9e', // indigo blue
  晚舟: '#a2546e', // dusk rose
  慕云: '#5b62a8', // periwinkle
  'lin · 连南': '#2e8286', // cyan
  连南: '#2e8286',
};

/** Hash fallback palette for unseeded names (no green — pine is self-only). */
const FALLBACK_TONES = [
  '#46588f', '#9f6a2c', '#a6513c', '#2f7f8b',
  '#7c5a40', '#7451a0', '#50708c', '#3f6f9e',
  '#a2546e', '#5b62a8', '#2e8286',
];

function hashString(value: string): number {
  let h = 0;
  for (let i = 0; i < value.length; i += 1) {
    h = (h * 31 + value.charCodeAt(i)) >>> 0;
  }
  return h;
}

/** Person avatar tone: curated cast color, else a stable hashed hue. */
export function identityTone(name: string): string {
  return PERSON_TONES[name] ?? FALLBACK_TONES[hashString(name) % FALLBACK_TONES.length];
}
