import { Check } from 'lucide-react';

import { useMobileI18n } from '../../app/mobileI18n';
import { TimelineSort } from '../../gen/proto/domain/social/post_pb';

interface ExploreSortSheetProps {
  readonly value: TimelineSort;
  readonly onChange: (sort: TimelineSort) => void;
  readonly onClose: () => void;
}

export function ExploreSortSheet({
  value,
  onChange,
  onClose,
}: ExploreSortSheetProps) {
  const { t } = useMobileI18n();

  return (
    <div
      className="moments-sheet-backdrop moments-sort-backdrop"
      role="presentation"
      onPointerDown={onClose}
    >
      <section
        className="moments-bottom-sheet moments-sort-sheet"
        role="dialog"
        aria-modal="true"
        aria-label={t('mobile.moments.sort.label')}
        onPointerDown={(event) => event.stopPropagation()}
      >
        <div className="moments-sheet-handle" />
        <header className="moments-sheet-header">
          <span />
          <h2>{t('mobile.moments.sort.label')}</h2>
          <span />
        </header>
        <div className="moments-choice-list">
          {(
            [
              [TimelineSort.RECENT, 'recent'],
              [TimelineSort.HOT, 'hot'],
            ] as const
          ).map(([sort, label]) => (
            <button
              key={label}
              type="button"
              data-acceptance-id={`social-explore-sort-${label}`}
              onClick={() => {
                onChange(sort);
                onClose();
              }}
            >
              <span>
                <strong>{t(`mobile.moments.sort.${label}`)}</strong>
              </span>
              {value === sort ? <Check size={18} /> : null}
            </button>
          ))}
        </div>
      </section>
    </div>
  );
}
