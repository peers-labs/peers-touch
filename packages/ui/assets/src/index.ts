import { glyphs } from './glyphs';
import type { GlyphAsset } from './types';
import { brands } from './brands';
export { glyphs };
export { brands };
export type BrandId = keyof typeof brands;
export type { GlyphAsset, GlyphShape } from './types';
export type IconId = keyof typeof glyphs;
export function getGlyph(id: string): GlyphAsset | undefined {
  return (glyphs as Record<string, GlyphAsset>)[id];
}
