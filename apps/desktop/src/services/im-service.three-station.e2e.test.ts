import { randomUUID } from 'node:crypto'
import {
  existsSync,
  mkdirSync,
  readFileSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fromBinary } from '@bufbuild/protobuf'
import { describe, expect, it, vi } from 'vitest'

const gatewayState = vi.hoisted(() => ({
  url: '',
  lastMembershipTransition: null as null | {
    gateway: string
    input: Record<string, unknown>
  },
}))

vi.mock('@tauri-apps/api/core', () => ({
  invoke: async (command: string, payload?: { input?: unknown }) => {
    if (!gatewayState.url) throw new Error('C6 gateway is not selected')
    if (
      command === 'conversation_submit_command_proposal' &&
      payload?.input &&
      typeof payload.input === 'object'
    ) {
      gatewayState.lastMembershipTransition = {
        gateway: gatewayState.url,
        input: structuredClone(payload.input) as Record<string, unknown>,
      }
    }
    const response = await fetch(gatewayState.url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        cmd: command,
        args: payload?.input ?? {},
      }),
    })
    if (!response.ok) {
      throw new Error(`gateway ${command} returned ${response.status}`)
    }
    return response.json()
  },
}))

import { CommittedConversationEventSchema } from '../gen/proto/domain/chat/conversation_pb'
import { imServiceV1 } from './im-service'

interface C6Client {
  name: string
  station: string
  gateway: string
  homeStationPeerId: string
  email: string
  password: string
  ptid: string
  deviceId: string
  keyPackage: Uint8Array
}

interface TopologyReport {
  federation_id: string
  nodes: Record<string, {
    station_peer_id: string
  }>
}

const liveDescribe = process.env.PT_C6_MLS_E2E === '1'
  ? describe
  : describe.skip

const topologyPath = resolve(
  process.cwd(),
  '../../tooling/acceptance/reports/testnet-p5-federation-e2e.json',
)
const reportPath = resolve(
  process.cwd(),
  '../../tooling/acceptance/reports/chat-mls-three-station-convergence.json',
)
const gatewayOne = process.env.PT_C6_GATEWAY_ONE ?? 'http://127.0.0.1:3330'
const gatewayTwo = process.env.PT_C6_GATEWAY_TWO ?? 'http://127.0.0.1:3331'
const gatewayThree = process.env.PT_C6_GATEWAY_THREE ?? 'http://127.0.0.1:3332'
const gatewayBob2 = process.env.PT_C6_GATEWAY_BOB2 ?? 'http://127.0.0.1:3333'
const controlDir = process.env.PT_C6_CONTROL_DIR ?? ''

liveDescribe('C6 MLS three-Station convergence', () => {
  it('converges device transitions and delegated leave across real Desktop Rust clients', async () => {
    const topology = JSON.parse(
      readFileSync(topologyPath, 'utf8'),
    ) as TopologyReport
    const alice = await createClient(
      'alice',
      'http://10.37.246.80:18080',
      gatewayOne,
      topology.nodes.one.station_peer_id,
    )
    const bob = await createClient(
      'bob',
      'http://10.37.118.48:18080',
      gatewayTwo,
      topology.nodes.two.station_peer_id,
    )
    const charlie = await createClient(
      'charlie',
      'http://10.37.94.156:18080',
      gatewayThree,
      topology.nodes.three.station_peer_id,
    )
    const bob2 = await createAdditionalDevice(
      bob,
      'bob2',
      gatewayBob2,
    )

    const conversationId = randomUUID()
    await activate(alice)
    const created = await imServiceV1.mlsGroup.createAuthorizedGroup({
      conversationId,
      name: 'C6 MLS convergence',
      federationId: topology.federation_id,
      ownerPtid: alice.ptid,
      ownerDeviceId: alice.deviceId,
      ownerHomeStationPeerId: alice.homeStationPeerId,
      members: [{
        ptid: bob.ptid,
        deviceId: bob.deviceId,
        homeStationPeerId: bob.homeStationPeerId,
        keyPackage: bob.keyPackage,
      }],
    })
    expect(created.conversation.membershipEpoch).toBe(1n)
    await pumpMls(bob, conversationId, 1)
    await expectConverged([alice, bob], conversationId, 1)

    await requestControl('charlie', 'stop')
    await activate(alice)
    await imServiceV1.mlsGroup.addAuthorizedMember({
      conversationId,
      senderPtid: alice.ptid,
      senderDeviceId: alice.deviceId,
      observedMembershipEpoch: 1,
      member: {
        ptid: charlie.ptid,
        deviceId: charlie.deviceId,
        homeStationPeerId: charlie.homeStationPeerId,
        keyPackage: charlie.keyPackage,
      },
    })
    await pumpMls(bob, conversationId, 2)
    await sleep(1_500)
    await requestControl('charlie', 'start')
    await rehydrateClient(charlie, conversationId, false)
    const deliveryFaults = await pumpMlsWithDeliveryFaults(
      charlie,
      conversationId,
      2,
    )
    await expectConverged([alice, bob, charlie], conversationId, 2)

    const remotePlaintext = new TextEncoder().encode('C6-D17-REMOTE-ORDINARY')
    await activate(bob)
    const remoteCiphertext = await imServiceV1.mlsGroup.encrypt(
      conversationId,
      remotePlaintext,
    )
    await imServiceV1.mlsGroup.save(conversationId)
    const remoteEvent = await imServiceV1.conversation.submitCommand({
      conversation_id: conversationId,
      sender_ptid: bob.ptid,
      sender_device_id: bob.deviceId,
      observed_membership_epoch: 2,
      send_message: {
        group_encrypted_payload: Buffer.from(remoteCiphertext).toString('base64'),
        content_type: 1,
      },
    } as any)
    if (remoteEvent.payload.case !== 'messageCommitted') {
      throw new Error('remote ordinary command did not commit a message event')
    }
    await activate(charlie)
    await expect(
      imServiceV1.mlsGroup.decrypt(
        conversationId,
        remoteEvent.payload.value.groupEncryptedPayload,
      ),
    ).resolves.toEqual(remotePlaintext)

    await activate(bob)
    const addDeviceEvent = await imServiceV1.mlsGroup.addAuthorizedDevice({
      conversationId,
      senderPtid: bob.ptid,
      senderDeviceId: bob.deviceId,
      observedMembershipEpoch: 2,
      member: {
        ptid: bob2.ptid,
        deviceId: bob2.deviceId,
        homeStationPeerId: bob2.homeStationPeerId,
        keyPackage: bob2.keyPackage,
      },
    })
    const signedProposal = gatewayState.lastMembershipTransition
    if (!signedProposal) {
      throw new Error('remote ADD_DEVICE signed proposal was not captured')
    }
    await activate(bob)
    const duplicateProposal = await gatewayJson(
      signedProposal.gateway,
      'conversation_submit_command_proposal',
      signedProposal.input,
    )
    const duplicateEventBytes = (
      duplicateProposal.data as { event_bytes?: number[] }
    ).event_bytes
    if (!duplicateEventBytes) {
      throw new Error('duplicate proposal returned no canonical event bytes')
    }
    const duplicateEvent = fromBinary(
      CommittedConversationEventSchema,
      new Uint8Array(duplicateEventBytes),
    )
    expect(duplicateEvent.eventId).toBe(addDeviceEvent.eventId)
    expect(duplicateEvent.eventHash).toEqual(addDeviceEvent.eventHash)
    await pumpMls(alice, conversationId, 3)
    await pumpMls(charlie, conversationId, 3)
    await pumpMls(bob2, conversationId, 3)
    await expectConverged([alice, bob, bob2, charlie], conversationId, 3)
    await requestControl('bob2', 'restart')
    await rehydrateClient(bob2, conversationId, true)
    await expectConverged([alice, bob2, charlie], conversationId, 3)
    await expectCiphertextAccess(
      alice,
      [bob, bob2, charlie],
      [],
      conversationId,
      'C6-BEFORE-REMOVE-DEVICE',
    )

    await requestControl('station-three', 'restart')
    await activate(bob2)
    await imServiceV1.mlsGroup.removeAuthorizedDevice({
      conversationId,
      senderPtid: bob2.ptid,
      senderDeviceId: bob2.deviceId,
      observedMembershipEpoch: 3,
      memberPtid: bob.ptid,
      memberDeviceId: bob.deviceId,
    })
    await pumpMls(alice, conversationId, 4)
    await pumpMls(bob, conversationId, 4)
    await pumpMls(charlie, conversationId, 4)
    await expectConverged([alice, bob2, charlie], conversationId, 4)
    await expectCiphertextAccess(
      alice,
      [bob2, charlie],
      [bob],
      conversationId,
      'C6-AFTER-REMOVE-DEVICE',
    )

    await activate(bob2)
    const intent = await imServiceV1.mlsGroup.requestLeaveIntent({
      federationId: topology.federation_id,
      authorityStationPeerId: alice.homeStationPeerId,
      authorityEpoch: Number(created.conversation.authorityEpoch),
      homeStationPeerId: bob2.homeStationPeerId,
      conversationId,
      actorPtid: bob2.ptid,
      actorDeviceId: bob2.deviceId,
      observedMembershipEpoch: 4,
      observedMlsEpoch: 4,
    })
    await activate(alice)
    const listed = await imServiceV1.mlsGroup.listLeaveIntents(conversationId)
    expect(listed.some(item => item.intentId === intent.intentId)).toBe(true)
    await imServiceV1.mlsGroup.commitAuthorizedLeave({
      conversationId,
      senderPtid: alice.ptid,
      senderDeviceId: alice.deviceId,
      observedMembershipEpoch: 4,
      intent,
    })
    await pumpMls(bob2, conversationId, 5)
    await pumpMls(charlie, conversationId, 5)
    await expectConverged([alice, charlie], conversationId, 5)
    await expectCiphertextAccess(
      alice,
      [charlie],
      [bob2],
      conversationId,
      'C6-AFTER-DELEGATED-LEAVE',
    )

    const finalHeads = await collectHeads([alice, charlie], conversationId)
    const report = {
      schema_version: 1,
      gate: 'chat-mls-three-station-convergence',
      generated_at_unix_ms: Date.now(),
      status: 'pass',
      deployed_commit: process.env.PT_C6_DEPLOYED_COMMIT ?? 'be75f3789bf0',
      federation_id: topology.federation_id,
      conversation_id: conversationId,
      transitions: {
        genesis_epoch: 1,
        remote_add_device_epoch: 3,
        remote_remove_device_epoch: 4,
        delegated_leave_epoch: 5,
      },
      fault_schedule: {
        disconnected_recipient_before_add: true,
        durable_inbox_reconnect: true,
        recipient_delivery_reordered: deliveryFaults.reordered,
        partial_ack_replayed: deliveryFaults.partialAckReplayed,
        duplicate_delivery_noop: deliveryFaults.duplicateNoop,
        duplicate_remote_proposal_exact_replay: true,
        desktop_gateway_restart_epoch: 3,
        follower_station_restart_before_epoch: 4,
        follower_post_restart_epoch: 4,
      },
      final_client_heads: finalHeads,
      removed_device_decrypt_denied: true,
      departed_actor_decrypt_denied: true,
      remote_ordinary_send: {
        status: 'pass',
        sender_station: 'two',
        authority_station: 'one',
        recipient_station: 'three',
        command_path: 'desktop-rust -> home -> authority -> committed-event',
        event_id: remoteEvent.eventId,
        event_hash: Buffer.from(remoteEvent.eventHash).toString('hex'),
        recipient_decrypt: true,
      },
      access_tokens_present: false,
    }
    mkdirSync(dirname(reportPath), { recursive: true })
    writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`)
  }, 240_000)
})

async function createClient(
  name: string,
  station: string,
  gateway: string,
  homeStationPeerId: string,
): Promise<C6Client> {
  const suffix = `${Date.now()}${Math.random().toString(16).slice(2, 8)}`
  const email = `c6${name}${suffix}@testnet.local`
  const password = `C6Aa1!${suffix.slice(-8)}`
  await stationJson(station, '/actor/sign-up', {
    name: `c6${name}${suffix}`.slice(0, 20),
    email,
    password,
  })
  await gatewayJson(gateway, 'auth_login', { account: email, password })
  return initializeDevice({
    name,
    station,
    gateway,
    homeStationPeerId,
    email,
    password,
  })
}

async function createAdditionalDevice(
  actor: C6Client,
  name: string,
  gateway: string,
): Promise<C6Client> {
  await gatewayJson(gateway, 'auth_login', {
    account: actor.email,
    password: actor.password,
  })
  return initializeDevice({
    ...actor,
    name,
    gateway,
    ptid: '',
    deviceId: '',
    keyPackage: new Uint8Array(),
  })
}

async function initializeDevice(
  client: Omit<C6Client, 'ptid' | 'deviceId' | 'keyPackage'> & Partial<C6Client>,
): Promise<C6Client> {
  const deviceResult = await gatewayJson(
    client.gateway,
    'account_get_device_id',
    {},
  )
  const deviceId = JSON.parse(
    String((deviceResult.data as { status: string }).status),
  ).device_id as string
  select({ gateway: client.gateway })
  const identity = await imServiceV1.mlsGroup.initIdentity('', deviceId)
  try {
    await imServiceV1.device.register(
      deviceId,
      `C6 ${client.name}`,
      identity.publicKey,
      identity.signingKeyId,
    )
  } catch (error) {
    throw new Error(
      `${client.name} device registration failed for ${deviceId}: ${String(error)}`,
    )
  }
  const keyPackage = await imServiceV1.mlsGroup.generateKeyPackage()
  await imServiceV1.keyPackage.upload(deviceId, keyPackage)
  return {
    name: client.name,
    station: client.station,
    gateway: client.gateway,
    homeStationPeerId: client.homeStationPeerId,
    email: client.email,
    password: client.password,
    ptid: identity.ptid,
    deviceId,
    keyPackage,
  }
}

async function pumpMls(
  client: C6Client,
  conversationId: string,
  expectedEpoch: number,
): Promise<void> {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    await activate(client)
    const items = await imServiceV1.envelope.resume(client.deviceId)
    for (const item of items) {
      const envelope = item.envelope
      if (!envelope) continue
      if (envelope.payloadType === 1) {
        await imServiceV1.mlsGroup.recordAuthorityEvent(
          envelope.payloadBytes,
          client.deviceId,
        )
      } else if (envelope.payloadType === 2) {
        await imServiceV1.mlsGroup.applyTransitionDelivery(
          envelope.payloadBytes,
          client.deviceId,
        )
      }
      await imServiceV1.envelope.ack(client.deviceId, item.inboxItemId)
    }
    const status = await imServiceV1.mlsGroup.recipientStatus(conversationId)
    if (status.status === 'active' && status.mlsEpoch === expectedEpoch) return
    await sleep(500)
  }
  throw new Error(`${client.name} did not reach MLS epoch ${expectedEpoch}`)
}

interface DeliveryFaultEvidence {
  reordered: boolean
  partialAckReplayed: boolean
  duplicateNoop: boolean
}

async function pumpMlsWithDeliveryFaults(
  client: C6Client,
  conversationId: string,
  expectedEpoch: number,
): Promise<DeliveryFaultEvidence> {
  const items = await waitForInboxItems(client, 2)
  const originalOrder = items.map(item => item.envelope?.payloadType ?? 0)
  const reorderedItems = [...items].reverse()
  const reorderedOrder = reorderedItems.map(
    item => item.envelope?.payloadType ?? 0,
  )
  if (!originalOrder.includes(1) || !originalOrder.includes(2)) {
    throw new Error(
      `fault batch lacks event/material pair: ${originalOrder.join(',')}`,
    )
  }
  const heldItem = reorderedItems[0]

  for (const [index, item] of reorderedItems.entries()) {
    await applyEnvelopeItem(client, item)
    if (index > 0) {
      await imServiceV1.envelope.ack(client.deviceId, item.inboxItemId)
    }
  }

  await activate(client)
  const resumed = await imServiceV1.envelope.resume(client.deviceId)
  const replay = resumed.find(
    item => item.inboxItemId === heldItem.inboxItemId,
  )
  if (!replay) {
    throw new Error('partial ACK item was not recovered after reconnect')
  }
  const replayResult = await applyEnvelopeItem(client, replay)
  if (!replayResult?.duplicate) {
    throw new Error('replayed partial-ACK delivery was not a duplicate no-op')
  }
  await imServiceV1.envelope.ack(client.deviceId, replay.inboxItemId)

  const status = await imServiceV1.mlsGroup.recipientStatus(conversationId)
  if (
    status.status !== 'active' ||
    status.mlsEpoch !== expectedEpoch ||
    status.buffered !== 0
  ) {
    throw new Error(
      `${client.name} fault recovery ended at ${JSON.stringify(status)}`,
    )
  }
  return {
    reordered: originalOrder.join(',') !== reorderedOrder.join(','),
    partialAckReplayed: true,
    duplicateNoop: replayResult.duplicate,
  }
}

async function waitForInboxItems(
  client: C6Client,
  minimum: number,
) {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    await activate(client)
    const items = await imServiceV1.envelope.resume(client.deviceId)
    if (items.length >= minimum) return items
    await sleep(500)
  }
  throw new Error(
    `${client.name} did not receive ${minimum} durable inbox items`,
  )
}

async function applyEnvelopeItem(
  client: C6Client,
  item: Awaited<ReturnType<typeof imServiceV1.envelope.resume>>[number],
): Promise<{ duplicate: boolean } | null> {
  const envelope = item.envelope
  if (!envelope) throw new Error('inbox item has no Station envelope')
  if (envelope.payloadType === 1) {
    return imServiceV1.mlsGroup.recordAuthorityEvent(
      envelope.payloadBytes,
      client.deviceId,
    )
  } else if (envelope.payloadType === 2) {
    return imServiceV1.mlsGroup.applyTransitionDelivery(
      envelope.payloadBytes,
      client.deviceId,
    )
  }
  return null
}

async function expectConverged(
  clients: C6Client[],
  conversationId: string,
  epoch: number,
): Promise<void> {
  const heads = await collectHeads(clients, conversationId)
  for (const head of Object.values(heads)) {
    expect(head.mlsEpoch).toBe(epoch)
  }
  const [first, ...rest] = Object.values(heads)
  for (const head of rest) {
    expect(head.groupContextSha256).toBe(first.groupContextSha256)
    expect(head.ratchetTreeSha256).toBe(first.ratchetTreeSha256)
    expect(head.memberCredentialsSha256).toBe(first.memberCredentialsSha256)
  }
}

async function collectHeads(
  clients: C6Client[],
  conversationId: string,
) {
  const result: Record<string, Awaited<ReturnType<
    typeof imServiceV1.mlsGroup.publicHead
  >>> = {}
  for (const client of clients) {
    await activate(client)
    result[client.name] = await imServiceV1.mlsGroup.publicHead(conversationId)
  }
  return result
}

async function expectCiphertextAccess(
  sender: C6Client,
  allowed: C6Client[],
  denied: C6Client[],
  conversationId: string,
  marker: string,
): Promise<void> {
  const plaintext = new TextEncoder().encode(marker)
  await activate(sender)
  const ciphertext = await imServiceV1.mlsGroup.encrypt(
    conversationId,
    plaintext,
  )
  for (const client of allowed) {
    await activate(client)
    await expect(
      imServiceV1.mlsGroup.decrypt(conversationId, ciphertext),
    ).resolves.toEqual(plaintext)
  }
  for (const client of denied) {
    await activate(client)
    await expect(
      imServiceV1.mlsGroup.decrypt(conversationId, ciphertext),
    ).rejects.toThrow()
  }
}

function select(client: Pick<C6Client, 'gateway'>): void {
  gatewayState.url = client.gateway
}

async function activate(client: C6Client): Promise<void> {
  await gatewayJson(client.gateway, 'auth_login', {
    account: client.email,
    password: client.password,
  })
  select(client)
}

async function rehydrateClient(
  client: C6Client,
  conversationId: string,
  requireGroupState: boolean,
): Promise<void> {
  await activate(client)
  const restored = await imServiceV1.mlsGroup.initIdentity('', client.deviceId)
  expect(restored.ptid).toBe(client.ptid)
  if (requireGroupState) {
    await imServiceV1.mlsGroup.load(conversationId)
  }
}

async function requestControl(
  target: 'charlie' | 'bob2' | 'station-three',
  action: 'stop' | 'start' | 'restart',
): Promise<void> {
  if (!controlDir) {
    throw new Error('PT_C6_CONTROL_DIR is required for the C6 fault schedule')
  }
  const request = resolve(controlDir, `${target}.${action}.request`)
  const done = resolve(controlDir, `${target}.${action}.done`)
  if (existsSync(done)) unlinkSync(done)
  writeFileSync(request, `${Date.now()}\n`)
  for (let attempt = 0; attempt < 240; attempt += 1) {
    if (existsSync(done)) {
      unlinkSync(done)
      return
    }
    await sleep(250)
  }
  throw new Error(`C6 control timed out: ${target}.${action}`)
}

async function gatewayJson(
  gateway: string,
  command: string,
  args: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const response = await fetch(gateway, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ cmd: command, args }),
  })
  const envelope = await response.json() as {
    ok: boolean
    data?: Record<string, unknown>
    error?: unknown
  }
  if (!response.ok || !envelope.ok || !envelope.data) {
    throw new Error(`${command} failed: ${JSON.stringify(envelope.error)}`)
  }
  return envelope
}

async function stationJson(
  station: string,
  path: string,
  body: Record<string, unknown>,
): Promise<void> {
  const response = await fetch(`${station}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!response.ok) {
    throw new Error(`${path} failed: ${response.status}`)
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}
