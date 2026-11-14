import { useEffect, useMemo, useState } from 'react';
import {
  Button,
  Checkbox,
  Empty,
  Icon,
  IconButton,
  Select,
  Spin,
  Text,
  TextField,
} from '@peers-touch/ui';

import { useMobileI18n } from '../../app/mobileI18n';
import { MobileNotice } from '../../components/MobileNotice';
import { useMobilePageDisposal } from '../../components/mobilePageLifetime';
import { SocialActorAvatar } from '../../features/social/SocialActorAvatar';
import { actorDisplayName } from '../../features/social/socialProjection';
import { useSocialCirclesStore } from '../../features/social/socialCircles';
import { useSocialStore } from '../../features/social/socialStore';
import type { CircleMember } from '../../gen/proto/domain/social/circle_pb';

const EMPTY_CIRCLE_MEMBERS: readonly CircleMember[] = [];

interface SocialCircleMemberPickerPageProps {
  readonly circleId: string;
  readonly onBack: () => void;
}

export function SocialCircleMemberPickerPage({
  circleId,
  onBack,
}: SocialCircleMemberPickerPageProps) {
  const { t } = useMobileI18n();
  const members = useSocialCirclesStore(
    (state) => state.membersByCircle[circleId] ?? EMPTY_CIRCLE_MEMBERS,
  );
  const results = useSocialCirclesStore((state) => state.pickerResults);
  const loading = useSocialCirclesStore((state) => state.pickerLoading);
  const error = useSocialCirclesStore((state) => state.pickerError);
  const mutationError = useSocialCirclesStore((state) => state.error);
  const pending = useSocialCirclesStore((state) =>
    Boolean(state.pendingCircleIds[circleId]),
  );
  const searchPeople = useSocialCirclesStore(
    (state) => state.searchPickerPeople,
  );
  const clearSearch = useSocialCirclesStore((state) => state.clearPickerSearch);
  const addMembers = useSocialCirclesStore((state) => state.addMembers);
  const refreshMembers = useSocialCirclesStore((state) => state.refreshMembers);
  const federations = useSocialStore((state) => state.peopleSearchFederations);
  const refreshFederations = useSocialStore(
    (state) => state.refreshFederationContexts,
  );
  const [query, setQuery] = useState('');
  const [federationId, setFederationId] = useState('');
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const [actionError, setActionError] = useState('');
  const existing = useMemo(
    () => new Set(members.map((member) => member.actorPtid)),
    [members],
  );

  useEffect(() => {
    void Promise.all([refreshMembers(circleId), refreshFederations()]);
  }, [circleId, refreshFederations, refreshMembers]);
  useMobilePageDisposal(clearSearch);

  const submit = async () => {
    if (selected.size === 0 || pending) return;
    setActionError('');
    try {
      await addMembers(circleId, [...selected]);
      onBack();
    } catch (caught) {
      setActionError(
        caught instanceof Error
          ? caught.message
          : 'mobile.social.circles.failed',
      );
    }
  };

  return (
    <div
      className="page-container mobile-detail-page social-detail-page circle-member-picker"
      data-acceptance-id="social-circle-member-picker"
      data-circle-id={circleId}
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
          {t('mobile.social.circles.addMembers')}
        </h1>
        <button
          type="button"
          className="header-action"
          data-acceptance-id="social-circle-members-submit"
          aria-label={t('common.action.done')}
          disabled={selected.size === 0 || pending}
          onClick={() => void submit()}
        >
          <Icon iconId="check" size={20} />
        </button>
      </header>

      <div className="mobile-detail-body circle-page-body">
        <Text tone="secondary">{t('mobile.social.circles.pickerHint')}</Text>
        <Select<string>
          clearable
          value={federationId || undefined}
          placeholder={t('mobile.social.circles.localAndRemote')}
          options={federations.map((federation) => ({
            label: federation.name || federation.federationId,
            value: federation.federationId,
          }))}
          onValueChange={(value) => setFederationId(value ? String(value) : '')}
        />
        <div className="circle-picker-search">
          <span className="circle-picker-search-input">
            <TextField
              appearance="search"
              density="comfortable"
              value={query}
              data-acceptance-id="social-circle-member-search"
              leading={<Icon iconId="search" size={16} className="circle-picker-search-leading" />}
              placeholder={t('mobile.social.circles.search')}
              onEnter={() => void searchPeople(query, federationId)}
              onValueChange={(value) => {
                setQuery(value);
                if (!value) clearSearch();
              }}
            />
          </span>
          <IconButton
            actionId="social-circle-member-search-run"
            iconId="search"
            iconSize={16}
            label={t('mobile.social.circles.search')}
            execution={loading ? 'pending' : 'idle'}
            availability={!query.trim()
              ? { kind: 'disabled', reason: t('mobile.social.circles.search') }
              : undefined}
            onActivate={() => void searchPeople(query, federationId)}
          />
        </div>
        {error || mutationError || actionError ? (
          <MobileNotice tone="error">
            {t(actionError || mutationError || error || '')}
          </MobileNotice>
        ) : null}

        <Spin active={loading && results.length === 0}>
          <div className="circle-picker-results">
            {results.map((actor) => {
              const disabled = existing.has(actor.ptid);
              const checked = disabled || selected.has(actor.ptid);
              return (
                <button
                  type="button"
                  className="circle-picker-row"
                  key={actor.ptid}
                  data-acceptance-id="social-circle-member-candidate"
                  data-actor-ptid={actor.ptid}
                  disabled={disabled}
                  onClick={() => {
                    setSelected((current) => {
                      const next = new Set(current);
                      if (next.has(actor.ptid)) next.delete(actor.ptid);
                      else next.add(actor.ptid);
                      return next;
                    });
                  }}
                >
                  <SocialActorAvatar
                    actorPtid={actor.ptid}
                    avatar={actor.avatar}
                    displayName={actor.displayName}
                    size={42}
                    username={actor.username}
                  />
                  <span className="circle-row-copy">
                    <Text strong truncate>
                      {actorDisplayName(actor.displayName || actor.username, actor.ptid)
                        || t('mobile.contacts.unknownUser')}
                    </Text>
                    <Text tone="secondary" truncate>
                      {actor.federation?.handle || actor.ptid}
                    </Text>
                  </span>
                  <Checkbox checked={checked} disabled={disabled} readOnly />
                </button>
              );
            })}
          </div>
          {!loading && query && results.length === 0 ? (
            <Empty description={t('mobile.social.circles.noResults')} />
          ) : null}
        </Spin>
        <Button
          actionId="social-circle-members-add"
          emphasis="primary"
          fullWidth
          data-acceptance-id="social-circle-members-add"
          availability={selected.size === 0
            ? { kind: 'disabled', reason: t('mobile.social.circles.addMembers') }
            : undefined}
          execution={pending ? 'pending' : 'idle'}
          onActivate={() => void submit()}
        >
          {t('mobile.social.circles.addSelected', { count: selected.size })}
        </Button>
      </div>
    </div>
  );
}
