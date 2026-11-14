import { IconButton } from '@peers-touch/ui';

interface PanelToggleDockProps {
  open: boolean;
  title: string;
  onClick: () => void;
}

/**
 * Absolute-positioned single 28px rail collapse/expand tile.
 *
 * Migrated from a raw lucide <button> + antd theme token to a peers-ui
 * IconButton: the icon ids resolve to the same lucide 0.577 glyphs through
 * @peers-touch/ui-assets, and the quiet emphasis supplies the transparent
 * hover treatment without hand-rolled colors. The outer wrapper keeps the
 * original geometry and the `data-pt-panel-toggle-dock` contract.
 */
export function PanelToggleDock({ open, title, onClick }: PanelToggleDockProps) {
  return (
    <div
      data-pt-panel-toggle-dock="left"
      style={{
        position: 'absolute',
        left: 10,
        bottom: 14,
        width: 28,
        height: 28,
        zIndex: 2,
      }}
    >
      <IconButton
        actionId="agent.panel-toggle-dock.left"
        iconId={open ? 'panel-left-close' : 'panel-left-open'}
        iconSize={15}
        label={title}
        emphasis="quiet"
        density="compact"
        style={{ width: 28, height: 28 }}
        onActivate={onClick}
      />
    </div>
  );
}
