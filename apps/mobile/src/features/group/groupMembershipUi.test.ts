import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const overlaySource = readFileSync(
  new URL('../../pages/chat/ChatOverlayHost.tsx', import.meta.url),
  'utf8',
);

describe('Group membership confirmation UI', () => {
  it('confirms both add and remove before dispatch', () => {
    const start = overlaySource.indexOf('const confirmMembershipOperation');
    const end = overlaySource.indexOf('\\n\\n  return (', start);
    const confirmationSource = overlaySource.slice(start, end);

    expect(confirmationSource).toContain('Modal.confirm');
    expect(confirmationSource).toContain("action === 'add'");
    expect(confirmationSource).toContain("'mobile.group.invite'");
    expect(confirmationSource).toContain("'mobile.group.removeMember'");
    expect(overlaySource).toMatch(/confirmMembershipOperation\(\s*'remove'/);
    expect(overlaySource).toMatch(/confirmMembershipOperation\(\s*'add'/);
  });

  it('renders pending and failed state from the runtime-owned operation projection', () => {
    expect(overlaySource).toContain('useGroupMembershipOperations');
    expect(overlaySource).toContain('data-group-membership-state');
    expect(overlaySource).toContain("'mobile.recovery.command.state.pending'");
    expect(overlaySource).toContain("'mobile.recovery.command.state.failed-retryable'");
    expect(overlaySource).toContain("membershipOperation?.phase === 'pending'");
  });
});
