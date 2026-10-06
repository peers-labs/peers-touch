import { useEffect, useMemo, useState } from 'react';
import { Button, Checkbox, Empty, Input, Select, Spin, Typography } from 'antd';
import { ArrowLeft, Check, Search } from 'lucide-react';

import { useMobileI18n } from '../../app/mobileI18n';
import { MobileAvatar } from '../../components/MobileAvatar';
import { MobileNotice } from '../../components/MobileNotice';
import { useSocialCirclesStore } from '../../features/social/socialCircles';
import { useSocialStore } from '../../features/social/socialStore';

const { Text } = Typography;

interface SocialCircleMemberPickerPageProps {
  readonly circleId: string;
  readonly onBack: () => void;
}

export function SocialCircleMemberPickerPage({
  circleId,
  onBack,
}: SocialCircleMemberPickerPageProps) {
  const { t } = useMobileI18n();
  const members = useSocialCirclesStore((state) => state.membersByCircle[circleId] ?? []);
  const results = useSocialCirclesStore((state) => state.pickerResults);
  const loading = useSocialCirclesStore((state) => state.pickerLoading);
  const error = useSocialCirclesStore((state) => state.pickerError);
  const mutationError = useSocialCirclesStore((state) => state.error);
  const pending = useSocialCirclesStore(
    (state) => Boolean(state.pendingCircleIds[circleId]),
  );
  const searchPeople = useSocialCirclesStore((state) => state.searchPickerPeople);
  const clearSearch = useSocialCirclesStore((state) => state.clearPickerSearch);
  const addMembers = useSocialCirclesStore((state) => state.addMembers);
  const refreshMembers = useSocialCirclesStore((state) => state.refreshMembers);
  const federations = useSocialStore((state) => state.peopleSearchFederations);
  const refreshFederations = useSocialStore((state) => state.refreshFederationContexts);
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
    return clearSearch;
  }, [circleId, clearSearch, refreshFederations, refreshMembers]);

  const submit = async () => {
    if (selected.size === 0 || pending) return;
    setActionError('');
    try {
      await addMembers(circleId, [...selected]);
      onBack();
    } catch (caught) {
      setActionError(
        caught instanceof Error ? caught.message : 'mobile.social.circles.failed',
      );
    }
  };

  return (
    <div className="page-container mobile-detail-page circle-member-picker">
      <header className="page-header">
        <button
          type="button"
          className="header-action"
          aria-label={t('common.action.back')}
          onClick={onBack}
        >
          <ArrowLeft size={20} />
        </button>
        <h1 className="header-title compact">{t('mobile.social.circles.addMembers')}</h1>
        <button
          type="button"
          className="header-action"
          aria-label={t('common.action.done')}
          disabled={selected.size === 0 || pending}
          onClick={() => void submit()}
        >
          <Check size={20} />
        </button>
      </header>

      <div className="mobile-detail-body circle-page-body">
        <Text type="secondary">{t('mobile.social.circles.pickerHint')}</Text>
        <Select
          allowClear
          value={federationId || undefined}
          placeholder={t('mobile.social.circles.localAndRemote')}
          options={federations.map((federation) => ({
            label: federation.name || federation.federationId,
            value: federation.federationId,
          }))}
          onChange={(value) => setFederationId(value ?? '')}
        />
        <Input.Search
          value={query}
          enterButton={<Search size={16} />}
          loading={loading}
          placeholder={t('mobile.social.circles.search')}
          onChange={(event) => {
            setQuery(event.target.value);
            if (!event.target.value) clearSearch();
          }}
          onSearch={(value) => void searchPeople(value, federationId)}
        />
        {error || mutationError || actionError ? (
          <MobileNotice tone="error">
            {t(actionError || mutationError || error || '')}
          </MobileNotice>
        ) : null}

        <Spin spinning={loading && results.length === 0}>
          <div className="circle-picker-results">
            {results.map((actor) => {
              const disabled = existing.has(actor.ptid);
              const checked = disabled || selected.has(actor.ptid);
              return (
                <button
                  type="button"
                  className="circle-picker-row"
                  key={actor.ptid}
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
                  <MobileAvatar src={actor.avatar} size={42}>
                    {(actor.displayName || actor.username || actor.ptid).slice(0, 1)}
                  </MobileAvatar>
                  <span className="circle-row-copy">
                    <Text strong ellipsis>
                      {actor.displayName || actor.username || actor.ptid}
                    </Text>
                    <Text type="secondary" ellipsis>
                      {actor.federation?.handle || actor.ptid}
                    </Text>
                  </span>
                  <Checkbox checked={checked} disabled={disabled} />
                </button>
              );
            })}
          </div>
          {!loading && query && results.length === 0 ? (
            <Empty
              image={Empty.PRESENTED_IMAGE_SIMPLE}
              description={t('mobile.social.circles.noResults')}
            />
          ) : null}
        </Spin>
        <Button
          block
          type="primary"
          loading={pending}
          disabled={selected.size === 0}
          onClick={() => void submit()}
        >
          {t('mobile.social.circles.addSelected', { count: selected.size })}
        </Button>
      </div>
    </div>
  );
}
