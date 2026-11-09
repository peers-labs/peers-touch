import { useEffect, useMemo, useState } from 'react';
import {
  Button,
  Empty,
  Icon,
  RadioGroup,
  Spin,
  Tag,
  Text,
  TextField,
} from '@peers-touch/ui';

import { useMobileI18n } from '../../app/mobileI18n';
import type { MobileDetailRoute } from '../../app/navigation';
import {
  readListAnchor,
  readRouteQuery,
  saveListAnchor,
  saveRouteQuery,
} from '../../app/navigation/scrollRestoration';
import { MobileNotice } from '../../components/MobileNotice';
import { SocialActorAvatar } from '../../features/social/SocialActorAvatar';
import { actorDisplayName } from '../../features/social/socialProjection';
import { classifyPeopleSearchFeedback } from '../../features/social/contactInteractionState';
import { useSocialStore } from '../../features/social/socialStore';

const SEARCH_ROUTE_KEY = 'detail:social-search';
const FEDERATED_HANDLE_RE = /^@?[a-zA-Z0-9._-]+(?:@[a-zA-Z0-9.-]+(?::\d+)?)?$/;

interface SocialSearchPageProps {
  readonly onBack: () => void;
  readonly onOpenProfile: (
    route: Extract<
      MobileDetailRoute,
      { readonly routeId: 'detail:social-profile' }
    >,
  ) => void;
}

export function SocialSearchPage({
  onBack,
  onOpenProfile,
}: SocialSearchPageProps) {
  const { t } = useMobileI18n();
  const [query, setQuery] = useState(() => readRouteQuery(SEARCH_ROUTE_KEY));
  const [submittedQuery, setSubmittedQuery] = useState(() =>
    readRouteQuery(SEARCH_ROUTE_KEY),
  );
  const [selectedFederationId, setSelectedFederationId] = useState('');
  const [malformedHandle, setMalformedHandle] = useState(false);

  const results = useSocialStore((state) => state.peopleSearchResults);
  const federations = useSocialStore((state) => state.peopleSearchFederations);
  const federationsError = useSocialStore(
    (state) => state.peopleSearchFederationsError,
  );
  const loading = useSocialStore((state) => state.peopleSearchLoading);
  const error = useSocialStore((state) => state.peopleSearchError);
  const refreshFederations = useSocialStore(
    (state) => state.refreshFederationContexts,
  );
  const searchPeople = useSocialStore((state) => state.searchPeople);
  const clearPeopleSearch = useSocialStore((state) => state.clearPeopleSearch);

  useEffect(() => {
    void refreshFederations();
  }, [refreshFederations]);

  const federationId = useMemo(() => {
    if (
      federations.some((item) => item.federationId === selectedFederationId)
    ) {
      return selectedFederationId;
    }
    return federations.length === 1 ? federations[0].federationId : '';
  }, [federations, selectedFederationId]);

  const feedback = malformedHandle
    ? 'malformed-handle'
    : classifyPeopleSearchFeedback({
        query: submittedQuery,
        resultCount: results.length,
        loading,
        error,
      });
  const activeAnchor = readListAnchor(SEARCH_ROUTE_KEY);

  const runSearch = async (value: string) => {
    const nextQuery = value.trim();
    const malformed =
      nextQuery.startsWith('@') && !FEDERATED_HANDLE_RE.test(nextQuery);
    setMalformedHandle(malformed);
    setSubmittedQuery(nextQuery);
    saveRouteQuery(SEARCH_ROUTE_KEY, nextQuery);
    if (malformed) {
      clearPeopleSearch();
      return;
    }
    await searchPeople(nextQuery, federationId);
  };

  const handleQueryChange = (value: string) => {
    setQuery(value);
    setSubmittedQuery('');
    setMalformedHandle(false);
    saveRouteQuery(SEARCH_ROUTE_KEY, value);
    clearPeopleSearch();
  };

  return (
    <div
      className="page-container mobile-detail-page social-detail-page"
      data-acceptance-id="social-search-page"
    >
      <header className="page-header">
        <button
          type="button"
          className="header-action"
          aria-label={t('common.action.back')}
          onClick={onBack}
        >
          <Icon iconId="arrow-left" size={20} />
        </button>
        <h1 className="header-title compact">
          {t('mobile.social.search.title')}
        </h1>
      </header>

      <div className="mobile-detail-body">
        <div className="social-search-bar">
          <span className="social-search-input">
            <TextField
              value={query}
              data-acceptance-id="social-search-input"
              data-focus-id="social-search-input"
              leading={<Icon iconId="search" size={16} className="social-search-leading" />}
              clearable
              onClear={() => handleQueryChange('')}
              placeholder={t('mobile.contacts.findPeoplePlaceholder')}
              disabled={!federationId}
              onEnter={() => void runSearch(query)}
              onValueChange={handleQueryChange}
            />
          </span>
          <Button
            actionId="social-search-run"
            emphasis="primary"
            execution={loading ? 'pending' : 'idle'}
            availability={!federationId
              ? { kind: 'disabled', reason: t('mobile.contacts.noFederation') }
              : undefined}
            onActivate={() => void runSearch(query)}
          >
            {t('common.action.search')}
          </Button>
        </div>

        {federationsError ? (
          <MobileNotice tone="error">
            {t('mobile.contacts.federationsFailed')}
          </MobileNotice>
        ) : federations.length === 0 ? (
          <MobileNotice>{t('mobile.contacts.noFederation')}</MobileNotice>
        ) : (
          <fieldset>
            <legend>{t('mobile.contacts.federation')}</legend>
            <RadioGroup<string>
              label={t('mobile.contacts.federation')}
              value={federationId}
              options={federations.map((federation) => ({
                label: federation.name || federation.federationId,
                value: federation.federationId,
              }))}
              onValueChange={(value) => {
                setSelectedFederationId(String(value));
                clearPeopleSearch();
              }}
            />
          </fieldset>
        )}

        <Spin active={loading && results.length === 0}>
          <div className="people-result-list" data-search-state={feedback}>
            {results.map((result) => (
              <button
                key={result.ptid}
                type="button"
                className="people-result-card"
                data-acceptance-id="social-search-result"
                data-actor-ptid={result.ptid}
                data-scroll-anchor-id={result.ptid}
                data-focus-id={`social-result:${result.ptid}`}
                data-active={activeAnchor === result.ptid}
                onClick={() => {
                  saveListAnchor(SEARCH_ROUTE_KEY, result.ptid);
                  onOpenProfile({
                    routeId: 'detail:social-profile',
                    actorPtid: result.ptid,
                    federationId,
                  });
                }}
              >
                <SocialActorAvatar
                  actorPtid={result.ptid}
                  avatar={result.avatar}
                  displayName={result.displayName}
                  size={42}
                  username={result.username}
                />
                <span className="people-result-copy">
                  <span className="people-result-title">
                    <Text strong truncate>
                      {actorDisplayName(result.displayName || result.username, result.ptid)
                        || t('mobile.contacts.unknownUser')}
                    </Text>
                    {result.federation ? (
                      <Tag tone="success" className="people-result-verified"
                        leading={<Icon iconId="shield-check" size={11} />}>
                        {t('mobile.contacts.verified')}
                      </Tag>
                    ) : null}
                  </span>
                  <Text tone="secondary" truncate>
                    {result.federation?.handle || result.ptid}
                  </Text>
                </span>
                <Icon iconId="chevron-right" size={18} />
              </button>
            ))}

            {results.length === 0 && feedback !== 'loading' ? (
              <Empty description={t(searchFeedbackKey(feedback))} />
            ) : null}
          </div>
        </Spin>
      </div>
    </div>
  );
}

function searchFeedbackKey(feedback: string): string {
  switch (feedback) {
    case 'malformed-handle':
      return 'mobile.social.search.malformedHandle';
    case 'unresolved-federated-handle':
      return 'mobile.social.search.hiddenOrUnknown';
    case 'remote-unavailable':
      return 'mobile.social.search.remoteUnavailable';
    case 'failed':
      return 'mobile.social.search.permissionDenied';
    case 'local-no-result':
      return 'mobile.contacts.noPeopleResults';
    default:
      return 'mobile.contacts.findPeopleHint';
  }
}
