import { useState, type ComponentProps } from 'react';
import { useTranslation } from 'react-i18next';

import { Button, Icon } from '@peers-touch/ui';
import {
  TurnAttributionKind,
  TurnAttributionOutcome,
  TurnAttributionState,
  type TurnAttributionEntry,
  type TurnAttributionProjection,
} from '../../gen/proto/domain/agent/agent_pb';

// Derive the icon id union from peers-ui itself so this package needs no
// direct dependency on @peers-touch/ui-assets.
type IconIdValue = ComponentProps<typeof Icon>['iconId'];

// View-layer migration: lucide components are replaced by peers-ui icon ids
// that resolve to the same lucide glyph set through @peers-touch/ui-assets.
// IdCard / BookOpenText have no direct peers-ui id, so they map to the closest
// semantic equivalents (user / book-open).
const KIND_META = new Map<
  TurnAttributionKind,
  { iconId: IconIdValue; localeKey: string }
>([
  [TurnAttributionKind.SKILL, { iconId: 'sparkles', localeKey: 'skill' }],
  [TurnAttributionKind.PROFILE, { iconId: 'user', localeKey: 'profile' }],
  [TurnAttributionKind.MEMORY, { iconId: 'brain', localeKey: 'memory' }],
  [TurnAttributionKind.KNOWLEDGE, {
    iconId: 'book-open',
    localeKey: 'knowledge',
  }],
  [TurnAttributionKind.ATTACHMENT, {
    iconId: 'paperclip',
    localeKey: 'attachment',
  }],
  [TurnAttributionKind.TOOL, { iconId: 'wrench', localeKey: 'tool' }],
]);

const REASON_KEYS: Record<string, string> = {
  context_included: 'included',
  context_truncated: 'truncated',
  context_omitted: 'omitted',
  memory_disabled: 'memoryDisabled',
  no_skills_available: 'noSkills',
  skill_body_unavailable: 'skillUnavailable',
  skill_body_empty: 'skillEmpty',
  tool_succeeded: 'toolSucceeded',
  tool_partial: 'toolPartial',
  tool_denied: 'toolDenied',
  tool_cancelled: 'toolCancelled',
  tool_expired: 'toolExpired',
  tool_incomplete: 'toolIncomplete',
};

export function visibleAttributionEntries(
  projection: TurnAttributionProjection,
): TurnAttributionEntry[] {
  return projection.entries.filter(
    (entry) => entry.outcome !== TurnAttributionOutcome.OMITTED,
  );
}

export interface AttributionKindGroup {
  kind: TurnAttributionKind;
  entries: TurnAttributionEntry[];
  truncated: boolean;
}

// Groups visible attribution entries by kind, preserving first-occurrence
// order. Two different tools must collapse into one counted chip rather than
// render as two identical "Tool" labels; truncated membership flags the group.
export function groupAttributionEntriesByKind(
  entries: readonly TurnAttributionEntry[],
): AttributionKindGroup[] {
  const order: TurnAttributionKind[] = [];
  const buckets = new Map<TurnAttributionKind, TurnAttributionEntry[]>();
  for (const entry of entries) {
    const bucket = buckets.get(entry.kind);
    if (bucket) {
      bucket.push(entry);
    } else {
      buckets.set(entry.kind, [entry]);
      order.push(entry.kind);
    }
  }
  return order.map((kind) => {
    const groupEntries = buckets.get(kind) ?? [];
    return {
      kind,
      entries: groupEntries,
      truncated: groupEntries.some(
        (entry) => entry.outcome === TurnAttributionOutcome.TRUNCATED,
      ),
    };
  });
}

function attributionOutcomeKey(outcome: TurnAttributionOutcome): string {
  switch (outcome) {
    case TurnAttributionOutcome.INCLUDED:
      return 'included';
    case TurnAttributionOutcome.TRUNCATED:
      return 'truncated';
    default:
      return 'omitted';
  }
}

export function TurnAttribution({
  projection,
}: {
  projection?: TurnAttributionProjection;
}) {
  const { t } = useTranslation('chat');
  const [open, setOpen] = useState(false);

  if (!projection) return null;
  if (projection.state === TurnAttributionState.UNAVAILABLE) {
    return (
      <span className="sc-attribution-unavailable" data-turn-attribution-state="unavailable">
        <Icon iconId="file-text" size={12} />
        {t('chat.message.attribution.unavailable')}
      </span>
    );
  }
  if (projection.state !== TurnAttributionState.AVAILABLE) return null;

  const visible = visibleAttributionEntries(projection);
  if (visible.length === 0) return null;

  // Collapse entries of the same kind into one chip so two different tools
  // do not render as two identical "Tool" labels.
  const groups = groupAttributionEntriesByKind(visible);

  return (
    <div
      className="sc-attribution"
      data-turn-attribution
      data-turn-attribution-turn-id={projection.turnId}
      data-turn-attribution-attempt-id={projection.attemptId}
    >
      <div
        className="sc-attribution__chips"
        aria-label={t('chat.message.attribution.sources')}
      >
        {groups.map((group) => {
          const meta = KIND_META.get(group.kind);
          if (!meta) return null;
          const kindLabel = t(`chat.message.attribution.kind.${meta.localeKey}`);
          // The collapsed chip stays quiet and kind-level; individual tool
          // names (which are machine identifiers) live in the expanded detail.
          const label = group.entries.length > 1
            ? t('chat.message.attribution.groupLabel', {
                kind: kindLabel,
                count: group.entries.length,
              })
            : kindLabel;
          const representativeOutcome = group.truncated ? 'truncated' : 'included';
          const outcomeLabel = t(
            `chat.message.attribution.outcome.${representativeOutcome}`,
          );
          // Single chips keep the concrete source name for assistive tech;
          // grouped chips announce kind + count with locale-correct word order.
          const chipLabel = group.entries.length > 1
            ? t('chat.message.attribution.groupBadgeLabel', {
                kind: kindLabel,
                count: group.entries.length,
                outcome: outcomeLabel,
              })
            : t('chat.message.attribution.badgeLabel', {
                kind: kindLabel,
                name: group.entries[0]?.name || kindLabel,
                outcome: outcomeLabel,
              });
          return (
            <Button
              key={`attribution-kind-${meta.localeKey}`}
              actionId={`attribution-kind.${meta.localeKey}`}
              emphasis="quiet"
              density="compact"
              className={`sc-attribution__chip${group.truncated ? ' is-warning' : ''}`}
              aria-expanded={open}
              aria-label={chipLabel}
              data-attribution-kind={meta.localeKey}
              data-attribution-count={group.entries.length}
              data-attribution-outcome={representativeOutcome}
              leading={<Icon iconId={meta.iconId} size={12} />}
              onActivate={() => setOpen((value) => !value)}
            >
              <span className="sc-attribution__chip-label">{label}</span>
            </Button>
          );
        })}
        <Button
          actionId="attribution.sources-toggle"
          emphasis="quiet"
          density="compact"
          className="sc-attribution__toggle"
          aria-expanded={open}
          leading={<Icon iconId="file-text" size={12} />}
          onActivate={() => setOpen((value) => !value)}
        >
          {t('chat.message.attribution.sources')}
          <Icon
            iconId="chevron-down"
            size={12}
            className="sc-attribution__chevron"
            style={{ transform: open ? 'rotate(180deg)' : 'none' }}
          />
        </Button>
      </div>

      {open && (
        <section
          className="sc-attribution__detail"
          aria-label={t('chat.message.attribution.details')}
        >
          <div className="sc-attribution__detail-head">
            <strong>{t('chat.message.attribution.sources')}</strong>
            <span>{t('chat.message.attribution.pinned')}</span>
          </div>
          <div className="sc-attribution__detail-list">
            {projection.entries.map((entry) => (
              <AttributionDetail
                entry={entry}
                key={entry.attributionId}
              />
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

function AttributionDetail({ entry }: { entry: TurnAttributionEntry }) {
  const { t } = useTranslation('chat');
  const meta = KIND_META.get(entry.kind);
  if (!meta) return null;
  const outcomeKey = attributionOutcomeKey(entry.outcome);
  const reasonKey = REASON_KEYS[entry.reasonCode] ?? 'unknown';
  const tone = entry.outcome === TurnAttributionOutcome.TRUNCATED
    ? 'warning'
    : entry.outcome === TurnAttributionOutcome.OMITTED
      ? 'neutral'
      : 'success';

  return (
    <div
      className="sc-attribution__row"
      data-attribution-detail-kind={meta.localeKey}
      data-attribution-detail-outcome={outcomeKey}
    >
      <span className="sc-attribution__row-icon">
        <Icon iconId={meta.iconId} size={13} />
      </span>
      <span className="sc-attribution__row-body">
        <span className="sc-attribution__row-title">
          <span className="sc-attribution__row-name">
            {entry.name
              || t(`chat.message.attribution.kind.${meta.localeKey}`)}
          </span>
          {entry.version && (
            <span className="sc-attribution__row-version">v{entry.version}</span>
          )}
        </span>
        <span className="sc-attribution__row-reason">
          {t(`chat.message.attribution.reason.${reasonKey}`)}
        </span>
      </span>
      <span className={`sc-attribution__outcome is-${tone}`}>
        {t(`chat.message.attribution.outcome.${outcomeKey}`)}
      </span>
    </div>
  );
}
