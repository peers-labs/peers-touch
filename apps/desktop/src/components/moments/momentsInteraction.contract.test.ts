import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

function source(relativePath: string): string {
  return readFileSync(new URL(relativePath, import.meta.url), 'utf8');
}

const composerSource = source('./MomentComposer.tsx');
const detailSource = source('../../pages/moments/MomentDetailPage.tsx');
const appSource = source('../../pages/moments/MomentsApp.tsx');
const threadSource = source('./surfaces/SocialThreadSurface.tsx');
const searchSource = source('../../pages/moments/UserSearchPage.tsx');
const userSource = source('../../pages/moments/MomentsUserPage.tsx');
const circleSource = source('../../pages/moments/CircleManagePage.tsx');
const discoverySource = source('../../store/discovery.ts');
const runtimeSource = source('../../runtimes/momentsRuntime.ts');
const enMoments = JSON.parse(
  source('../../../../../packages/locales/en/moments.json'),
) as Record<string, string>;

describe('Desktop Moments interaction contract', () => {
  it('keeps post text away from its visible input boundary', () => {
    expect(composerSource).toContain('data-moments-composer-input');
    expect(composerSource).toContain("padding: '8px 12px'");
    expect(composerSource).toContain('border: `1px solid ${token.colorBorderSecondary}`');
  });

  it('lets users collapse and restore the mounted comment composer', () => {
    expect(threadSource).toContain('data-moments-comments-toggle');
    expect(detailSource).toContain('data-moments-comments-region');
    expect(detailSource).toContain('hidden={!commentsOpen}');
    expect(detailSource).toContain('<CommentList');
    expect(appSource).toContain('key={view.postId}');
  });

  it('navigates from a search result only through its avatar', () => {
    expect(searchSource).toContain('onAvatarClick={() => onOpenUser(u.id)}');
    expect(searchSource).not.toContain('onClick={() => onOpenUser(u.id)}');
    expect(searchSource).not.toContain('loading={searching}');
    expect(searchSource).toContain('searchError && query === normalizedText');
    expect(userSource).toContain('discoveryUser: s.usersById[actorPtid]');
    expect(userSource).toContain('loading={!author && profileLoading}');
    expect(userSource).toContain('refreshing={!!author && profileLoading}');
    expect(discoverySource).toContain('generation !== profileLoadGeneration');
    expect(runtimeSource).toContain('loadUserProfile(trimmedActorPtid, true)');
  });

  it('adds audience members through identity search instead of typed DIDs', () => {
    expect(circleSource).toContain('data-moments-circle-person-picker');
    expect(circleSource).toContain("t('moments.circle.searchPeoplePlaceholder')");
    expect(circleSource).not.toContain('memberInput');
    expect(runtimeSource).toContain('export async function ensureCircleMemberProfiles');
    expect(runtimeSource).toContain('const batchSize = 6');
    expect(appSource.indexOf("setView({ kind: 'tab', tab });")).toBeLessThan(
      appSource.indexOf('void ensureCircleMemberProfiles();'),
    );
    expect(enMoments['moments.circle.explanation']).toContain('private lists');
    expect(enMoments['moments.circle.searchPeoplePlaceholder']).not.toContain('DID');
  });
});
