// @ts-nocheck -- Vitest is supplied by the repository test runner.

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('Social Circle page selectors', () => {
  it('reuse one stable empty member projection across Zustand snapshots', () => {
    for (const file of [
      './SocialCircleDetailPage.tsx',
      './SocialCircleMemberPickerPage.tsx',
    ]) {
      const source = readFileSync(new URL(file, import.meta.url), 'utf8');

      expect(source).toContain('const EMPTY_CIRCLE_MEMBERS:');
      expect(source).toContain('?? EMPTY_CIRCLE_MEMBERS');
      expect(source).not.toContain('membersByCircle[circleId] ?? []');
    }
  });

  it('keeps raw PTIDs out of Circle member presentation', () => {
    const detail = readFileSync(
      new URL('./SocialCircleDetailPage.tsx', import.meta.url),
      'utf8',
    );
    const picker = readFileSync(
      new URL('./SocialCircleMemberPickerPage.tsx', import.meta.url),
      'utf8',
    );

    expect(detail).toContain("t('mobile.social.circles.localPerson')");
    expect(picker).toContain("t('mobile.social.circles.localPerson')");
    expect(detail).not.toContain('{member.actorPtid}</Text>');
    expect(picker).not.toContain('actor.federation?.handle || actor.ptid');
  });
});
