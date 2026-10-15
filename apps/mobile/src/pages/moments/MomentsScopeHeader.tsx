import { ImagePlus, Search, SlidersHorizontal } from 'lucide-react';

import { useMobileI18n } from '../../app/mobileI18n';
import { TimelineSort } from '../../gen/proto/domain/social/post_pb';

export type MomentsFeedScope = 'home' | 'explore';

interface MomentsScopeHeaderProps {
  readonly scope: MomentsFeedScope;
  readonly exploreSort: TimelineSort;
  readonly onChangeScope: (scope: MomentsFeedScope) => void;
  readonly onOpenSearch: () => void;
  readonly onOpenCircles: () => void;
  readonly onOpenComposer: () => void;
  readonly onOpenSort: () => void;
}

export function MomentsScopeHeader({
  scope,
  exploreSort,
  onChangeScope,
  onOpenSearch,
  onOpenCircles,
  onOpenComposer,
  onOpenSort,
}: MomentsScopeHeaderProps) {
  const { t } = useMobileI18n();

  return (
    <>
      <header className="moments-header">
        <div className="moments-header-title">
          <h1>{t('mobile.moments.title')}</h1>
          <span>{t('mobile.moments.subtitle')}</span>
        </div>
        <div className="moments-header-actions">
          <button
            type="button"
            data-acceptance-id="social-search-open"
            aria-label={t('mobile.social.search.title')}
            onClick={onOpenSearch}
          >
            <Search size={19} />
          </button>
          <button
            type="button"
            data-acceptance-id="social-composer-open"
            aria-label={t('mobile.moments.newPost')}
            onClick={onOpenComposer}
          >
            <ImagePlus size={20} />
          </button>
        </div>
      </header>

      <div
        className="moments-scope"
        role="tablist"
        aria-label={t('mobile.moments.scope.label')}
      >
        {(['home', 'explore'] as const).map((item) => (
          <button
            key={item}
            type="button"
            role="tab"
            className={scope === item ? 'active' : ''}
            data-acceptance-id={`social-feed-scope-${item}`}
            aria-selected={scope === item}
            onClick={() => onChangeScope(item)}
          >
            {t(`mobile.moments.scope.${item}`)}
          </button>
        ))}
        <button
          type="button"
          role="tab"
          data-acceptance-id="social-circles-open"
          aria-selected={false}
          onClick={onOpenCircles}
        >
          {t('mobile.social.circles.title')}
        </button>
      </div>

      {scope === 'explore' ? (
        <div className="moments-context-row">
          <button
            type="button"
            data-acceptance-id="social-explore-sort-open"
            onClick={onOpenSort}
          >
            <SlidersHorizontal size={13} />
            {t(
              `mobile.moments.sort.${
                exploreSort === TimelineSort.HOT ? 'hot' : 'recent'
              }`,
            )}
          </button>
        </div>
      ) : null}
    </>
  );
}
