export type PrototypeWorkspaceSnapshotSource = 'load' | 'reload' | 'subscription';

export function buildPrototypeWorkspaceSnapshotRequestKey(input: {
  source: PrototypeWorkspaceSnapshotSource;
  sequence?: number;
}): string {
  const sequence = Number.isFinite(input.sequence) && input.sequence > 0 ? Math.trunc(input.sequence) : 0;
  return `source:${input.source}|seq:${sequence}`;
}

export function shouldApplyPrototypeWorkspaceSnapshot(input: {
  currentRequestKey: string;
  responseRequestKey: string;
}): boolean {
  return Boolean(input.responseRequestKey) && input.currentRequestKey === input.responseRequestKey;
}
