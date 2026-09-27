import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = readFileSync(
  new URL('./CreateGroupModal.tsx', import.meta.url),
  'utf8',
);
const identityRowSource = readFileSync(
  new URL('./ChatActorIdentityRow.tsx', import.meta.url),
  'utf8',
);

describe('CreateGroupModal recovery contract', () => {
  it('keeps the dialog draft until Group preparation is accepted', () => {
    const createCall = source.indexOf(
      'const created = await messagingCommands.createGroup(',
    );
    const acceptedTracking = source.indexOf(
      'trackPendingGroupCreation(conversationId, created.commandId);',
      createCall,
    );
    const close = source.indexOf('handleClose();', acceptedTracking);

    expect(createCall).toBeGreaterThan(-1);
    expect(acceptedTracking).toBeGreaterThan(createCall);
    expect(close).toBeGreaterThan(acceptedTracking);
    expect(source.slice(createCall, acceptedTracking)).not.toContain(
      'handleClose();',
    );
    expect(source).toContain(
      'const conversationId = draftConversationId ?? crypto.randomUUID();',
    );
  });

  it('does not publish Group state before Station accepts the command', () => {
    const createCall = source.indexOf(
      'const created = await messagingCommands.createGroup(',
    );
    const acceptedState = source.indexOf(
      "setGroupSecurityState(conversationId, 'establishing')",
      createCall,
    );

    expect(createCall).toBeGreaterThan(-1);
    expect(acceptedState).toBeGreaterThan(createCall);
    expect(source.slice(0, createCall)).not.toContain(
      "setGroupSecurityState(conversationId, 'establishing')",
    );
    expect(source).not.toContain(
      "setGroupSecurityState(conversationId, 'error')",
    );
  });

  it('renders inline typed failure and retry state without clearing selection', () => {
    expect(source).toContain('data-chat-create-group-error');
    expect(source).toContain("context: { operation: 'createGroup' }");
    expect(source).toContain(
      "data-chat-create-group-retry={creationError ? 'true' : 'false'}",
    );
    expect(source).toContain('setCreationError(presentError(err, {');
  });

  it('exposes canonical identity metadata on every selectable actor', () => {
    for (const attribute of [
      'data-chat-contact-ptid',
      'data-chat-contact-federated-handle',
      'data-chat-contact-home-station-domain',
      'data-chat-contact-home-station-peer-id',
      'data-chat-contact-federation-id',
      'data-chat-contact-avatar-src',
    ]) {
      expect(source).toContain(attribute);
    }
    expect(source).toContain('<ChatActorIdentityRow');
    expect(identityRowSource).toContain('data-chat-identity-federation');
    expect(identityRowSource).toContain('data-chat-identity-station');
    expect(identityRowSource).toContain("whiteSpace: 'normal'");
    expect(identityRowSource).not.toContain(
      'ellipsis={{ tooltip: labelledMetadata }}',
    );
  });
});
