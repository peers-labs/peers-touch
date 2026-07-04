import { describe, expect, it } from 'vitest';
import type { Timestamp } from '@bufbuild/protobuf/wkt';

import type { GroupMember, GroupMessage } from '../gen/proto/domain/chat/group_chat_pb';
import { resolveGroupMissingSkdmPlaceholder } from './socialChat';

function ts(ms: number): Timestamp {
  return {
    $typeName: 'google.protobuf.Timestamp',
    seconds: BigInt(Math.floor(ms / 1000)),
    nanos: (ms % 1000) * 1_000_000,
  };
}

function msg(sentAtMs: number): GroupMessage {
  return {
    ulid: `msg-${sentAtMs}`,
    groupUlid: 'group-1',
    senderDid: 'did:peer:alice',
    sentAt: ts(sentAtMs),
  } as GroupMessage;
}

function member(actorDid: string, joinedAtMs: number): GroupMember {
  return {
    groupUlid: 'group-1',
    actorDid,
    joinedAt: ts(joinedAtMs),
  } as GroupMember;
}

describe('resolveGroupMissingSkdmPlaceholder', () => {
  it('keeps waiting-key when membership projection is not loaded', () => {
    expect(resolveGroupMissingSkdmPlaceholder('did:peer:self', undefined, msg(2000)))
      .toBe('[Waiting for sender key…]');
  });

  it('marks pre-join ciphertext as not available before join', () => {
    expect(resolveGroupMissingSkdmPlaceholder(
      'did:peer:self',
      [member('did:peer:self', 3000)],
      msg(2000),
    )).toBe('[Message sent before you joined]');
  });

  it('marks missing membership as not entitled instead of waiting for a key', () => {
    expect(resolveGroupMissingSkdmPlaceholder(
      'did:peer:self',
      [member('did:peer:alice', 1000)],
      msg(2000),
    )).toBe('[Not entitled to this group message]');
  });
});
