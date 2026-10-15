import { useEffect, useMemo, useState } from 'react';
import {
  Check,
  ChevronRight,
  Search,
  ShieldCheck,
  UsersRound,
} from 'lucide-react';

import { useMobileI18n } from '../../app/mobileI18n';
import { useSocialCirclesStore } from '../../features/social/socialCircles';
import { useSocialStore } from '../../features/social/socialStore';
import type { SocialAudienceChoice } from '../../features/social/socialAudience';

export type MomentAudienceTargetChoice = Extract<
  SocialAudienceChoice,
  'CIRCLE' | 'GROUP' | 'CUSTOM_ALLOW' | 'CUSTOM_DENY'
>;

interface MomentAudienceTargetPickerProps {
  readonly choice: MomentAudienceTargetChoice;
  readonly selectedActorLabels: Readonly<Record<string, string>>;
  readonly selectedActorPtids: readonly string[];
  readonly onDismiss: () => void;
  readonly onSelectCircle: (circleId: string) => void;
  readonly onSelectGroup: (conversationId: string) => void;
  readonly onSelectActors: (
    actorPtids: readonly string[],
    actorLabels: Readonly<Record<string, string>>,
  ) => void;
}

export function MomentAudienceTargetPicker({
  choice,
  selectedActorLabels,
  selectedActorPtids,
  onDismiss,
  onSelectCircle,
  onSelectGroup,
  onSelectActors,
}: MomentAudienceTargetPickerProps) {
  const { t } = useMobileI18n();
  const circles = useSocialCirclesStore((state) => state.circles);
  const refreshCircles = useSocialCirclesStore(
    (state) => state.refreshCircles,
  );
  const conversations = useSocialStore((state) => state.messagingConversations);
  const people = useSocialStore((state) => state.peopleSearchResults);
  const federations = useSocialStore((state) => state.peopleSearchFederations);
  const loading = useSocialStore((state) => state.peopleSearchLoading);
  const error = useSocialStore((state) => state.peopleSearchError);
  const refreshFederations = useSocialStore(
    (state) => state.refreshFederationContexts,
  );
  const searchPeople = useSocialStore((state) => state.searchPeople);
  const clearPeopleSearch = useSocialStore((state) => state.clearPeopleSearch);
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState(
    () => new Set(selectedActorPtids),
  );
  const [actorLabels, setActorLabels] = useState<Record<string, string>>(
    () => ({ ...selectedActorLabels }),
  );
  const groups = useMemo(
    () => conversations.filter(
      (conversation) => conversation.active && conversation.kind === 2,
    ),
    [conversations],
  );
  const customAudience = choice === 'CUSTOM_ALLOW' || choice === 'CUSTOM_DENY';
  const federationId = useMemo(
    () => (
      federations.find((federation) => (
        federation.status.toLowerCase() === 'active'
      ))?.federationId
      ?? federations[0]?.federationId
      ?? ''
    ),
    [federations],
  );
  const titleKey = choice === 'CIRCLE'
    ? 'mobile.moments.audience.chooseCircle'
    : choice === 'GROUP'
      ? 'mobile.moments.audience.chooseGroup'
      : choice === 'CUSTOM_DENY'
        ? 'mobile.moments.audience.excludeFollowers'
        : 'mobile.moments.audience.choosePeople';

  useEffect(() => {
    if (choice === 'CIRCLE') void refreshCircles();
  }, [choice, refreshCircles]);

  useEffect(() => {
    if (!customAudience) return undefined;
    void refreshFederations();
    return clearPeopleSearch;
  }, [clearPeopleSearch, customAudience, refreshFederations]);

  useEffect(() => {
    if (!customAudience) return undefined;
    const trimmed = query.trim();
    if (!trimmed) {
      clearPeopleSearch();
      return undefined;
    }
    if (!federationId) return undefined;
    const timer = setTimeout(() => {
      void searchPeople(trimmed, federationId);
    }, 250);
    return () => clearTimeout(timer);
  }, [
    clearPeopleSearch,
    customAudience,
    federationId,
    query,
    searchPeople,
  ]);

  return (
    <div
      className="moments-sheet-backdrop moments-audience-target-backdrop"
      data-acceptance-id="social-audience-target"
      data-audience-target={choice}
      role="presentation"
      onPointerDown={(event) => {
        event.stopPropagation();
        onDismiss();
      }}
    >
      <section
        className="moments-bottom-sheet moment-audience-target-sheet"
        role="dialog"
        aria-modal="true"
        aria-label={t(titleKey)}
        onPointerDown={(event) => event.stopPropagation()}
      >
        <div className="moments-sheet-handle" />
        <header className="moments-sheet-header moment-audience-target-header">
          <span />
          <h2>{t(titleKey)}</h2>
          {customAudience ? (
            <button
              type="button"
              className="moment-audience-target-commit"
              data-acceptance-id="social-audience-target-done"
              disabled={selected.size === 0}
              onClick={() => onSelectActors([...selected], actorLabels)}
            >
              {t('common.action.done')}
            </button>
          ) : <span />}
        </header>

        <div className="moment-audience-target-copy">
          <ShieldCheck size={17} />
          <span>
            {t(
              choice === 'CUSTOM_DENY'
                ? 'mobile.moments.audience.excludeHint'
                : 'mobile.moments.audience.targetHint',
            )}
          </span>
        </div>

        {customAudience ? (
          <div className="moment-audience-target-search">
            <label>
              <Search size={17} />
              <input
                value={query}
                data-acceptance-id="social-audience-people-search"
                aria-label={t('mobile.moments.audience.searchPeople')}
                placeholder={t('mobile.moments.audience.searchPeople')}
                onChange={(event) => setQuery(event.target.value)}
              />
            </label>
          </div>
        ) : null}

        {error ? (
          <p className="moment-audience-target-state" role="alert">
            {t(error.context.message)}
          </p>
        ) : null}

        <div className="moment-audience-target-list">
          {choice === 'CIRCLE'
            ? circles.map((circle) => (
                <button
                  type="button"
                  key={circle.id.toString()}
                  data-acceptance-id="social-audience-circle"
                  data-circle-id={circle.id.toString()}
                  onClick={() => onSelectCircle(circle.id.toString())}
                >
                  <span className="moment-audience-choice-icon">
                    <UsersRound size={18} />
                  </span>
                  <span>
                    <strong>{circle.name}</strong>
                    <small>
                      {t('mobile.social.circles.memberCount', {
                        count: circle.memberCount.toString(),
                      })}
                    </small>
                  </span>
                  <ChevronRight size={17} />
                </button>
              ))
            : null}

          {choice === 'GROUP'
            ? groups.map((group) => (
                <button
                  type="button"
                  key={group.conversationId}
                  data-acceptance-id="social-audience-group"
                  data-group-id={group.conversationId}
                  onClick={() => onSelectGroup(group.conversationId)}
                >
                  <span className="moment-audience-choice-icon">
                    <UsersRound size={18} />
                  </span>
                  <span>
                    <strong>{group.name || group.conversationId}</strong>
                    <small>
                      {t('mobile.moments.audience.activeMembers', {
                        count: group.memberPtids.length,
                      })}
                    </small>
                  </span>
                  <ChevronRight size={17} />
                </button>
              ))
            : null}

          {customAudience
            ? people.map((person) => {
                const checked = selected.has(person.ptid);
                const label =
                  person.displayName || person.username || person.ptid;
                return (
                  <button
                    type="button"
                    key={person.ptid}
                    aria-pressed={checked}
                    data-acceptance-id="social-audience-actor"
                    data-actor-ptid={person.ptid}
                    onClick={() => {
                      setSelected((current) => {
                        const next = new Set(current);
                        if (next.has(person.ptid)) next.delete(person.ptid);
                        else next.add(person.ptid);
                        return next;
                      });
                      setActorLabels((current) => ({
                        ...current,
                        [person.ptid]: label,
                      }));
                    }}
                  >
                    <span
                      className="moment-audience-selection-check"
                      data-selected={checked}
                    >
                      {checked ? <Check size={16} /> : null}
                    </span>
                    <span>
                      <strong>{label}</strong>
                      <small>{person.federation?.handle || person.ptid}</small>
                    </span>
                  </button>
                );
              })
            : null}
        </div>

        {customAudience && query && !loading && people.length === 0 && !error ? (
          <p className="moment-audience-target-state">
            {t('mobile.social.circles.noResults')}
          </p>
        ) : null}
      </section>
    </div>
  );
}
