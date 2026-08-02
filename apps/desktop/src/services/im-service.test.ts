import { describe, expect, it } from 'vitest'

import { normalizeConversationEvents } from './im-service'

describe('normalizeConversationEvents', () => {
  it('decodes Station Go oneof and timestamp JSON', () => {
    const [event] = normalizeConversationEvents([{
      event_id: 'event-1',
      conversation_id: 'conversation-1',
      group_seq: 7,
      membership_epoch: 2,
      committed_by_station_peer_id: 'station-1',
      committed_at: { seconds: 1_785_634_845, nanos: 250_000_000 },
      Payload: {
        MessageCommitted: {
          message_id: 'message-1',
          sender_ptid: 'alice',
          sender_device_id: 'desktop',
          encrypted_payload: 'AQID',
          content_type: 1,
        },
      },
    }])

    expect(event.groupSeq).toBe(7n)
    expect(event.membershipEpoch).toBe(2n)
    expect(event.committedAt?.seconds).toBe(1_785_634_845n)
    expect(event.payload.case).toBe('messageCommitted')
    if (event.payload.case !== 'messageCommitted') throw new Error('unexpected payload')
    expect(event.payload.value.encryptedPayload).toEqual(new Uint8Array([1, 2, 3]))
  })
})
