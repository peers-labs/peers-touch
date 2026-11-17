import { describe, expect, it } from 'vitest';

import {
  isAllowedReaction,
  MOBILE_EMOJI_ALL,
  MOBILE_EMOJI_CATEGORIES,
  MOBILE_REACTION_EMOJIS,
} from './emojiData';

describe('emojiData', () => {
  it('exposes non-empty categories with unique ids and label keys', () => {
    expect(MOBILE_EMOJI_CATEGORIES.length).toBeGreaterThan(1);
    const ids = MOBILE_EMOJI_CATEGORIES.map((category) => category.id);
    const labelKeys = MOBILE_EMOJI_CATEGORIES.map((category) => category.labelKey);
    expect(new Set(ids).size).toBe(ids.length);
    expect(new Set(labelKeys).size).toBe(labelKeys.length);
    for (const category of MOBILE_EMOJI_CATEGORIES) {
      expect(category.emojis.length).toBeGreaterThan(0);
    }
  });

  it('flattens categories into a de-duplicated full set', () => {
    expect(MOBILE_EMOJI_ALL.length).toBeGreaterThan(MOBILE_EMOJI_CATEGORIES.length);
    expect(new Set(MOBILE_EMOJI_ALL).size).toBe(MOBILE_EMOJI_ALL.length);
    for (const category of MOBILE_EMOJI_CATEGORIES) {
      for (const emoji of category.emojis) {
        expect(MOBILE_EMOJI_ALL).toContain(emoji);
      }
    }
  });

  it('keeps the reaction set as a subset of the full palette', () => {
    expect(MOBILE_REACTION_EMOJIS.length).toBe(24);
    expect(new Set(MOBILE_REACTION_EMOJIS).size).toBe(24);
    for (const emoji of MOBILE_REACTION_EMOJIS) {
      expect(MOBILE_EMOJI_ALL).toContain(emoji);
      expect(isAllowedReaction(emoji)).toBe(true);
    }
    expect(isAllowedReaction('🫥')).toBe(false);
  });
});
