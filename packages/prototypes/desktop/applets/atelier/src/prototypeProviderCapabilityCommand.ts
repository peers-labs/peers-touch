export type PrototypeProviderCapabilityCommandIntent =
  | {
      status: 'invalid';
    }
  | {
      status: 'insert';
      command: string;
    };

export function buildPrototypeProviderCapabilityCommandIntent(input: {
  command: string;
}): PrototypeProviderCapabilityCommandIntent {
  const command = input.command.trim();
  if (!command.startsWith('/')) return { status: 'invalid' };
  return { status: 'insert', command };
}

export function appendPrototypeProviderCapabilityCommand(input: {
  currentDraft: string;
  command: string;
}): string {
  const existing = input.currentDraft.trim();
  const command = input.command.trim();
  return existing ? `${existing} ${command} ` : `${command} `;
}
