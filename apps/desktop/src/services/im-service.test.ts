import { beforeEach, describe, expect, it, vi } from 'vitest'
import { create, fromBinary, toBinary } from '@bufbuild/protobuf'

const invokeMock = vi.hoisted(() => vi.fn())

vi.mock('@tauri-apps/api/core', () => ({ invoke: invokeMock }))

import { imServiceV1, normalizeConversationEvents } from './im-service'
import {
  CommittedConversationEventSchema,
  ConversationCommandSchema,
  MembershipTransitionAction,
  MembershipTransitionCommittedEventSchema,
} from '../gen/proto/domain/chat/conversation_pb'

beforeEach(() => {
  invokeMock.mockReset()
})

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
          device_payloads: [{
            recipient_ptid: 'bob',
            recipient_device_id: 'mobile',
            session_id: 'session-1',
            encrypted_envelope: 'AQID',
          }],
          content_type: 1,
        },
      },
    }])

    expect(event.groupSeq).toBe(7n)
    expect(event.membershipEpoch).toBe(2n)
    expect(event.committedAt?.seconds).toBe(1_785_634_845n)
    expect(event.payload.case).toBe('messageCommitted')
    if (event.payload.case !== 'messageCommitted') throw new Error('unexpected payload')
    expect(event.payload.value.devicePayloads).toHaveLength(1)
    expect(event.payload.value.devicePayloads[0]?.encryptedEnvelope)
      .toEqual(new Uint8Array([1, 2, 3]))
  })

  it('decodes canonical membership transition evidence', () => {
    const [event] = normalizeConversationEvents([{
      event_id: 'event-transition-1',
      conversation_id: 'conversation-1',
      group_seq: 2,
      membership_epoch: 1,
      committed_by_station_peer_id: 'station-1',
      event_hash: 'AQID',
      Payload: {
        MembershipTransitionCommitted: {
          transition_id: 'transition-1',
          from_membership_epoch: 0,
          to_membership_epoch: 1,
          from_mls_epoch: 0,
          to_mls_epoch: 1,
          opaque_mls_commit_bytes: 'BAUG',
          commit_sha256: 'BwgJ',
          changes: [{
            ptid: 'alice',
            actor_home_station_peer_id: 'station-1',
            action: 1,
            role: 3,
            device_id: 'alice-device',
          }],
          welcome_descriptors: [],
        },
      },
    }])

    expect(event.payload.case).toBe('membershipTransitionCommitted')
    if (event.payload.case !== 'membershipTransitionCommitted') {
      throw new Error('unexpected payload')
    }
    expect(event.payload.value.transitionId).toBe('transition-1')
    expect(event.payload.value.toMlsEpoch).toBe(1n)
    expect(event.payload.value.opaqueMlsCommitBytes).toEqual(new Uint8Array([4, 5, 6]))
  })
})

describe('conversation command submission', () => {
  it('normalizes the committed Go event before returning it', async () => {
    invokeMock.mockImplementation(async (command: string) => {
      if (command === 'conversation_list') {
        return {
          ok: true,
          data: {
            conversations: [{
              conversation_id: 'conversation-1',
              authority_station_peer_id: 'station-1',
              federation_id: 'federation-1',
            }],
          },
        }
      }
      if (command === 'conversation_get_members') {
        return {
          ok: true,
          data: {
            members: [{
              ptid: 'alice',
              actor_home_station_peer_id: 'station-1',
            }],
          },
        }
      }
      if (command === 'conversation_submit_command') {
        return {
          ok: true,
          data: {
            event: {
              event_id: 'event-message-1',
              conversation_id: 'conversation-1',
              group_seq: 3,
              membership_epoch: 1,
              event_hash: 'AQID',
              prev_event_hash: 'BAUG',
              Payload: {
                MessageCommitted: {
                  message_id: 'message-1',
                  sender_ptid: 'alice',
                  sender_device_id: 'desktop',
                  group_encrypted_payload: 'BwgJ',
                  content_type: 1,
                },
              },
            },
          },
        }
      }
      throw new Error(`unexpected command: ${command}`)
    })

    const event = await imServiceV1.conversation.submitCommand({
      conversation_id: 'conversation-1',
      sender_ptid: 'alice',
      sender_device_id: 'desktop',
      send_message: {
        group_encrypted_payload: 'BwgJ',
        content_type: 1,
      },
    } as any)

    expect(event.payload.case).toBe('messageCommitted')
    expect(event.eventHash).toEqual(new Uint8Array([1, 2, 3]))
    expect(event.prevEventHash).toEqual(new Uint8Array([4, 5, 6]))
  })
})

describe('authorized MLS group creation', () => {
  function installGenesisResponses(transitionId = 'transition-1') {
    let acceptedTransition: Record<string, any> | undefined
    invokeMock.mockImplementation(async (command: string, payload: {
      input?: Record<string, any>
    }) => {
      if (command === 'mls_group_create') {
        return {
          ok: true,
          data: {
            group_id: 'conversation-1',
            transition_id: 'transition-1',
            from_mls_epoch: 0,
            to_mls_epoch: 1,
            commit_bytes: [4, 5, 6],
            commit_sha256: [7, 8, 9],
            welcome_bytes: [10, 11, 12],
          },
        }
      }
      if (command === 'conversation_create_group') {
        const transition = payload.input?.genesis_transition as Record<string, any>
        acceptedTransition = transition
        return {
          ok: true,
          data: {
            conversation: {
              conversation_id: 'conversation-1',
              kind: 2,
              authority_station_peer_id: 'station-1',
              membership_epoch: 1,
              mls_epoch: 1,
            },
            transition_event: {
              event_id: 'event-transition-1',
              conversation_id: 'conversation-1',
              group_seq: 2,
              membership_epoch: 1,
              committed_by_station_peer_id: 'station-1',
              Payload: {
                MembershipTransitionCommitted: {
                  transition_id: transitionId,
                  from_membership_epoch: transition.from_membership_epoch,
                  to_membership_epoch: 1,
                  from_mls_epoch: transition.from_mls_epoch,
                  to_mls_epoch: transition.to_mls_epoch,
                  changes: transition.changes,
                  opaque_mls_commit_bytes: transition.opaque_mls_commit_bytes,
                  commit_sha256: transition.commit_sha256,
                  welcome_descriptors: transition.welcome_deliveries.map(
                    (delivery: Record<string, any>) => ({
                      recipient_ptid: delivery.recipient_ptid,
                      recipient_device_id: delivery.recipient_device_id,
                      recipient_home_station_peer_id: delivery.recipient_home_station_peer_id,
                      welcome_sha256: delivery.welcome_sha256,
                    }),
                  ),
                },
              },
            },
          },
        }
      }
      if (command === 'mls_group_accept_pending') {
        return { ok: true, data: { accepted: true } }
      }
      if (command === 'conversation_list_events') {
        return {
          ok: true,
          data: {
            events: [{
              event_id: 'event-created-1',
              conversation_id: 'conversation-1',
              group_seq: 1,
              membership_epoch: 0,
              committed_by_station_peer_id: 'station-1',
              event_hash: 'AQID',
              Payload: {
                ConversationCreated: {
                  conversation: {
                    conversation_id: 'conversation-1',
                    kind: 2,
                  },
                },
              },
            }, {
              event_id: 'event-transition-1',
              conversation_id: 'conversation-1',
              group_seq: 2,
              membership_epoch: 1,
              committed_by_station_peer_id: 'station-1',
              event_hash: 'BAUG',
              prev_event_hash: 'AQID',
              Payload: {
                MembershipTransitionCommitted: {
                  transition_id: transitionId,
                  from_membership_epoch: 0,
                  to_membership_epoch: 1,
                  from_mls_epoch: 0,
                  to_mls_epoch: 1,
                  changes: acceptedTransition?.changes ?? [],
                  opaque_mls_commit_bytes: acceptedTransition?.opaque_mls_commit_bytes,
                  commit_sha256: acceptedTransition?.commit_sha256,
                  welcome_descriptors: [],
                },
              },
            }],
          },
        }
      }
      if (command === 'mls_recipient_record_authority_event') {
        return {
          ok: true,
          data: { status: 'active', applied: 1, duplicate: false, buffered: 0 },
        }
      }
      throw new Error(`unexpected command: ${command}`)
    })
  }

  it('accepts pending genesis only after exact authority evidence', async () => {
    installGenesisResponses()

    await imServiceV1.mlsGroup.createAuthorizedGroup({
      conversationId: 'conversation-1',
      name: 'Test group',
      ownerPtid: 'alice',
      ownerDeviceId: 'alice-device',
      ownerHomeStationPeerId: 'station-1',
      members: [{
        ptid: 'bob',
        deviceId: 'bob-device',
        homeStationPeerId: 'station-1',
        keyPackage: new Uint8Array([1, 2, 3]),
      }],
    })

    expect(invokeMock.mock.calls.map(call => call[0])).toEqual([
      'mls_group_create',
      'conversation_create_group',
      'mls_group_accept_pending',
      'conversation_list_events',
      'mls_recipient_record_authority_event',
      'mls_recipient_record_authority_event',
    ])
    expect(invokeMock.mock.calls[0][1].input.members).toEqual([{
      ptid: 'bob',
      device_id: 'bob-device',
      key_package: [1, 2, 3],
    }])
  })

  it('does not merge when authority returns a different transition', async () => {
    installGenesisResponses('different-transition')

    await expect(imServiceV1.mlsGroup.createAuthorizedGroup({
      conversationId: 'conversation-1',
      name: 'Test group',
      ownerPtid: 'alice',
      ownerDeviceId: 'alice-device',
      ownerHomeStationPeerId: 'station-1',
      members: [{
        ptid: 'bob',
        deviceId: 'bob-device',
        homeStationPeerId: 'station-1',
        keyPackage: new Uint8Array([1, 2, 3]),
      }],
    })).rejects.toThrow('different MLS transition evidence')

    expect(invokeMock.mock.calls.map(call => call[0])).toEqual([
      'mls_group_create',
      'conversation_create_group',
    ])
  })

  it('represents a second leaf for one PTID as ADD_DEVICE', async () => {
    installGenesisResponses()

    await imServiceV1.mlsGroup.createAuthorizedGroup({
      conversationId: 'conversation-1',
      name: 'Test group',
      ownerPtid: 'alice',
      ownerDeviceId: 'alice-device',
      ownerHomeStationPeerId: 'station-1',
      members: [{
        ptid: 'bob',
        deviceId: 'bob-device-1',
        homeStationPeerId: 'station-1',
        keyPackage: new Uint8Array([1]),
      }, {
        ptid: 'bob',
        deviceId: 'bob-device-2',
        homeStationPeerId: 'station-1',
        keyPackage: new Uint8Array([2]),
      }],
    })

    const transition = invokeMock.mock.calls[1][1].input.genesis_transition
    expect(transition.changes.map((change: Record<string, any>) => ({
      ptid: change.ptid,
      deviceId: change.device_id,
      action: change.action,
    }))).toEqual([
      { ptid: 'alice', deviceId: 'alice-device', action: MembershipTransitionAction.ADD },
      { ptid: 'bob', deviceId: 'bob-device-1', action: MembershipTransitionAction.ADD },
      { ptid: 'bob', deviceId: 'bob-device-2', action: MembershipTransitionAction.ADD_DEVICE },
    ])
  })

  it('discards pending state after definitive authority rejection', async () => {
    invokeMock
      .mockResolvedValueOnce({
        ok: true,
        data: {
          group_id: 'conversation-1',
          transition_id: 'transition-1',
          from_mls_epoch: 0,
          to_mls_epoch: 1,
          commit_bytes: [4, 5, 6],
          commit_sha256: [7, 8, 9],
          welcome_bytes: [10, 11, 12],
        },
      })
      .mockResolvedValueOnce({
        ok: false,
        error: { code: 'CONFLICT', message: 'stale membership epoch' },
      })
      .mockResolvedValueOnce({
        ok: true,
        data: { discarded: true },
      })

    await expect(imServiceV1.mlsGroup.createAuthorizedGroup({
      conversationId: 'conversation-1',
      name: 'Test group',
      ownerPtid: 'alice',
      ownerDeviceId: 'alice-device',
      ownerHomeStationPeerId: 'station-1',
      members: [{
        ptid: 'bob',
        deviceId: 'bob-device',
        homeStationPeerId: 'station-1',
        keyPackage: new Uint8Array([1, 2, 3]),
      }],
    })).rejects.toThrow('stale membership epoch')

    expect(invokeMock.mock.calls.map(call => call[0])).toEqual([
      'mls_group_create',
      'conversation_create_group',
      'mls_group_discard_pending',
    ])
  })
})

describe('authorized MLS device and leave transitions', () => {
  function installTransitionResponses(lowLevelCommand: string) {
    invokeMock.mockImplementation(async (command: string, payload: {
      input?: Record<string, any>
    }) => {
      if (command === lowLevelCommand) {
        return {
          ok: true,
          data: {
            transition_id: 'transition-2',
            from_mls_epoch: 1,
            to_mls_epoch: 2,
            commit_bytes: [4, 5, 6],
            commit_sha256: [7, 8, 9],
            welcome_bytes: [],
          },
        }
      }
      if (command === 'conversation_list') {
        return {
          ok: true,
          data: {
            conversations: [{
              conversation_id: 'conversation-1',
              kind: 2,
              federation_id: 'federation-1',
              authority_station_peer_id: 'station-1',
              authority_epoch: 1,
              membership_epoch: 1,
              mls_epoch: 1,
            }],
          },
        }
      }
      if (command === 'conversation_get_members') {
        return {
          ok: true,
          data: {
            members: [{
              conversation_id: 'conversation-1',
              ptid: 'alice',
              role: 3,
              member_status: 1,
              actor_home_station_peer_id: 'station-1',
            }],
          },
        }
      }
      if (command === 'conversation_submit_command') {
        const transition = (
          payload.input?.command?.membership_transition
          ?? payload.input?.command?.membershipTransition
        ) as Record<string, any>
        return {
          ok: true,
          data: {
            event: {
              event_id: 'event-transition-2',
              conversation_id: 'conversation-1',
              group_seq: 3,
              membership_epoch: 2,
              Payload: {
                MembershipTransitionCommitted: {
                  transition_id: transition.transition_id,
                  from_membership_epoch: transition.from_membership_epoch,
                  to_membership_epoch: 2,
                  from_mls_epoch: transition.from_mls_epoch,
                  to_mls_epoch: transition.to_mls_epoch,
                  changes: transition.changes,
                  opaque_mls_commit_bytes: transition.opaque_mls_commit_bytes,
                  commit_sha256: transition.commit_sha256,
                  leave_intent_id: transition.leave_intent_id ?? '',
                  welcome_descriptors: (transition.welcome_deliveries ?? []).map(
                    (delivery: Record<string, any>) => ({
                      recipient_ptid: delivery.recipient_ptid,
                      recipient_device_id: delivery.recipient_device_id,
                      recipient_home_station_peer_id: delivery.recipient_home_station_peer_id,
                      welcome_sha256: delivery.welcome_sha256,
                    }),
                  ),
                },
              },
            },
          },
        }
      }
      if (command === 'mls_group_accept_pending') {
        return { ok: true, data: { accepted: true } }
      }
      if (command === 'mls_recipient_record_authority_event') {
        return {
          ok: true,
          data: { status: 'active', applied: 1, duplicate: false, buffered: 0 },
        }
      }
      throw new Error(`unexpected command: ${command}`)
    })
  }

  it('binds REMOVE_DEVICE to exactly one actor device', async () => {
    installTransitionResponses('mls_group_remove_device')

    await imServiceV1.mlsGroup.removeAuthorizedDevice({
      conversationId: 'conversation-1',
      senderPtid: 'alice',
      senderDeviceId: 'alice-device',
      observedMembershipEpoch: 1,
      memberPtid: 'bob',
      memberDeviceId: 'bob-device-1',
    })

    expect(invokeMock.mock.calls[0][1].input).toEqual({
      conversation_id: 'conversation-1',
      member_ptid: 'bob',
      device_id: 'bob-device-1',
    })
    const transition = invokeMock.mock.calls[3][1].input.command.membership_transition
    expect(transition.changes).toEqual([expect.objectContaining({
      ptid: 'bob',
      action: MembershipTransitionAction.REMOVE_DEVICE,
      device_id: 'bob-device-1',
    })])
    expect(invokeMock.mock.calls.map(call => call[0])).toEqual([
      'mls_group_remove_device',
      'conversation_list',
      'conversation_get_members',
      'conversation_submit_command',
      'mls_group_accept_pending',
      'mls_recipient_record_authority_event',
    ])
  })

  it('binds ADD_DEVICE and its Welcome to the same actor device', async () => {
    installTransitionResponses('mls_group_add_member')

    await imServiceV1.mlsGroup.addAuthorizedDevice({
      conversationId: 'conversation-1',
      senderPtid: 'alice',
      senderDeviceId: 'alice-device',
      observedMembershipEpoch: 1,
      member: {
        ptid: 'bob',
        deviceId: 'bob-device-2',
        homeStationPeerId: 'station-2',
        keyPackage: new Uint8Array([1, 2, 3]),
      },
    })

    expect(invokeMock.mock.calls[0][1].input.member).toEqual({
      ptid: 'bob',
      device_id: 'bob-device-2',
      key_package: [1, 2, 3],
    })
    const transition = invokeMock.mock.calls[3][1].input.command.membership_transition
    expect(transition.changes[0]).toMatchObject({
      ptid: 'bob',
      action: MembershipTransitionAction.ADD_DEVICE,
      device_id: 'bob-device-2',
    })
    expect(transition.welcome_deliveries[0]).toMatchObject({
      recipient_ptid: 'bob',
      recipient_device_id: 'bob-device-2',
      recipient_home_station_peer_id: 'station-2',
    })
  })

  it('commits LEAVE with a different active device and exact intent proof', async () => {
    installTransitionResponses('mls_group_remove_member')

    await imServiceV1.mlsGroup.commitAuthorizedLeave({
      conversationId: 'conversation-1',
      senderPtid: 'alice',
      senderDeviceId: 'alice-device',
      observedMembershipEpoch: 1,
      intent: {
        version: 1,
        intentId: 'leave-intent-bob',
        federationId: 'federation-1',
        authorityStationPeerId: 'station-1',
        authorityEpoch: 1,
        homeStationPeerId: 'station-2',
        conversationId: 'conversation-1',
        actorPtid: 'bob',
        actorDeviceId: 'bob-device',
        actorSigningKeyId: 'bob-key',
        observedMembershipEpoch: 1,
        observedMlsEpoch: 1,
        createdAtUnixMs: 1_800_000_000_000,
        expiresAtUnixMs: 1_800_000_300_000,
        actorSignature: new Uint8Array([1, 2, 3]),
      },
    })

    expect(invokeMock.mock.calls[0][1].input).toEqual({
      conversation_id: 'conversation-1',
      member_ptid: 'bob',
    })
    const transition = invokeMock.mock.calls[3][1].input.command.membership_transition
    expect(transition.leave_intent_id).toBe('leave-intent-bob')
    expect(transition.changes[0]).toMatchObject({
      ptid: 'bob',
      action: MembershipTransitionAction.LEAVE,
    })
  })

  it('routes a remote-authority transition through the signed Rust command', async () => {
    invokeMock.mockImplementation(async (command: string, payload: {
      input?: Record<string, unknown>
    }) => {
      if (command === 'mls_group_remove_device') {
        return {
          ok: true,
          data: {
            transition_id: 'transition-remote',
            from_mls_epoch: 1,
            to_mls_epoch: 2,
            commit_bytes: [4, 5, 6],
            commit_sha256: [7, 8, 9],
            welcome_bytes: [],
          },
        }
      }
      if (command === 'conversation_list') {
        return {
          ok: true,
          data: {
            conversations: [{
              conversation_id: 'conversation-1',
              kind: 2,
              federation_id: 'federation-1',
              authority_station_peer_id: 'station-1',
              authority_epoch: 4,
              membership_epoch: 1,
              mls_epoch: 1,
            }],
          },
        }
      }
      if (command === 'conversation_get_members') {
        return {
          ok: true,
          data: {
            members: [{
              conversation_id: 'conversation-1',
              ptid: 'alice',
              role: 2,
              member_status: 1,
              actor_home_station_peer_id: 'station-2',
            }],
          },
        }
      }
      if (command === 'conversation_submit_command_proposal') {
        const commandBytes = new Uint8Array(
          payload.input?.command_bytes as number[],
        )
        const decoded = fromBinary(ConversationCommandSchema, commandBytes)
        if (decoded.payload.case !== 'membershipTransition') {
          throw new Error('missing membership transition')
        }
        const transition = decoded.payload.value
        const committed = create(MembershipTransitionCommittedEventSchema, {
          transitionId: transition.transitionId,
          fromMembershipEpoch: transition.fromMembershipEpoch,
          toMembershipEpoch: transition.fromMembershipEpoch + 1n,
          fromMlsEpoch: transition.fromMlsEpoch,
          toMlsEpoch: transition.toMlsEpoch,
          changes: transition.changes,
          opaqueMlsCommitBytes: transition.opaqueMlsCommitBytes,
          commitSha256: transition.commitSha256,
        })
        const event = create(CommittedConversationEventSchema, {
          eventId: 'event-remote',
          conversationId: decoded.conversationId,
          groupSeq: 3n,
          membershipEpoch: 2n,
          payload: {
            case: 'membershipTransitionCommitted',
            value: committed,
          },
        })
        return {
          ok: true,
          data: {
            conversation_id: decoded.conversationId,
            command_id: decoded.commandId,
            state: 4,
            accepted: true,
            terminal_rejected: false,
            retryable: false,
            reject_code: 0,
            event_bytes: Array.from(
              toBinary(CommittedConversationEventSchema, event),
            ),
          },
        }
      }
      if (command === 'mls_group_accept_pending') {
        return { ok: true, data: { accepted: true } }
      }
      if (command === 'mls_recipient_record_authority_event') {
        return {
          ok: true,
          data: { status: 'active', applied: 1, duplicate: false, buffered: 0 },
        }
      }
      throw new Error(`unexpected command: ${command}`)
    })

    await imServiceV1.mlsGroup.removeAuthorizedDevice({
      conversationId: 'conversation-1',
      senderPtid: 'alice',
      senderDeviceId: 'alice-device',
      observedMembershipEpoch: 1,
      memberPtid: 'bob',
      memberDeviceId: 'bob-device',
    })

    expect(invokeMock.mock.calls.map(call => call[0])).toEqual([
      'mls_group_remove_device',
      'conversation_list',
      'conversation_get_members',
      'conversation_submit_command_proposal',
      'mls_group_accept_pending',
      'mls_recipient_record_authority_event',
    ])
    expect(invokeMock.mock.calls[3][1].input).toMatchObject({
      federation_id: 'federation-1',
      authority_station_peer_id: 'station-1',
      authority_epoch: 4,
      home_station_peer_id: 'station-2',
    })
  })

})

describe('recipient MLS runtime boundary', () => {
  it('forwards canonical bytes and normalizes durable status', async () => {
    invokeMock
      .mockResolvedValueOnce({
        ok: true,
        data: { status: 'establishing', applied: 0, duplicate: false, buffered: 2 },
      })
      .mockResolvedValueOnce({
        ok: true,
        data: {
          status: 'crypto_desynced',
          group_seq: 7,
          membership_epoch: 3,
          mls_epoch: 3,
          buffered: 1,
          last_error: 'fork',
        },
      })

    const recorded = await imServiceV1.mlsGroup.recordAuthorityEvent(
      new Uint8Array([1, 2, 3]),
      'device-1',
    )
    expect(recorded).toEqual({
      status: 'establishing',
      applied: 0,
      duplicate: false,
      buffered: 2,
    })
    expect(invokeMock.mock.calls[0]).toEqual([
      'mls_recipient_record_authority_event',
      {
        input: {
          event_bytes: [1, 2, 3],
          recipient_device_id: 'device-1',
        },
      },
    ])

    const status = await imServiceV1.mlsGroup.recipientStatus('conversation-1')
    expect(status).toEqual({
      status: 'crypto_desynced',
      groupSeq: 7,
      membershipEpoch: 3,
      mlsEpoch: 3,
      buffered: 1,
      lastError: 'fork',
    })
  })

  it('normalizes the public OpenMLS head without private state', async () => {
    invokeMock.mockResolvedValueOnce({
      ok: true,
      data: {
        conversation_id: 'conversation-1',
        mls_epoch: 4,
        group_context_sha256: 'context-hash',
        ratchet_tree_sha256: 'tree-hash',
        member_credentials_sha256: 'credential-hash',
        members: [
          { ptid: 'ptid:test:alice', device_id: 'alice-device' },
          { ptid: 'ptid:test:bob', device_id: 'bob-device' },
        ],
      },
    })

    const head = await imServiceV1.mlsGroup.publicHead('conversation-1')

    expect(head).toEqual({
      conversationId: 'conversation-1',
      mlsEpoch: 4,
      groupContextSha256: 'context-hash',
      ratchetTreeSha256: 'tree-hash',
      memberCredentialsSha256: 'credential-hash',
      members: [
        { ptid: 'ptid:test:alice', deviceId: 'alice-device' },
        { ptid: 'ptid:test:bob', deviceId: 'bob-device' },
      ],
    })
    expect(invokeMock).toHaveBeenCalledWith('mls_group_public_head', {
      input: { conversation_id: 'conversation-1' },
    })
  })
})

describe('Messaging conversation projection', () => {
  it('retains the authority Station identity from the Rust projection', async () => {
    invokeMock.mockResolvedValueOnce({
      ok: true,
      data: {
        conversations: [{
          conversation_id: 'conversation-1',
          authority_station_id: 'station-authority',
          kind: 2,
          name: 'Group',
          owner_ptid: 'ptid:test:alice',
          members: [
            {
              conversation_id: 'conversation-1',
              ptid: 'ptid:test:alice',
              role: 3,
              member_status: 1,
            },
            {
              conversation_id: 'conversation-1',
              ptid: 'ptid:test:bob',
              role: 1,
              member_status: 1,
            },
          ],
          membership_epoch: 3,
          mls_epoch: 4,
          mls_status: 'active',
          active: true,
          updated_at_unix_ms: 1_800_000_000_000,
        }],
      },
    })

    await expect(imServiceV1.messaging.listConversations()).resolves.toEqual([{
      conversationId: 'conversation-1',
      authorityStationId: 'station-authority',
      kind: 2,
      name: 'Group',
      ownerPtid: 'ptid:test:alice',
      members: [
        expect.objectContaining({
          conversationId: 'conversation-1',
          ptid: 'ptid:test:alice',
          role: 3,
          memberStatus: 1,
        }),
        expect.objectContaining({
          conversationId: 'conversation-1',
          ptid: 'ptid:test:bob',
          role: 1,
          memberStatus: 1,
        }),
      ],
      membershipEpoch: 3,
      mlsEpoch: 4,
      mlsStatus: 'active',
      active: true,
      updatedAtUnixMs: 1_800_000_000_000,
    }])
  })
})

describe('Conversation member settings projection', () => {
  it('round-trips typed Station-backed conversation actions', async () => {
    invokeMock.mockResolvedValueOnce({
      ok: true,
      data: {
        nickname: '',
        muted: true,
        alertEnabled: false,
        pinned: true,
        background: 'mint',
        backgroundImage: 'oss://station/background',
        clearedAtUnixMs: 1_800_000_000_000,
      },
    })

    await expect(imServiceV1.conversation.updateMemberSettings('conversation-1', {
      muted: true,
      pinned: true,
      background: 'mint',
      backgroundImage: 'oss://station/background',
      clearedAtUnixMs: 1_800_000_000_000,
    })).resolves.toEqual({
      nickname: '',
      muted: true,
      alertEnabled: false,
      pinned: true,
      background: 'mint',
      backgroundImage: 'oss://station/background',
      clearedAtUnixMs: 1_800_000_000_000,
    })

    expect(invokeMock).toHaveBeenCalledWith('conversation_update_member_settings', {
      input: {
        conversation_id: 'conversation-1',
        nickname: undefined,
        muted: true,
        alert_enabled: undefined,
        pinned: true,
        background: 'mint',
        background_image: 'oss://station/background',
        cleared_at_unix_ms: 1_800_000_000_000,
      },
    })
  })
})

describe('Messaging send outcome', () => {
  it.each([
    ['pending', 'command-1'],
    ['draft', ''],
    ['attachment_failed', ''],
  ] as const)('preserves the %s result and attachment conservation fields', async (state, commandId) => {
    invokeMock.mockResolvedValueOnce({
      ok: true,
      data: {
        command_id: commandId,
        message_id: 'message-1',
        attachment_ids: ['attachment-1', 'attachment-2'],
        state,
      },
    })

    await expect(imServiceV1.messaging.sendMessage(
      'conversation-1',
      'direct',
      '',
      [
        { filePath: '/tmp/image.png', filename: 'image.png', mimeType: 'image/png' },
        { filePath: '/tmp/file.pdf', filename: 'file.pdf', mimeType: 'application/pdf' },
      ],
    )).resolves.toEqual({
      commandId: commandId || undefined,
      messageId: 'message-1',
      attachmentIds: ['attachment-1', 'attachment-2'],
      attachmentCount: 2,
      state,
    })
  })
})

describe('Messaging membership intent boundary', () => {
  it.each([
    ['add_actor', 'ptid:test:carol'],
    ['remove_actor', 'ptid:test:bob'],
  ] as const)('submits %s without exposing crypto or epoch fields', async (action, targetPtid) => {
    invokeMock.mockResolvedValueOnce({
      ok: true,
      data: { command_id: `command-${action}`, state: 'pending' },
    })

    await expect(imServiceV1.messaging.submitMembershipIntent({
      conversationId: 'group-1',
      action,
      targetPtid,
    })).resolves.toEqual({
      commandId: `command-${action}`,
      state: 'pending',
    })

    expect(invokeMock).toHaveBeenCalledWith('messaging_membership_transition', {
      input: {
        conversation_id: 'group-1',
        action,
        target_ptid: targetPtid,
      },
    })
    const input = invokeMock.mock.calls[0]?.[1]?.input
    expect(input).not.toHaveProperty('sender_device_id')
    expect(input).not.toHaveProperty('observed_membership_epoch')
    expect(input).not.toHaveProperty('key_package')
    expect(input).not.toHaveProperty('mls_commit')
  })
})

describe('Messaging group creation boundary', () => {
  it.each(['pending', 'projected', 'failed'] as const)(
    'preserves the exact command identity for %s state',
    async (state) => {
      invokeMock.mockResolvedValueOnce({
        ok: true,
        data: {
          conversation_id: 'group-1',
          command_id: 'group-command-1',
          state,
        },
      })

      await expect(imServiceV1.messaging.createGroup(
        'group-1',
        'Project group',
        ['ptid:bob'],
      )).resolves.toEqual({
        conversationId: 'group-1',
        commandId: 'group-command-1',
        state,
      })

      expect(invokeMock).toHaveBeenCalledWith('messaging_create_group', {
        input: {
          conversation_id: 'group-1',
          name: 'Project group',
          member_ptids: ['ptid:bob'],
        },
      })
    },
  )

  it('projects terminal status for the exact pending group command', async () => {
    invokeMock.mockResolvedValueOnce({
      ok: true,
      data: {
        command_id: 'group-command-1',
        conversation_id: 'group-1',
        state: 'failed',
        last_error_code: 'authority_rejected',
      },
    })

    await expect(
      imServiceV1.messaging.getCommandStatus('group-command-1'),
    ).resolves.toEqual({
      commandId: 'group-command-1',
      conversationId: 'group-1',
      state: 'failed',
      lastErrorCode: 'authority_rejected',
    })
  })
})
