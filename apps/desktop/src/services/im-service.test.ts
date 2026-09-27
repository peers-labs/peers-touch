import { beforeEach, describe, expect, it, vi } from 'vitest'

const invokeMock = vi.hoisted(() => vi.fn())

vi.mock('@tauri-apps/api/core', () => ({ invoke: invokeMock }))

import { imServiceV1, normalizeConversationEvents } from './im-service'

beforeEach(() => {
  invokeMock.mockReset()
})

describe('IM service boundary', () => {
  it('does not expose the removed raw MLS service', () => {
    expect(imServiceV1).not.toHaveProperty('mlsGroup')
  })

  it('requires the selected federation when opening a Direct conversation', async () => {
    invokeMock.mockResolvedValueOnce({
      ok: true,
      data: {
        conversation_id: 'conversation-1',
        state: 'projected',
      },
    })

    await expect(imServiceV1.messaging.createDirect({
      peerPtid: 'ptid:bob',
      federationId: 'federation-1',
    })).resolves.toEqual({
      conversationId: 'conversation-1',
      state: 'projected',
    })

    expect(invokeMock).toHaveBeenCalledWith('messaging_create_direct', {
      input: {
        peer_ptid: 'ptid:bob',
        federation_id: 'federation-1',
      },
    })
  })

  it('decodes Station device protobuf JSON before exposing typed devices', async () => {
    invokeMock.mockResolvedValueOnce({
      ok: true,
      data: {
        devices: [{
          ref: {
            actor: {
              ptid: 'ptid:alice',
              acct: 'alice@p.t',
              kind: 'ACTOR_KIND_PERSON',
            },
            device_id: 'device-alice',
          },
          status: 'ACTOR_DEVICE_STATUS_ACTIVE',
          label: 'Desktop',
          profile_version: '1',
        }],
      },
    })

    const devices = await imServiceV1.device.list()

    expect(devices[0]?.ref?.deviceId).toBe('device-alice')
    expect(devices[0]?.status).toBe(2)
    expect(devices[0]?.profileVersion).toBe(1n)
  })

  it('binds device revocation to the observed profile version', async () => {
    invokeMock.mockResolvedValueOnce({
      ok: true,
      data: {},
    })

    await imServiceV1.device.revoke('device-alice', 7n)

    expect(invokeMock).toHaveBeenCalledWith('device_revoke', {
      input: {
        device_id: 'device-alice',
        observed_profile_version: 7,
      },
    })
  })
})

describe('normalizeConversationEvents', () => {
  it('decodes Station Go oneof and timestamp JSON', () => {
    const [event] = normalizeConversationEvents([{
      event_id: 'event-1',
      conversation_id: 'conversation-1',
      sequence: 7,
      command_id: 'command-1',
      membership_epoch: 2,
      authority_station_peer_id: 'station-1',
      committed_at: { seconds: 1_785_634_845, nanos: 250_000_000 },
      Payload: {
        MessageCommitted: {
          message_id: 'message-1',
          sender: {
            ptid: 'alice',
            device_id: 'desktop',
          },
          content_kind: 1,
        },
      },
    }])

    expect(event.sequence).toBe(7n)
    expect(event.membershipEpoch).toBe(2n)
    expect(event.authorityStationPeerId).toBe('station-1')
    expect(event.committedAt?.seconds).toBe(1_785_634_845n)
    expect(event.payload.case).toBe('messageCommitted')
    if (event.payload.case !== 'messageCommitted') throw new Error('unexpected payload')
    expect(event.payload.value.sender?.ptid).toBe('alice')
    expect(event.payload.value.sender?.deviceId).toBe('desktop')
  })

  it('decodes canonical membership transition evidence', () => {
    const [event] = normalizeConversationEvents([{
      event_id: 'event-transition-1',
      conversation_id: 'conversation-1',
      sequence: 2,
      command_id: 'command-transition-1',
      membership_epoch: 1,
      authority_station_peer_id: 'station-1',
      event_hash: 'AQID',
      Payload: {
        MembershipTransitionCommitted: {
          transition_id: 'transition-1',
          from_membership_epoch: 0,
          to_membership_epoch: 1,
          from_mls_epoch: 0,
          to_mls_epoch: 1,
          mls_commit_sha256: 'BwgJ',
          changes: [{
            ptid: 'alice',
            home_station_peer_id: 'station-1',
            action: 1,
            role: 'owner',
            device_id: 'alice-device',
          }],
        },
      },
    }])

    expect(event.payload.case).toBe('membershipTransitionCommitted')
    if (event.payload.case !== 'membershipTransitionCommitted') {
      throw new Error('unexpected payload')
    }
    expect(event.payload.value.transitionId).toBe('transition-1')
    expect(event.payload.value.toMlsEpoch).toBe(1n)
    expect(event.payload.value.mlsCommitSha256).toEqual(new Uint8Array([7, 8, 9]))
  })
})

describe('Messaging leave intent boundary', () => {
  it('submits leave intent through the active messaging engine identity', async () => {
    invokeMock.mockResolvedValueOnce({
      ok: true,
      data: {
        version: 1,
        intent_id: 'leave-intent-bob',
        federation_id: 'federation-1',
        authority_station_peer_id: 'station-1',
        authority_epoch: 1,
        home_station_peer_id: 'station-2',
        conversation_id: 'conversation-1',
        actor_ptid: 'ptid:bob',
        actor_device_id: 'bob-device',
        actor_signing_key_id: 'bob-key',
        observed_membership_epoch: 1,
        observed_mls_epoch: 1,
        created_at_unix_ms: 1_800_000_000_000,
        expires_at_unix_ms: 1_800_000_300_000,
        actor_signature: [1, 2, 3],
        authority_sequence: 7,
        authority_hash: [4, 5, 6],
      },
    })

    await expect(imServiceV1.messaging.requestLeaveIntent({
      federationId: 'federation-1',
      authorityStationPeerId: 'station-1',
      authorityEpoch: 1,
      homeStationPeerId: 'station-2',
      conversationId: 'conversation-1',
      observedMembershipEpoch: 1,
      observedMlsEpoch: 1,
    })).resolves.toMatchObject({
      intentId: 'leave-intent-bob',
      actorPtid: 'ptid:bob',
      actorSignature: new Uint8Array([1, 2, 3]),
    })

    expect(invokeMock).toHaveBeenCalledWith('messaging_submit_leave_intent', {
      input: {
        federation_id: 'federation-1',
        authority_station_peer_id: 'station-1',
        authority_epoch: 1,
        home_station_peer_id: 'station-2',
        conversation_id: 'conversation-1',
        observed_membership_epoch: 1,
        observed_mls_epoch: 1,
      },
    })
    expect(invokeMock.mock.calls[0]?.[1]?.input).not.toHaveProperty('actor_ptid')
    expect(invokeMock.mock.calls[0]?.[1]?.input).not.toHaveProperty('actor_device_id')
  })

  it('lists leave intents through the active messaging engine', async () => {
    invokeMock.mockResolvedValueOnce({
      ok: true,
      data: {
        intents: [{
          version: 1,
          intent_id: 'leave-intent-bob',
          federation_id: 'federation-1',
          authority_station_peer_id: 'station-1',
          authority_epoch: 1,
          home_station_peer_id: 'station-2',
          conversation_id: 'conversation-1',
          actor_ptid: 'ptid:bob',
          actor_device_id: 'bob-device',
          actor_signing_key_id: 'bob-key',
          observed_membership_epoch: 1,
          observed_mls_epoch: 1,
          created_at_unix_ms: 1_800_000_000_000,
          expires_at_unix_ms: 1_800_000_300_000,
          actor_signature: [1, 2, 3],
          authority_sequence: 7,
          authority_hash: [4, 5, 6],
        }],
      },
    })

    await expect(imServiceV1.messaging.listLeaveIntents('conversation-1')).resolves.toEqual([
      expect.objectContaining({
        intentId: 'leave-intent-bob',
        actorSignature: new Uint8Array([1, 2, 3]),
      }),
    ])
    expect(invokeMock).toHaveBeenCalledWith('messaging_list_leave_intents', {
      input: { conversation_id: 'conversation-1' },
    })
  })

  it('commits LEAVE with a different active device and exact intent proof', async () => {
    invokeMock.mockResolvedValueOnce({
      ok: true,
      data: {
        command_id: 'command-leave-1',
        state: 'pending',
      },
    })

    await expect(imServiceV1.messaging.commitAuthorizedLeave({
      intent: {
        version: 1,
        intentId: 'leave-intent-bob',
        federationId: 'federation-1',
        authorityStationPeerId: 'station-1',
        authorityEpoch: 1,
        homeStationPeerId: 'station-2',
        conversationId: 'conversation-1',
        actorPtid: 'ptid:bob',
        actorDeviceId: 'bob-device',
        actorSigningKeyId: 'bob-key',
        observedMembershipEpoch: 1,
        observedMlsEpoch: 1,
        createdAtUnixMs: 1_800_000_000_000,
        expiresAtUnixMs: 1_800_000_300_000,
        actorSignature: new Uint8Array([1, 2, 3]),
        authoritySequence: 7,
        authorityHash: new Uint8Array([4, 5, 6]),
      },
    })).resolves.toEqual({
      commandId: 'command-leave-1',
      state: 'pending',
    })

    expect(invokeMock).toHaveBeenCalledOnce()
    expect(invokeMock).toHaveBeenCalledWith('messaging_commit_authorized_leave', {
      input: {
        leave_intent: {
          version: 1,
          intent_id: 'leave-intent-bob',
          federation_id: 'federation-1',
          authority_station_peer_id: 'station-1',
          authority_epoch: 1,
          home_station_peer_id: 'station-2',
          conversation_id: 'conversation-1',
          actor_ptid: 'ptid:bob',
          actor_device_id: 'bob-device',
          actor_signing_key_id: 'bob-key',
          observed_membership_epoch: 1,
          observed_mls_epoch: 1,
          created_at_unix_ms: 1_800_000_000_000,
          expires_at_unix_ms: 1_800_000_300_000,
          actor_signature: [1, 2, 3],
          authority_sequence: 7,
          authority_hash: [4, 5, 6],
        },
      },
    })
  })

})

describe('Messaging conversation projection', () => {
  it('retains authority and Federation identity from the Rust projection', async () => {
    invokeMock.mockResolvedValueOnce({
      ok: true,
      data: {
        conversations: [{
          conversation_id: 'conversation-1',
          authority_station_id: 'station-authority',
          federation_id: 'federation-1',
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
          summary: {
            unread_count: 2,
            latest_message: null,
          },
        }],
      },
    })

    await expect(imServiceV1.messaging.listConversations()).resolves.toEqual([{
      conversationId: 'conversation-1',
      authorityStationId: 'station-authority',
      federationId: 'federation-1',
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
      summary: {
        unreadCount: 2,
        latestMessage: undefined,
      },
    }])
    expect(invokeMock).toHaveBeenCalledWith('messaging_list_conversations', undefined)
  })
})

describe('Messaging message projection', () => {
  it('reads plaintext only through the canonical messaging projection', async () => {
    invokeMock.mockResolvedValueOnce({
      ok: true,
      data: {
        messages: [{
          event_id: 'event-1',
          event_sequence: 7,
          message_id: 'message-1',
          sender_ptid: 'ptid:test:alice',
          sender_device_id: 'alice-device',
          plaintext: 'canonical plaintext',
          attachments: [],
          state: 'committed',
          timestamp_unix_ms: 1_800_000_000_000,
          retracted: false,
          reactions: [],
          read_by_ptids: ['ptid:test:bob'],
        }],
        has_more: true,
        next_before_sequence: 7,
      },
    })

    await expect(imServiceV1.messaging.listMessages('conversation-1')).resolves.toEqual({
      messages: [{
        eventId: 'event-1',
        eventSequence: 7,
        messageId: 'message-1',
        senderPtid: 'ptid:test:alice',
        senderDeviceId: 'alice-device',
        plaintext: 'canonical plaintext',
        attachments: [],
        state: 'committed',
        timestampUnixMs: 1_800_000_000_000,
        replyToMessageId: undefined,
        threadRootMessageId: undefined,
        editedText: undefined,
        editedAtUnixMs: undefined,
        retracted: false,
        reactions: [],
        pinnedByPtid: undefined,
        pinnedAtUnixMs: undefined,
        readByPtids: ['ptid:test:bob'],
      }],
      hasMore: true,
      nextBeforeSequence: 7,
    })
    expect(invokeMock).toHaveBeenCalledOnce()
    expect(invokeMock).toHaveBeenCalledWith('messaging_list_messages', {
      input: {
        conversation_id: 'conversation-1',
        before_sequence: undefined,
        limit: undefined,
      },
    })
  })

  it('retries the same logical message through the Engine owner', async () => {
    invokeMock.mockResolvedValueOnce({
      ok: true,
      data: {
        command_id: 'command-2',
        message_id: 'message-1',
        state: 'retrying',
      },
    })

    await expect(
      imServiceV1.messaging.retryMessage('conversation-1', 'message-1'),
    ).resolves.toEqual({
      commandId: 'command-2',
      messageId: 'message-1',
      state: 'retrying',
    })
    expect(invokeMock).toHaveBeenCalledWith('messaging_retry_message', {
      input: {
        conversation_id: 'conversation-1',
        message_id: 'message-1',
      },
    })
  })
})

describe('Messaging local projections and member settings', () => {
  it('reads thread counts from the Device Messaging Engine', async () => {
    invokeMock.mockResolvedValueOnce({
      ok: true,
      data: {
        counts: [{
          rootUlid: 'root-1',
          replyCount: 2,
          latestReplyUlid: 'reply-2',
          latestReplyAt: 1_800_000_000_000,
          unreadCount: 1,
        }],
      },
    })

    await expect(imServiceV1.messaging.threadCounts(
      'conversation-1',
      ['root-1'],
    )).resolves.toEqual({
      counts: [{
        rootUlid: 'root-1',
        replyCount: 2,
        latestReplyUlid: 'reply-2',
        latestReplyAt: 1_800_000_000_000,
        unreadCount: 1,
      }],
    })
    expect(invokeMock).toHaveBeenCalledWith('messaging_thread_counts', {
      input: {
        conversation_id: 'conversation-1',
        root_message_ids: ['root-1'],
      },
    })
  })

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
      },
    })

    await expect(imServiceV1.messaging.updateMemberSettings('conversation-1', {
      muted: true,
      pinned: true,
      background: 'mint',
      backgroundImage: 'oss://station/background',
    })).resolves.toEqual({
      nickname: '',
      muted: true,
      alertEnabled: false,
      pinned: true,
      background: 'mint',
      backgroundImage: 'oss://station/background',
    })

    expect(invokeMock).toHaveBeenCalledWith('messaging_update_member_settings', {
      input: {
        conversation_id: 'conversation-1',
        nickname: undefined,
        muted: true,
        alert_enabled: undefined,
        pinned: true,
        background: 'mint',
        background_image: 'oss://station/background',
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
    expect(invokeMock).toHaveBeenCalledWith('messaging_send_message', {
      input: {
        conversation_id: 'conversation-1',
        conversation_kind: 'direct',
        plaintext: '',
        reply_to_message_id: '',
        thread_root_message_id: '',
        attachments: [
          { file_path: '/tmp/image.png', filename: 'image.png', mime_type: 'image/png' },
          { file_path: '/tmp/file.pdf', filename: 'file.pdf', mime_type: 'application/pdf' },
        ],
      },
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

  it.each([
    ['add_device', 'bob-device-2'],
    ['remove_device', 'bob-device-1'],
  ] as const)('submits %s with the exact target endpoint', async (action, targetDeviceId) => {
    invokeMock.mockResolvedValueOnce({
      ok: true,
      data: { command_id: `command-${action}`, state: 'pending' },
    })

    await expect(imServiceV1.messaging.submitMembershipIntent({
      conversationId: 'group-1',
      action,
      targetPtid: 'ptid:test:bob',
      targetDeviceId,
    })).resolves.toEqual({
      commandId: `command-${action}`,
      state: 'pending',
    })

    expect(invokeMock).toHaveBeenCalledWith('messaging_membership_transition', {
      input: {
        conversation_id: 'group-1',
        action,
        target_ptid: 'ptid:test:bob',
        target_device_id: targetDeviceId,
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
        'federation-1',
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
          federation_id: 'federation-1',
        },
      })
      const input = invokeMock.mock.calls[0]?.[1]?.input
      expect(input).not.toHaveProperty('genesis_transition')
      expect(input).not.toHaveProperty('key_packages')
      expect(input).not.toHaveProperty('mls_commit')
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
