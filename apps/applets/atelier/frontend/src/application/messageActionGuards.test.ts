import { describe, expect, it } from 'vitest';
import {
  ATELIER_MESSAGE_SEND_FORBIDDEN_ACTIONS,
  ATELIER_MESSAGE_SEND_FORBIDDEN_APPLET_FIELDS,
  ATELIER_MESSAGE_SEND_REQUIRED_FIELDS,
  buildAtelierMessageSendIntent,
  containsForbiddenAtelierMessagePayloadFields,
} from './messageActionGuards';

describe('message action guards', () => {
  it('builds trimmed text-only Station message intents', () => {
    expect(ATELIER_MESSAGE_SEND_REQUIRED_FIELDS).toEqual(['taskId', 'text']);
    expect(buildAtelierMessageSendIntent({
      taskId: ' task-1 ',
      text: ' hello Atelier ',
      pending: false,
    })).toEqual({
      status: 'ready',
      intent: {
        taskId: 'task-1',
        text: 'hello Atelier',
      },
    });
  });

  it('blocks empty task ids, empty text, and concurrent message submissions', () => {
    expect(buildAtelierMessageSendIntent({ taskId: '', text: 'hello', pending: false })).toEqual({ status: 'blocked' });
    expect(buildAtelierMessageSendIntent({ taskId: 'task-1', text: '   ', pending: false })).toEqual({ status: 'blocked' });
    expect(buildAtelierMessageSendIntent({ taskId: 'task-1', text: 'hello', pending: true })).toEqual({ status: 'blocked' });
  });

  it('rejects execution-shaped applet payload fields before service binding', () => {
    expect(ATELIER_MESSAGE_SEND_FORBIDDEN_APPLET_FIELDS).toEqual(['run', 'attachments', 'inputSnapshot', 'input_snapshot']);
    expect(containsForbiddenAtelierMessagePayloadFields({ attachments: [] })).toBe(true);
    expect(containsForbiddenAtelierMessagePayloadFields({ input_snapshot: { prompt: 'hidden' } })).toBe(true);
    expect(buildAtelierMessageSendIntent({
      taskId: 'task-1',
      text: 'hello',
      pending: false,
      extraPayload: { run: { provider: 'codex' } },
    })).toEqual({ status: 'invalid' });
  });

  it('keeps forbidden execution actions as contract metadata, not applet intent fields', () => {
    expect(ATELIER_MESSAGE_SEND_FORBIDDEN_ACTIONS).toEqual(expect.arrayContaining([
      'provider.invoke',
      'runtime.execute',
      'model.run',
      'input_snapshot.write',
      'HostStorage.write',
    ]));
    expect(buildAtelierMessageSendIntent({
      taskId: 'task-1',
      text: '/run tests as a user-visible instruction',
      pending: false,
    })).toEqual({
      status: 'ready',
      intent: {
        taskId: 'task-1',
        text: '/run tests as a user-visible instruction',
      },
    });
  });
});
