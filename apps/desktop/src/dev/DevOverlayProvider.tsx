import type { DevSlot } from './slots';
import { getPluginsForSlot } from './registry';

import './plugins/worktree-badge';

const SLOT_STYLES: Record<DevSlot, React.CSSProperties> = {
  titleBar: {
    position: 'fixed',
    top: 4,
    right: 4,
    zIndex: 9999,
  },
  bottomLeft: {
    position: 'fixed',
    bottom: 4,
    left: 4,
    zIndex: 9998,
  },
  floating: {
    position: 'fixed',
    bottom: 40,
    right: 4,
    zIndex: 9997,
  },
};

const SLOTS: DevSlot[] = ['titleBar', 'bottomLeft', 'floating'];

export default function DevOverlayProvider() {
  return (
    <>
      {SLOTS.map((slot) => {
        const plugins = getPluginsForSlot(slot);
        if (plugins.length === 0) return null;
        return (
          <div
            key={slot}
            data-dev-slot={slot}
            style={{ ...SLOT_STYLES[slot], pointerEvents: 'none', display: 'flex', gap: 4 }}
          >
            {plugins.map((p) => (
              <p.component key={p.id} />
            ))}
          </div>
        );
      })}
    </>
  );
}
