import { Button, Empty } from '@peers-touch/ui';
import { AtSign } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { SocialMentionCandidate } from './socialMentionModel';

interface SocialMentionPopoverProps {
  open: boolean;
  candidates: SocialMentionCandidate[];
  activeIndex: number;
  onHover: (index: number) => void;
  onPick: (candidate: SocialMentionCandidate) => void;
}

// Human-actor mention picker for the Social comment composer.
// Keyboard navigation is owned by the textarea controller; this
// component renders the candidate list and reports hover/click.
export function SocialMentionPopover({
  open,
  candidates,
  activeIndex,
  onHover,
  onPick,
}: SocialMentionPopoverProps) {
  const { t } = useTranslation('moments');
  if (!open) return null;

  return (
    <div
      data-moments-mention-popover
      style={{
        position: 'absolute',
        left: 8,
        right: 8,
        top: 'calc(100% + 4px)',
        zIndex: 20,
        maxHeight: 220,
        overflowY: 'auto',
        background: 'var(--pt-raised)',
        border: '1px solid var(--pt-border)',
        borderRadius: 'var(--pt-radius-md)',
        boxShadow: 'var(--pt-shadow-float)',
        padding: 4,
      }}
    >
      {candidates.length === 0 ? (
        <Empty
          description={t('moments.comment.mentionNoMatch')}
          style={{ margin: '8px 0' }}
        />
      ) : (
        candidates.map((candidate, index) => {
          const active = index === activeIndex;
          const secondary = candidate.label
            || candidate.username
            || '';
          return (
            <Button
              key={candidate.actorPtid}
              actionId={`moments.mention.${candidate.actorPtid}`}
              emphasis="quiet"
              fullWidth
              data-moments-mention-index={index}
              onMouseEnter={() => onHover(index)}
              onClick={(event) => {
                event.preventDefault();
                onPick(candidate);
              }}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                textAlign: 'left',
              }}
              aria-current={active || undefined}
            >
              <AtSign size={13} color="var(--pt-muted)" />
              <span
                style={{
                  minWidth: 0,
                  flex: 1,
                  display: 'flex',
                  flexDirection: 'column',
                }}
              >
                <span
                  style={{
                    fontSize: 13,
                    fontWeight: active ? 600 : 400,
                    color: 'var(--pt-text)',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {candidate.displayName}
                </span>
                {secondary && (
                  <span
                    style={{
                      fontSize: 11,
                      color: 'var(--pt-muted)',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {secondary}
                  </span>
                )}
              </span>
            </Button>
          );
        })
      )}
    </div>
  );
}
