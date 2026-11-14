import { useEffect, useMemo, useRef, useState } from 'react';
import { useMobileI18n } from '../app/mobileI18n';
import { useContactsSurfaceFixture } from '../acceptance/contactsSurfaceFixture';
import { classifyPeopleSearchFeedback } from '../features/social/contactInteractionState';
import { dispatchSendFriendRequest } from '../features/social/contactCommands';
import { useSocialStore } from '../features/social/socialStore';
import {
  projectAcceptedContacts, projectOutgoingRequests, projectPendingInboundRequests,
} from '../features/social/socialProjection';
import { readableErrorMessage, type ActorSearchResult, type PeopleSearchScope } from '../features/social/socialTypes';
import { ContactsAcceptanceSurface } from './contacts/ContactsAcceptanceSurface';
import { FindPeopleSurface, type PeopleResultAction } from './contacts/FindPeopleSurface';

export function FindPeoplePage({ onBack }: { readonly onBack: () => void }) {
  const fixture = useContactsSurfaceFixture();
  return fixture.surfaceId
    ? <ContactsAcceptanceSurface key={`${fixture.surfaceId}:${fixture.revision}`} surfaceId={fixture.surfaceId} />
    : <LiveFindPeoplePage onBack={onBack} />;
}

function LiveFindPeoplePage({ onBack }: { readonly onBack: () => void }) {
  const { t } = useMobileI18n();
  const [query, setQuery] = useState('');
  const [submittedQuery, setSubmittedQuery] = useState('');
  const [scope, setScope] = useState<PeopleSearchScope>({ kind: 'station' });
  const [sendingPtid, setSendingPtid] = useState('');
  const [actionError, setActionError] = useState('');
  const results = useSocialStore(s => s.peopleSearchResults);
  const federations = useSocialStore(s => s.peopleSearchFederations);
  const federationsError = useSocialStore(s => s.peopleSearchFederationsError);
  const loading = useSocialStore(s => s.peopleSearchLoading);
  const error = useSocialStore(s => s.peopleSearchError);
  const searchPeople = useSocialStore(s => s.searchPeople);
  const clearSearch = useSocialStore(s => s.clearPeopleSearch);
  const refreshFederations = useSocialStore(s => s.refreshFederationContexts);
  const session = useSocialStore(s => s.authSession);
  const currentUserPtid = useSocialStore(s => s.currentUserPtid);
  const requests = useSocialStore(s => s.friendRequests);
  const owner = useRef<object | null>(null);
  const initialized = useRef(false);
  const sendingRef = useRef(false);
  const searchContext = useMemo(() => ({ query, scope }), [query, scope]);
  const searchContextRef = useRef(searchContext);
  searchContextRef.current = searchContext;
  useEffect(() => {
    const token = {};
    owner.current = token;
    if (!initialized.current) {
      initialized.current = true;
      clearSearch();
      setSubmittedQuery('');
    }
    setSendingPtid('');
    sendingRef.current = false;
    setActionError('');
    void refreshFederations();
    return () => { owner.current = null; };
  }, [session, clearSearch, refreshFederations]);

  // Discovery does not grant relationship authority. Use an observed context.
  const requestFederationId = scope.kind === 'federation'
    ? federations.find(f => f.federationId === scope.federationId)?.federationId ?? ''
    : federations.length === 1 ? federations[0].federationId : '';
  const relationships = useMemo(() => ({
    accepted: new Set(projectAcceptedContacts(requests, currentUserPtid, {}).map(c => c.peerPtid)),
    outgoing: new Set(projectOutgoingRequests(requests, currentUserPtid).map(r => r.receiverPtid)),
    incoming: new Set(projectPendingInboundRequests(requests, currentUserPtid).map(r => r.senderPtid)),
  }), [requests, currentUserPtid]);
  const actions = useMemo(() => Object.fromEntries(results.map(result => {
    const statusKey = result.ptid === currentUserPtid ? 'mobile.contacts.self'
      : relationships.accepted.has(result.ptid)
        ? 'mobile.contacts.alreadyFriend'
      : relationships.outgoing.has(result.ptid)
        ? 'mobile.contacts.requestSent'
      : relationships.incoming.has(result.ptid)
        ? 'mobile.contacts.requestPending'
        : undefined;
    const reason = statusKey || (!requestFederationId
      ? federations.length > 1 ? 'mobile.contacts.requestScopeRequired' : 'mobile.contacts.noFederation'
      : !result.homeStationPeerId ? 'mobile.contacts.personUnavailable'
        : sendingPtid || loading ? 'mobile.contacts.resolving' : undefined);
    return [result.ptid, {
      label: t(statusKey ?? 'mobile.contacts.sendRequest'),
      unavailableReason: reason ? t(reason) : undefined,
      pending: sendingPtid === result.ptid,
    } satisfies PeopleResultAction];
  })), [currentUserPtid, federations.length, loading, requestFederationId, relationships, results, sendingPtid, t]);

  const runSearch = () => {
    setSubmittedQuery(query.trim());
    setActionError('');
    void searchPeople(query, scope);
  };
  const sendRequest = async (result: ActorSearchResult) => {
    if (!actions[result.ptid] || actions[result.ptid].unavailableReason || !requestFederationId || sendingRef.current) return;
    const token = owner.current;
    const context = searchContext;
    sendingRef.current = true;
    setSendingPtid(result.ptid);
    setActionError('');
    try {
      const command = await dispatchSendFriendRequest(
        result.ptid, result.homeStationPeerId, requestFederationId, '',
      );
      if (owner.current !== token || searchContextRef.current !== context) return;
      if (!command.checkpointReady) setActionError(t('mobile.contacts.requestUnconfirmed'));
    } catch (caught) {
      if (owner.current === token && searchContextRef.current === context) {
        setActionError(t(readableErrorMessage(caught, 'mobile.contacts.requestFailed')));
      }
    } finally {
      if (owner.current === token) {
        sendingRef.current = false;
        setSendingPtid('');
      }
    }
  };
  return <FindPeopleSurface query={query} scope={scope} federations={federations}
    results={results} loading={loading}
    feedback={classifyPeopleSearchFeedback({ query: submittedQuery, resultCount: results.length, loading, error })}
    error={actionError || (error ? t(error.context.message.startsWith('mobile.')
      ? error.context.message : 'mobile.contacts.searchFailed') : undefined)}
    notice={federationsError ? t('mobile.contacts.federationsFailed') : undefined}
    actions={actions} onBack={onBack} onSearch={runSearch} onSendRequest={sendRequest}
    onQueryChange={value => {
      setQuery(value); setSubmittedQuery(''); setActionError(''); clearSearch();
    }}
    onScopeChange={value => {
      setScope(value); setSubmittedQuery(''); setActionError(''); clearSearch();
    }} />;
}
