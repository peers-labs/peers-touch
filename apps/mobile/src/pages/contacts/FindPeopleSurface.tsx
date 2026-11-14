import type { CSSProperties } from 'react';
import {
  Button, Empty, Icon, IconButton, MobileNavBar, Select, Spin, Text, TextField,
} from '@peers-touch/ui';
import type { FederationContext } from '../../gen/proto/domain/federation/federation_projection_service_pb';
import { useMobileI18n } from '../../app/mobileI18n';
import { useVisualKeyboardOverlap } from '../../app/layout/useVisualKeyboardOverlap';
import { MobileAvatar } from '../../components/MobileAvatar';
import { MobileNotice } from '../../components/MobileNotice';
import { actorDisplayName } from '../../features/social/socialProjection';
import type { ActorSearchResult, PeopleSearchScope } from '../../features/social/socialTypes';

export interface PeopleResultAction {
  readonly label: string;
  readonly unavailableReason?: string;
  readonly pending?: boolean;
}

/** The live page and deterministic acceptance states share one visible tree. */
export function FindPeopleSurface({
  query, scope, federations, results, loading, feedback, error, notice,
  actions = {}, onQueryChange, onScopeChange, onSearch, onSendRequest, onOpenResult,
  onBack, surfaceId = 'contacts.add-friend', title,
}: {
  readonly query: string;
  readonly scope: PeopleSearchScope;
  readonly federations: readonly FederationContext[];
  readonly results: readonly ActorSearchResult[];
  readonly loading: boolean;
  readonly feedback: string;
  readonly error?: string;
  readonly notice?: string;
  readonly actions?: Readonly<Record<string, PeopleResultAction>>;
  readonly onQueryChange: (query: string) => void;
  readonly onScopeChange: (scope: PeopleSearchScope) => void;
  readonly onSearch: () => void;
  readonly onSendRequest?: (result: ActorSearchResult) => void;
  readonly onOpenResult?: (result: ActorSearchResult) => void;
  readonly onBack: () => void;
  readonly surfaceId?: string;
  readonly title?: string;
}) {
  const { t } = useMobileI18n();
  const keyboardOverlap = useVisualKeyboardOverlap();
  const style = { '--people-keyboard-overlap': `${keyboardOverlap}px` } as CSSProperties;
  const scopeValue = scope.kind === 'station' ? 'station' : `federation:${scope.federationId}`;
  return (
    <section className="page-container mobile-detail-page find-people-page"
      style={style} data-product-surface={surfaceId} data-acceptance-id="find-people-page">
      <MobileNavBar title={title ?? t('mobile.contacts.findPeople')}
        backLabel={t('common.action.back')} onBack={onBack} />
      <div className="find-people-controls">
        <div className="people-search-row">
          <span className="people-search-input">
            <TextField appearance="search" density="comfortable" value={query}
              aria-label={t('mobile.contacts.findPeoplePlaceholder')}
              placeholder={t('mobile.contacts.findPeoplePlaceholder')}
              data-focus-id="people-search-input" data-contacts-fixture-people-search
              autoComplete="off" enterKeyHint="search" clearable
              leading={<Icon iconId="search" size={18} />}
              onClear={() => onQueryChange('')} onValueChange={onQueryChange}
              onEnter={onSearch} />
          </span>
          <IconButton actionId="people-search-run" iconId="search" iconSize={20}
            label={t('mobile.contacts.search')} density="comfortable"
            execution={loading ? 'pending' : 'idle'}
            availability={!query.trim()
              ? { kind: 'disabled', reason: t('mobile.contacts.findPeoplePlaceholder') }
              : undefined}
            onActivate={onSearch} />
        </div>
        <Select<string> label={t('mobile.contacts.searchScope')} value={scopeValue}
          options={[
            { value: 'station', label: t('mobile.contacts.currentStation') },
            ...federations.map(federation => ({
              value: `federation:${federation.federationId}`,
              label: federation.name || federation.federationId,
            })),
          ]}
          onValueChange={value => onScopeChange(typeof value === 'string' && value.startsWith('federation:')
            ? { kind: 'federation', federationId: value.slice('federation:'.length) }
            : { kind: 'station' })} />
        {notice ? <MobileNotice>{notice}</MobileNotice> : null}
      </div>
      <div className="find-people-results" data-scroll-id="find-people-results"
        aria-live="polite" aria-busy={loading} data-people-search-state={feedback}>
        {error && results.length > 0 ? <MobileNotice tone="error">{error}</MobileNotice> : null}
        {loading ? <div className="find-people-state" role="status">
          <Spin active /><Text tone="secondary">{t('mobile.contacts.resolving')}</Text>
        </div> : null}
        {!loading && results.map(result => {
          const name = actorDisplayName(result.displayName || result.username, result.ptid)
            || t('mobile.contacts.unknownUser');
          const action = actions[result.ptid];
          const copy = <>
            <MobileAvatar src={result.avatar} size={44}>{name.slice(0, 1)}</MobileAvatar>
            <span className="people-result-copy">
              <Text strong>{name}</Text>
              <Text tone="secondary" truncate>
                {result.federation?.handle || (result.username ? `@${result.username}` : result.ptid)}
              </Text>
            </span>
          </>;
          return <div className="find-people-result" key={result.ptid}
            data-actor-ptid={result.ptid} data-scroll-anchor-id={result.ptid}>
            {onOpenResult ? <button type="button" className="find-people-person"
              data-acceptance-id="social-search-result" onClick={() => onOpenResult(result)}>
              {copy}
            </button> : <div className="find-people-person">{copy}</div>}
            {action && onSendRequest ? <Button actionId="people-result-send-request"
              emphasis="secondary" density="comfortable"
              execution={action.pending ? 'pending' : 'idle'}
              availability={action.unavailableReason
                ? { kind: 'disabled', reason: action.unavailableReason } : undefined}
              onActivate={() => onSendRequest(result)}>{action.label}</Button>
              : onOpenResult ? <Icon iconId="chevron-right" size={18} /> : null}
          </div>;
        })}
        {!loading && results.length === 0 ? <Empty description={
          <div className="empty-copy">
            <Text>{error || t(feedback === 'idle'
              ? 'mobile.contacts.findPeopleHint'
              : feedback === 'remote-unavailable'
                ? 'mobile.social.search.remoteUnavailable'
                : feedback === 'unresolved-federated-handle'
                  ? 'mobile.social.search.hiddenOrUnknown'
                  : feedback === 'malformed-handle'
                    ? 'mobile.social.search.malformedHandle'
                    : feedback === 'failed'
                      ? 'mobile.contacts.searchFailed'
                      : 'mobile.contacts.noPeopleResults')}</Text>
            {feedback !== 'idle' && query.trim() ? <Button actionId="people-search-retry"
              emphasis="quiet" onActivate={onSearch}>
              {t('common.action.retry')}
            </Button> : null}
          </div>
        } /> : null}
      </div>
    </section>
  );
}
