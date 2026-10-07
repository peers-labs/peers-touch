import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const overlaySource = readFileSync(
  new URL('../../pages/chat/ChatOverlayHost.tsx', import.meta.url),
  'utf8',
);

describe('Messaging-owned Group command feedback', () => {
  it('renders authoritative membership pending and failure convergence', () => {
    expect(overlaySource).toContain('data-group-membership-state');
    expect(overlaySource).toContain('data-group-command-state');
    expect(overlaySource).toContain('groupCommandOutcomes');
    expect(overlaySource).toContain("'mobile.recovery.command.state.pending'");
    expect(overlaySource).toContain(
      "'mobile.recovery.command.state.failed-retryable'",
    );
    expect(overlaySource).toContain('isGroupCommandBusy');
  });

  it('does not restore the retired Group store owner', () => {
    expect(overlaySource).not.toContain('useGroupStore');
    expect(overlaySource).not.toContain('useGroupMembershipOperations');
  });
});
