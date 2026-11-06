/**
 * SelfCardPopover — floating identity card opened from the rail avatar.
 *
 * Contract: the rail tile NEVER navigates to a profile page; one click opens
 * this small floating card (Popover, outside-click/Escape dismissed) with the
 * canonical identity geometry — cover banner, avatar overlapping its lower
 * edge with a card-colored ring, handle/station, stats, join date — and one
 * action: manage account (routes into Settings › General › Account).
 */
import { Globe } from 'lucide-react';
import { Button, Popover } from '@peers-touch/ui';

const STATS: { value: number; label: string }[] = [
  { value: 12, label: '动态' },
  { value: 86, label: '关注' },
  { value: 104, label: '粉丝' },
];

export function SelfCardPopover({
  open, onOpenChange, onManageAccount, children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onManageAccount: () => void;
  children: React.ReactElement;
}) {
  return (
    <Popover open={open} onOpenChange={onOpenChange} placement="right" label="我的资料"
      className="sk-self-card-popover"
      content={(
        <div className="sk-self-card" data-self-card>
          <div className="sk-self-card-banner" />
          <div className="sk-self-card-body">
            <div className="sk-self-card-avatar">林</div>
            <div className="sk-self-card-name">林野</div>
            <div className="sk-self-card-handle">@linye · 松绿书屋站</div>
            <div className="sk-self-card-stats">
              {STATS.map(stat => (
                <span className="sk-self-card-stat" key={stat.label}>
                  <strong>{stat.value}</strong>
                  {stat.label}
                </span>
              ))}
            </div>
            <div className="sk-self-card-joined">2025-10 加入</div>
            <Button actionId="rail.self.manage" data-self-card-manage
              fullWidth emphasis="secondary" density="compact"
              leading={<Globe size={15} />} label="管理账号"
              onActivate={() => { onOpenChange(false); onManageAccount(); }} />
          </div>
        </div>
      )}>
      {children}
    </Popover>
  );
}
