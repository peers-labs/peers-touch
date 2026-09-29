type Invite = {
  id: string;
  expiresAt: number;
};

declare global {
  var invites: Record<string, Invite>;
}

export async function expireInvite(id: string): Promise<void> {
  const invite = globalThis.invites[id];
  if (invite && Date.now() > invite.expiresAt) {
    await fetch(`/internal/invites/${id}`, { method: 'DELETE' });
  }
}
