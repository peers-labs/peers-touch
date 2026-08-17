const DRAFT_PREFIX = 'draft:';

function createNonce(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export function createAgentDraftKey(agentId: string, nonce = createNonce()): string {
  const normalizedAgentId = agentId.trim();
  if (!normalizedAgentId) throw new Error('agentId is required for an Agent draft');
  return `${DRAFT_PREFIX}${encodeURIComponent(normalizedAgentId)}:${nonce}`;
}

export function isAgentDraftKey(key: string): boolean {
  return key.startsWith(DRAFT_PREFIX) && key.slice(DRAFT_PREFIX.length).includes(':');
}

export function agentIdFromDraftKey(key: string): string | null {
  if (!isAgentDraftKey(key)) return null;
  const encodedAgentId = key.slice(DRAFT_PREFIX.length).split(':', 1)[0];
  if (!encodedAgentId) return null;
  try {
    return decodeURIComponent(encodedAgentId);
  } catch {
    return null;
  }
}
