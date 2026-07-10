import { describe, expect, it } from 'vitest';
import {
  appendPrototypeProviderCapabilityCommand,
  buildPrototypeProviderCapabilityCommandIntent,
} from './prototypeProviderCapabilityCommand';

describe('buildPrototypeProviderCapabilityCommandIntent', () => {
  it('builds insert-only intents for slash commands', () => {
    expect(buildPrototypeProviderCapabilityCommandIntent({
      command: '  /implement  ',
    })).toEqual({
      status: 'insert',
      command: '/implement',
    });
  });

  it('rejects non-slash commands before mutating the draft', () => {
    expect(buildPrototypeProviderCapabilityCommandIntent({
      command: 'implement',
    })).toEqual({ status: 'invalid' });
  });

  it('rejects empty commands before mutating the draft', () => {
    expect(buildPrototypeProviderCapabilityCommandIntent({
      command: '   ',
    })).toEqual({ status: 'invalid' });
  });
});

describe('appendPrototypeProviderCapabilityCommand', () => {
  it('appends slash commands to existing draft text without sending a message', () => {
    expect(appendPrototypeProviderCapabilityCommand({
      currentDraft: 'review this patch',
      command: ' /review ',
    })).toBe('review this patch /review ');
  });

  it('starts the draft with the slash command when the draft is empty', () => {
    expect(appendPrototypeProviderCapabilityCommand({
      currentDraft: '   ',
      command: '/test',
    })).toBe('/test ');
  });
});
