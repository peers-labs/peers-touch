import type { IconId } from '@peers-touch/ui-assets';
import { Icon, Tag, Text } from '@peers-touch/ui';
import { makeTranslate, usePrefs, type Translate } from '../../prefs';
import type { AttributionKind, AttributionState, AttributionView } from './types';

const KIND_ICON: Record<AttributionKind, IconId> = {
  skill: 'sparkles',
  profile: 'contact',
  memory: 'brain',
  knowledge: 'book-open-text',
  attachment: 'paperclip',
  tool: 'wrench',
};

const STATE_TONE: Record<AttributionState, 'neutral' | 'info' | 'warning' | 'danger'> = {
  included: 'neutral',
  truncated: 'warning',
  omitted: 'danger',
  denied: 'danger',
};

function stateText(state: AttributionState, t: Translate): string {
  switch (state) {
    case 'included': return t('agent.attribution.included');
    case 'truncated': return t('agent.attribution.truncated');
    case 'omitted': return t('agent.attribution.omitted');
    case 'denied': return t('agent.attribution.denied');
  }
}

/**
 * Turn context attribution — every adopted source (skill / profile / memory /
 * knowledge / attachment / tool) stays reviewable, mirroring the production
 * TurnAttribution contract without its proto dependency.
 */
export function TurnAttributionView({ entries }: { entries: readonly AttributionView[] }) {
  const { t } = usePrefsTranslation();
  if (entries.length === 0) return null;
  return (
    <div className="pa-attribution" aria-label={t('agent.attribution.title')}>
      {entries.map((entry) => (
        <Tag
          key={entry.id}
          tone={STATE_TONE[entry.state]}
          leading={<Icon iconId={KIND_ICON[entry.kind]} size={13} />}
        >
          <Text tone="secondary" className="pa-attribution__label">
            {entry.label} · {stateText(entry.state, t)}
          </Text>
        </Tag>
      ))}
    </div>
  );
}

function usePrefsTranslation() {
  const prefs = usePrefs();
  return { t: makeTranslate(prefs.locale) };
}
