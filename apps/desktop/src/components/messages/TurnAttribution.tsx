import { Tag, theme } from 'antd';
import {
  BookOpenText,
  Brain,
  ChevronDown,
  FileText,
  Paperclip,
  Sparkles,
  Wrench,
  type LucideIcon,
} from 'lucide-react';
import { useState } from 'react';
import { Flexbox } from 'react-layout-kit';
import { useTranslation } from 'react-i18next';

import {
  TurnAttributionKind,
  TurnAttributionOutcome,
  TurnAttributionState,
  type TurnAttributionEntry,
  type TurnAttributionProjection,
} from '../../gen/proto/domain/agent/agent_pb';

const KIND_META = new Map<
  TurnAttributionKind,
  { icon: LucideIcon; localeKey: string }
>([
  [TurnAttributionKind.SKILL, { icon: Sparkles, localeKey: 'skill' }],
  [TurnAttributionKind.MEMORY, { icon: Brain, localeKey: 'memory' }],
  [TurnAttributionKind.KNOWLEDGE, {
    icon: BookOpenText,
    localeKey: 'knowledge',
  }],
  [TurnAttributionKind.ATTACHMENT, {
    icon: Paperclip,
    localeKey: 'attachment',
  }],
  [TurnAttributionKind.TOOL, { icon: Wrench, localeKey: 'tool' }],
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
  const { token } = theme.useToken();
  const { t } = useTranslation('chat');
  const [open, setOpen] = useState(false);

  if (!projection) return null;
  if (projection.state === TurnAttributionState.UNAVAILABLE) {
    return (
      <span
        data-turn-attribution-state="unavailable"
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 5,
          marginTop: 8,
          color: token.colorTextTertiary,
          fontSize: 11,
        }}
      >
        <FileText size={12} />
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
      data-turn-attribution
      data-turn-attribution-turn-id={projection.turnId}
      data-turn-attribution-attempt-id={projection.attemptId}
      style={{ marginTop: 10 }}
    >
      <Flexbox
        horizontal
        align="center"
        gap={5}
        wrap="wrap"
        aria-label={t('chat.message.attribution.sources')}
      >
        {groups.map((group) => {
          const meta = KIND_META.get(group.kind);
          if (!meta) return null;
          const Icon = meta.icon;
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
            <button
              key={`attribution-kind-${meta.localeKey}`}
              type="button"
              aria-expanded={open}
              aria-label={chipLabel}
              data-attribution-kind={meta.localeKey}
              data-attribution-count={group.entries.length}
              data-attribution-outcome={representativeOutcome}
              onClick={() => setOpen((value) => !value)}
              style={{
                minHeight: 26,
                display: 'inline-flex',
                alignItems: 'center',
                gap: 5,
                border: `1px solid ${
                  group.truncated
                    ? token.colorWarningBorder
                    : token.colorBorderSecondary
                }`,
                borderRadius: token.borderRadiusSM,
                background:
                  group.truncated
                    ? token.colorWarningBg
                    : token.colorFillQuaternary,
                color:
                  group.truncated
                    ? token.colorWarningText
                    : token.colorTextSecondary,
                padding: '0 7px',
                fontSize: 11,
                fontWeight: 600,
                cursor: 'pointer',
                maxWidth: 220,
              }}
            >
              <Icon size={12} />
              <span
                style={{
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
              >
                {label}
              </span>
            </button>
          );
        })}
        <button
          type="button"
          aria-expanded={open}
          onClick={() => setOpen((value) => !value)}
          style={{
            minHeight: 26,
            display: 'inline-flex',
            alignItems: 'center',
            gap: 5,
            border: 0,
            borderRadius: token.borderRadiusSM,
            background: 'transparent',
            color: token.colorTextTertiary,
            padding: '0 6px',
            fontSize: 11,
            cursor: 'pointer',
          }}
        >
          <FileText size={12} />
          {t('chat.message.attribution.sources')}
          <ChevronDown
            size={12}
            style={{
              transform: open ? 'rotate(180deg)' : 'none',
              transition: 'transform 120ms ease',
            }}
          />
        </button>
      </Flexbox>

      {open && (
        <section
          aria-label={t('chat.message.attribution.details')}
          style={{
            marginTop: 8,
            border: `1px solid ${token.colorBorderSecondary}`,
            borderRadius: token.borderRadiusLG,
            background: token.colorFillQuaternary,
            padding: 10,
          }}
        >
          <Flexbox horizontal align="center" justify="space-between" gap={8}>
            <strong style={{ color: token.colorText, fontSize: 12.5 }}>
              {t('chat.message.attribution.sources')}
            </strong>
            <span
              style={{
                color: token.colorTextTertiary,
                fontSize: 10.5,
                whiteSpace: 'nowrap',
              }}
            >
              {t('chat.message.attribution.pinned')}
            </span>
          </Flexbox>
          <Flexbox gap={2} style={{ marginTop: 8 }}>
            {projection.entries.map((entry) => (
              <AttributionDetail
                entry={entry}
                key={entry.attributionId}
              />
            ))}
          </Flexbox>
        </section>
      )}
    </div>
  );
}

function AttributionDetail({ entry }: { entry: TurnAttributionEntry }) {
  const { token } = theme.useToken();
  const { t } = useTranslation('chat');
  const meta = KIND_META.get(entry.kind);
  if (!meta) return null;
  const Icon = meta.icon;
  const outcomeKey = attributionOutcomeKey(entry.outcome);
  const reasonKey = REASON_KEYS[entry.reasonCode] ?? 'unknown';

  return (
    <div
      data-attribution-detail-kind={meta.localeKey}
      data-attribution-detail-outcome={outcomeKey}
      style={{
        minHeight: 46,
        display: 'grid',
        gridTemplateColumns: '24px minmax(0, 1fr) auto',
        alignItems: 'center',
        gap: 8,
        padding: '5px 6px',
        borderRadius: token.borderRadiusSM,
        background: token.colorBgContainer,
      }}
    >
      <span
        style={{
          width: 24,
          height: 24,
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          borderRadius: token.borderRadiusSM,
          background: token.colorFillQuaternary,
          color: token.colorTextSecondary,
        }}
      >
        <Icon size={13} />
      </span>
      <span
        style={{
          minWidth: 0,
          display: 'flex',
          flexDirection: 'column',
          gap: 1,
        }}
      >
        <span
          style={{
            minWidth: 0,
            display: 'flex',
            alignItems: 'center',
            gap: 6,
          }}
        >
          <span
            style={{
              minWidth: 0,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
              color: token.colorText,
              fontSize: 11.5,
            }}
          >
            {entry.name
              || t(`chat.message.attribution.kind.${meta.localeKey}`)}
          </span>
          {entry.version && (
            <span
              style={{
                flexShrink: 0,
                color: token.colorTextTertiary,
                fontSize: 10.5,
              }}
            >
              v{entry.version}
            </span>
          )}
        </span>
        <span style={{ color: token.colorTextSecondary, fontSize: 10.5 }}>
          {t(`chat.message.attribution.reason.${reasonKey}`)}
        </span>
      </span>
      <Tag
        bordered={false}
        color={
          entry.outcome === TurnAttributionOutcome.TRUNCATED
            ? 'warning'
            : entry.outcome === TurnAttributionOutcome.OMITTED
              ? 'default'
              : 'success'
        }
        style={{ margin: 0, fontSize: 10.5 }}
      >
        {t(`chat.message.attribution.outcome.${outcomeKey}`)}
      </Tag>
    </div>
  );
}
