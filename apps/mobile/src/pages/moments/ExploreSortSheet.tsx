import { Button, Drawer, Icon } from '@peers-touch/ui';

import { useMobileI18n } from '../../app/mobileI18n';
import { TimelineSort } from '../../gen/proto/domain/social/post_pb';

interface ExploreSortSheetProps {
  readonly value: TimelineSort;
  readonly onChange: (sort: TimelineSort) => void;
  readonly onClose: () => void;
}

export function ExploreSortSheet({ value, onChange, onClose }: ExploreSortSheetProps) {
  const { t } = useMobileI18n();
  return <Drawer open side="bottom" title={t('mobile.moments.sort.label')}
    closeLabel={t('common.action.close')} onDismiss={onClose}>
    <div className="moments-choice-list">
      {([[TimelineSort.RECENT, 'recent'], [TimelineSort.HOT, 'hot']] as const).map(([sort, label]) => (
        <Button key={label} actionId={`moments.sort.${label}`} fullWidth density="comfortable"
          emphasis="quiet" data-acceptance-id={`social-explore-sort-${label}`}
          aria-pressed={value === sort} trailing={value === sort ? <Icon iconId="check" size={18} /> : undefined}
          onActivate={() => { onChange(sort); onClose(); }}>
          {t(`mobile.moments.sort.${label}`)}
        </Button>
      ))}
    </div>
  </Drawer>;
}
