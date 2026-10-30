import { Button, Empty, theme } from 'antd';
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
  const { token } = theme.useToken();
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
        background: token.colorBgElevated,
        border: `1px solid ${token.colorBorderSecondary}`,
        borderRadius: token.borderRadius,
        boxShadow: token.boxShadowSecondary,
        padding: 4,
      }}
    >
      {candidates.length === 0 ? (
        <Empty
          image={Empty.PRESENTED_IMAGE_SIMPLE}
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
              type="text"
              block
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
                height: 'auto',
                padding: '6px 8px',
                textAlign: 'left',
                background: active ? token.colorFillQuaternary : 'transparent',
              }}
            >
              <AtSign size={13} color={token.colorTextTertiary} />
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
                    color: token.colorText,
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
                      color: token.colorTextTertiary,
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
