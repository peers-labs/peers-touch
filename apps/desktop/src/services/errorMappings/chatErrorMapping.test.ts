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

  it('preserves the typed inactive-Station reason', () => {
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
    expect(
      mapChatError(error, { operation: 'createGroup' })?.message,
    ).toContain('station-five');
  });
});
