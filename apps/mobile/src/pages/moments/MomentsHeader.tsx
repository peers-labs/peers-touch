import { useRef } from 'react';
import { Button, Icon, IconButton, Menu, Segmented, TextField } from '@peers-touch/ui';

import { useMobileI18n } from '../../app/mobileI18n';

import type { MobileMomentsPaneId } from '../../app/navigation';

interface MomentsHeaderProps {
  readonly pane: MobileMomentsPaneId;
  readonly searchOpen: boolean;
  readonly query: string;
  readonly onPaneChange: (pane: MobileMomentsPaneId) => void;
  readonly onSearchOpenChange: (open: boolean) => void;
  readonly onQueryChange: (query: string) => void;
  readonly onAdd: () => void;
  readonly onOpenSearch: () => void;
  readonly onOpenGlobalSearch: () => void;
  readonly onOpenExplore: () => void;
  readonly onOpenNotifications: () => void;
}

/** Feed and audience circles occupy the same header band as Messages. */
export function MomentsHeader({
  pane,
  searchOpen,
  query,
  onPaneChange,
  onSearchOpenChange,
  onQueryChange,
  onAdd,
  onOpenSearch,
  onOpenGlobalSearch,
  onOpenExplore,
  onOpenNotifications,
}: MomentsHeaderProps) {
  const { t } = useMobileI18n();
  const searchTrigger = useRef<HTMLButtonElement>(null);
  const closeSearch = () => {
    onQueryChange('');
    onSearchOpenChange(false);
    requestAnimationFrame(() => searchTrigger.current?.focus({ preventScroll: true }));
  };
  const searchLabel = t(pane === 'feed'
    ? 'mobile.moments.searchPlaceholder'
    : 'mobile.social.circles.searchPlaceholder');
  return (
    <header className="mobile-moments-header" data-subbar-search={searchOpen ? 'active' : 'idle'}>
      <h1 className="visually-hidden">{t('mobile.moments.title')}</h1>
      {searchOpen ? <>
        <div className="mobile-moments-search">
          <TextField
            appearance="search"
            reveal
            density="comfortable"
            aria-label={searchLabel}
            placeholder={searchLabel}
            data-focus-id={`moments.search.${pane}`}
            value={query}
            onValueChange={onQueryChange}
            leading={<Icon iconId="search" size={18} />}
            onKeyDown={(event) => { if (event.key === 'Escape') closeSearch(); }}
          />
        </div>
        <Button actionId="moments.search.cancel" density="comfortable" emphasis="quiet" onActivate={closeSearch}>
          {t('common.action.cancel')}
        </Button>
      </> : <>
        <div className="mobile-moments-scopes">
          <Segmented<MobileMomentsPaneId>
            label={t('mobile.moments.panes.label')}
            density="comfortable"
            value={pane}
            options={[
              { value: 'feed', label: t('mobile.moments.panes.feed') },
              { value: 'circles', label: t('mobile.social.circles.title') },
            ]}
            onValueChange={(value) => { if (value) onPaneChange(value); }}
          />
        </div>
        <IconButton
          ref={searchTrigger}
          actionId="moments.search.open"
          iconId="search"
          density="comfortable"
          emphasis="quiet"
          label={searchLabel}
          data-focus-id="moments.search.open"
          onActivate={() => onSearchOpenChange(true)}
        />
        <IconButton
          actionId={pane === 'feed' ? 'moments.compose' : 'circle.open-create'}
          data-acceptance-id={pane === 'feed' ? 'social-composer-open' : 'social-circle-create-open'}
          iconId="plus"
          density="comfortable"
          emphasis="quiet"
          label={t(pane === 'feed' ? 'mobile.moments.newPost' : 'mobile.social.circles.create')}
          onActivate={onAdd}
        />
        <Menu placement="bottom" actions={[
          { id: 'moments.explore', label: t('mobile.moments.scope.explore'), onActivate: onOpenExplore },
          { id: 'moments.people-search', label: t('mobile.social.search.title'), onActivate: onOpenSearch },
          { id: 'moments.global-search', label: t('mobile.search.title'), onActivate: onOpenGlobalSearch },
          { id: 'moments.notifications', label: t('mobile.notifications.title'), onActivate: onOpenNotifications },
        ]}>
          <IconButton
            actionId="moments.more"
            iconId="more-horizontal"
            density="comfortable"
            emphasis="quiet"
            label={t('mobile.moments.more')}
          />
        </Menu>
      </>}
    </header>
  );
}
