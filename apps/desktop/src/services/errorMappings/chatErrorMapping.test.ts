import { describe, expect, it, vi } from 'vitest';

import { RustCommandException } from '../desktop_api';

vi.mock('../errorPresenter', () => ({
  errorMessage: (error: unknown) => (
    error instanceof Error ? error.message : String(error)
  ),
  tError: (key: string) => key,
}));

import { mapChatError } from './chatErrorMapping';

describe('mapChatError Group creation', () => {
  it('preserves the typed unavailable-actor reason for inline recovery', () => {
    const error = new RustCommandException('messaging_create_group', {
      code: 'INTERNAL_ERROR',
      message: 'Failed to create group',
      details: {
        error_code: 'CONVERSATION_ACTOR_KEY_UNAVAILABLE',
        operation: 'application.resolve_actor_routes',
        field: 'actor',
        reason: 'actor ptid:bob has no verified active endpoint',
      },
    });

    expect(mapChatError(error, { operation: 'createGroup' })).toMatchObject({
      code: 'CONVERSATION_ACTOR_KEY_UNAVAILABLE',
      recoverable: true,
      debugMessage: 'Failed to create group',
    });
    expect(
      mapChatError(error, { operation: 'createGroup' })?.message,
    ).toContain('ptid:bob');
  });

  it('maps the inactive-Station code to a readable message without the raw reason', () => {
    const error = new RustCommandException('messaging_create_group', {
      code: 'CONFLICT',
      message: 'Failed to create group',
      details: {
        error_code: 'CONVERSATION_FEDERATION_STATION_INACTIVE',
        operation: 'application.prepare_group',
        field: 'home_station',
        reason: 'station-five is not an active Federation Station',
      },
    });

    expect(mapChatError(error, { operation: 'createGroup' })).toMatchObject({
      code: 'CONVERSATION_FEDERATION_STATION_INACTIVE',
      recoverable: true,
    });
    // The raw station reason must not leak; a stable i18n key is presented.
    const presented = mapChatError(error, { operation: 'createGroup' });
    expect(presented?.message).toBe('error.chat.federationInactive');
    expect(presented?.message).not.toContain('station-five');
  });

  it('maps the inactive-Station code for a direct send as well', () => {
    const error = new RustCommandException('messaging_send_friend', {
      code: 'CONFLICT',
      message: 'station returned 409',
      details: {
        error_code: 'CONVERSATION_FEDERATION_STATION_INACTIVE',
        reason: 'station-five is not an active Federation Station',
      },
    });

    expect(mapChatError(error, { operation: 'send' })).toMatchObject({
      code: 'CONVERSATION_FEDERATION_STATION_INACTIVE',
      message: 'error.chat.federationInactive',
    });
  });
});

describe('mapChatError send fallback', () => {
  it('appends the underlying reason so a send failure is not an opaque toast', () => {
    const error = new Error(
      'messaging Direct conversation membership projection is invalid',
    );

    const presentation = mapChatError(error, { operation: 'send' });
    expect(presentation?.code).toBe('chat.sendFailed');
    expect(presentation?.message).toContain('error.chat.sendFailed');
    // The concrete Rust-level reason must survive into the user-visible copy.
    expect(presentation?.message).toContain(
      'membership projection is invalid',
    );
    expect(presentation?.debugMessage).toBe(error.message);
  });

  it('prefers the structured station reason when present', () => {
    const error = new RustCommandException('messaging_send_message', {
      code: 'INTERNAL_ERROR',
      message: 'engine rejected send',
      details: { reason: 'not a member of this conversation' },
    });

    const presentation = mapChatError(error, { operation: 'send' });
    expect(presentation?.message).toContain(
      'not a member of this conversation',
    );
  });
});
