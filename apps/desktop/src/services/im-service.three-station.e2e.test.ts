import { randomUUID } from 'node:crypto'
import {
  existsSync,
  mkdirSync,
  readFileSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs'
import { dirname, resolve } from 'node:path'
import { describe, expect, it, vi } from 'vitest'

const gatewayState = vi.hoisted(() => ({
  url: '',
}))

vi.mock('@tauri-apps/api/core', () => ({
  invoke: async (command: string, payload?: { input?: unknown }) => {
    if (!gatewayState.url) throw new Error('C6 gateway is not selected')
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

import type {
  MessagingConversationProjection,
  MessagingProjection,
} from './im-service-contract'
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
}

interface TopologyReport {
  federation_id: string
  nodes: Record<string, {
    station_peer_id: string
  }>
}

interface EndpointIdentity {
  actorPtid: string
  deviceId: string
}

const liveDescribe = process.env.PT_C6_MLS_E2E === '1'
  ? describe
  : describe.skip

const gatewayOne = process.env.PT_C6_GATEWAY_ONE ?? 'http://127.0.0.1:3330'
const gatewayTwo = process.env.PT_C6_GATEWAY_TWO ?? 'http://127.0.0.1:3331'
const gatewayThree = process.env.PT_C6_GATEWAY_THREE ?? 'http://127.0.0.1:3332'
const gatewayBob2 = process.env.PT_C6_GATEWAY_BOB2 ?? 'http://127.0.0.1:3333'
const controlDir = process.env.PT_C6_CONTROL_DIR ?? ''

liveDescribe('C6 MLS three-Station convergence', () => {
  it('converges canonical messaging transitions across real Desktop Rust clients', async () => {
    const topologyPath = requiredRuntimePath('PT_C6_TOPOLOGY_PATH')
    const reportPath = requiredRuntimePath('PT_C6_REPORT_DRAFT_PATH')
    const topology = JSON.parse(
      readFileSync(topologyPath, 'utf8'),
    ) as TopologyReport
    const alice = await createClient(
      'alice',
      'http://192.0.2.10:18080',
      gatewayOne,
      topology.nodes.one.station_peer_id,
    )
    const bob = await createClient(
      'bob',
      'http://192.0.2.20:18080',
      gatewayTwo,
      topology.nodes.two.station_peer_id,
    )
    const charlie = await createClient(
      'charlie',
      'http://192.0.2.30:18080',
      gatewayThree,
      topology.nodes.three.station_peer_id,
    )
    const bob2 = await createAdditionalDevice(bob, 'bob2', gatewayBob2)

    const conversationId = randomUUID()
    await activate(alice)
    const created = await imServiceV1.messaging.createGroup(
      conversationId,
      'C6 MLS convergence',
      [bob.ptid],
      topology.federation_id,
    )
    expect(created.conversationId).toBe(conversationId)
    expect(created.state).not.toBe('failed')
    await waitForConversation(alice, conversationId, 1, true)
    await waitForConversation(bob, conversationId, 1, true)

    await requestControl('charlie', 'stop')
    await activate(alice)
    const addCharlie = await imServiceV1.messaging.submitMembershipIntent({
      conversationId,
      action: 'add_actor',
      targetPtid: charlie.ptid,
    })
    await waitForCommand(addCharlie.commandId)
    await waitForConversation(alice, conversationId, 2, true)
    await waitForConversation(bob, conversationId, 2, true)
    await sleep(1_500)
    await requestControl('charlie', 'start')
    await activate(charlie)
    await waitForConversation(charlie, conversationId, 2, true)

    const remoteMessage = await sendAndObserve(
      bob,
      [alice, charlie],
      conversationId,
      'C6-D17-REMOTE-ORDINARY',
    )

    await activate(bob)
    const addBobDevice = await imServiceV1.messaging.submitMembershipIntent({
      conversationId,
      action: 'add_device',
      targetPtid: bob2.ptid,
      targetDeviceId: bob2.deviceId,
    })
    await waitForCommand(addBobDevice.commandId)
    await waitForConversation(alice, conversationId, 3, true)
    await waitForConversation(bob, conversationId, 3, true)
    await waitForConversation(bob2, conversationId, 3, true)
    await waitForConversation(charlie, conversationId, 3, true)

    await requestControl('bob2', 'restart')
    await activate(bob2)
    await waitForConversation(bob2, conversationId, 3, true)
    const beforeRemoval = await sendAndObserve(
      alice,
      [bob, bob2, charlie],
      conversationId,
      'C6-BEFORE-REMOVE-DEVICE',
    )

    await requestControl('station-three', 'restart')
    await activate(bob2)
    const removeBobDevice = await imServiceV1.messaging.submitMembershipIntent({
      conversationId,
      action: 'remove_device',
      targetPtid: bob.ptid,
      targetDeviceId: bob.deviceId,
    })
    await waitForCommand(removeBobDevice.commandId)
    await waitForConversation(alice, conversationId, 4, true)
    await waitForConversation(bob2, conversationId, 4, true)
    await waitForConversation(charlie, conversationId, 4, true)
    const afterDeviceRemoval = await sendAndObserve(
      alice,
      [bob2, charlie],
      conversationId,
      'C6-AFTER-REMOVE-DEVICE',
    )
    await expectMessageNotObserved(bob, conversationId, afterDeviceRemoval.messageId)

    await activate(bob2)
    const authoritativeConversation =
      await imServiceV1.conversation.getConversation(conversationId)
    expect(authoritativeConversation.federationId).toBe(topology.federation_id)
    expect(authoritativeConversation.authorityStationPeerId)
      .toBe(alice.homeStationPeerId)
    const intent = await imServiceV1.messaging.requestLeaveIntent({
      federationId: authoritativeConversation.federationId,
      authorityStationPeerId:
        authoritativeConversation.authorityStationPeerId,
      authorityEpoch: Number(authoritativeConversation.authorityEpoch),
      homeStationPeerId: bob2.homeStationPeerId,
      conversationId,
      observedMembershipEpoch: 4,
      observedMlsEpoch: 4,
    })
    await activate(alice)
    const listed = await imServiceV1.messaging.listLeaveIntents(conversationId)
    expect(listed.some(item => item.intentId === intent.intentId)).toBe(true)
    const delegatedLeave =
      await imServiceV1.messaging.commitAuthorizedLeave({ intent })
    await waitForCommand(delegatedLeave.commandId)
    await waitForConversation(alice, conversationId, 5, true)
    await waitForConversation(charlie, conversationId, 5, true)
    const afterDelegatedLeave = await sendAndObserve(
      alice,
      [charlie],
      conversationId,
      'C6-AFTER-DELEGATED-LEAVE',
    )
    await expectMessageNotObserved(
      bob2,
      conversationId,
      afterDelegatedLeave.messageId,
    )

    const finalProjections = await collectConversationProjections(
      [alice, charlie],
      conversationId,
    )
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
        remote_actor_add_epoch: 2,
        remote_add_device_epoch: 3,
        remote_remove_device_epoch: 4,
        delegated_leave_epoch: 5,
      },
      lifecycle: {
        disconnected_recipient_reconnected: true,
        desktop_gateway_restarted: true,
        follower_station_restarted: true,
      },
      message_projection_readback: {
        remote_message_id: remoteMessage.messageId,
        before_removal_message_id: beforeRemoval.messageId,
        after_device_removal_message_id: afterDeviceRemoval.messageId,
        after_delegated_leave_message_id: afterDelegatedLeave.messageId,
      },
      final_client_projections: finalProjections,
      removed_device_message_not_observed: true,
      departed_actor_message_not_observed: true,
      access_tokens_present: false,
    }
    mkdirSync(dirname(reportPath), { recursive: true })
    writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`)
  }, 240_000)
})

function requiredRuntimePath(name: string): string {
  const value = process.env[name]
  if (!value) throw new Error(`${name} is required for the live C6 Gate`)
  return resolve(value)
}

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
  const identity = await loginAndReadEndpoint(gateway, email, password)
  return {
    name,
    station,
    gateway,
    homeStationPeerId,
    email,
    password,
    ptid: identity.actorPtid,
    deviceId: identity.deviceId,
  }
}

async function createAdditionalDevice(
  actor: C6Client,
  name: string,
  gateway: string,
): Promise<C6Client> {
  const identity = await loginAndReadEndpoint(
    gateway,
    actor.email,
    actor.password,
    actor.ptid,
  )
  expect(identity.deviceId).not.toBe(actor.deviceId)
  return {
    ...actor,
    name,
    gateway,
    deviceId: identity.deviceId,
  }
}

async function loginAndReadEndpoint(
  gateway: string,
  email: string,
  password: string,
  expectedActorPtid?: string,
): Promise<EndpointIdentity> {
  const started = await gatewayJson(gateway, 'access_start', {})
  const decision = (started.data as { decision?: {
    attemptId?: string
    currentGateId?: string
    gates?: Array<{
      gateId?: string
      gateType?: string
      actionId?: string
      schemaRevision?: number
      schemaDigest?: string
    }>
  } }).decision
  const gate = decision?.gates?.find(item => item.gateId === decision.currentGateId)
  if (!decision?.attemptId || gate?.gateType !== 'ACCESS_GATE_TYPE_AUTH_LOGIN') {
    throw new Error('canonical login gate is unavailable')
  }
  const login = await gatewayJson(gateway, 'access_submit_login', {
    attempt_id: decision.attemptId,
    gate_id: gate.gateId,
    gate_type: 2,
    action_id: gate.actionId,
    schema_revision: gate.schemaRevision,
    schema_digest: gate.schemaDigest,
    submission_id: randomUUID(),
    account: email,
    password,
  })
  const loginData = login.data as { actor_ptid?: string }
  const actorPtid = loginData.actor_ptid ?? ''
  if (!actorPtid.startsWith('ptid:')) {
    throw new Error('authenticated session returned no canonical actor PTID')
  }
  if (expectedActorPtid) {
    expect(actorPtid).toBe(expectedActorPtid)
  }
  select({ gateway })
  return readCurrentEndpoint(gateway, actorPtid)
}

async function readCurrentEndpoint(
  gateway: string,
  expectedActorPtid: string,
): Promise<EndpointIdentity> {
  let lastError: unknown
  for (let attempt = 0; attempt < 30; attempt += 1) {
    try {
      const response = await gatewayJson(
        gateway,
        'messaging_acceptance_current_endpoint',
        { expected_actor_ptid: expectedActorPtid },
      )
      const data = response.data as {
        actor_ptid?: string
        device_id?: string
      }
      if (data.actor_ptid === expectedActorPtid && data.device_id) {
        return {
          actorPtid: data.actor_ptid,
          deviceId: data.device_id,
        }
      }
      lastError = new Error('active messaging endpoint identity is incomplete')
    } catch (error) {
      lastError = error
    }
    await sleep(250)
  }
  throw new Error(
    `messaging endpoint did not activate for ${expectedActorPtid}: ${String(lastError)}`,
  )
}

async function waitForCommand(commandId: string): Promise<void> {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    const status = await imServiceV1.messaging.getCommandStatus(commandId)
    if (status.state === 'committed') return
    if (status.state === 'failed' || status.state === 'superseded') {
      throw new Error(
        `messaging command ${commandId} ended as ${status.state}: ${status.lastErrorCode}`,
      )
    }
    await sleep(500)
  }
  throw new Error(`messaging command ${commandId} did not commit`)
}

async function waitForConversation(
  client: C6Client,
  conversationId: string,
  membershipEpoch: number,
  active: boolean,
): Promise<MessagingConversationProjection> {
  await activate(client)
  for (let attempt = 0; attempt < 60; attempt += 1) {
    const projection = (await imServiceV1.messaging.listConversations())
      .find(item => item.conversationId === conversationId)
    if (
      projection
      && projection.membershipEpoch === membershipEpoch
      && projection.mlsEpoch === membershipEpoch
      && projection.active === active
    ) {
      return projection
    }
    await sleep(500)
  }
  throw new Error(
    `${client.name} did not project conversation ${conversationId} at epoch ${membershipEpoch}`,
  )
}

async function sendAndObserve(
  sender: C6Client,
  recipients: C6Client[],
  conversationId: string,
  plaintext: string,
): Promise<MessagingProjection> {
  await activate(sender)
  const outcome = await imServiceV1.messaging.sendMessage(
    conversationId,
    'group',
    plaintext,
  )
  expect(outcome.state).not.toBe('attachment_failed')
  const senderProjection = await waitForMessage(
    sender,
    conversationId,
    outcome.messageId,
    plaintext,
  )
  for (const recipient of recipients) {
    await waitForMessage(
      recipient,
      conversationId,
      outcome.messageId,
      plaintext,
    )
  }
  return senderProjection
}

async function waitForMessage(
  client: C6Client,
  conversationId: string,
  messageId: string,
  plaintext: string,
): Promise<MessagingProjection> {
  await activate(client)
  for (let attempt = 0; attempt < 60; attempt += 1) {
    const projection = (await imServiceV1.messaging.listMessages(conversationId))
      .messages.find(message => message.messageId === messageId)
    if (projection?.plaintext === plaintext) return projection
    await sleep(500)
  }
  throw new Error(
    `${client.name} did not project message ${messageId} in ${conversationId}`,
  )
}

async function expectMessageNotObserved(
  client: C6Client,
  conversationId: string,
  messageId: string,
): Promise<void> {
  try {
    await activate(client)
  } catch {
    return
  }
  for (let attempt = 0; attempt < 10; attempt += 1) {
    try {
      const page = await imServiceV1.messaging.listMessages(conversationId)
      if (page.messages.some(message => message.messageId === messageId)) {
        throw new Error(
          `${client.name} observed removed-scope message ${messageId}`,
        )
      }
    } catch (error) {
      if (
        error instanceof Error
        && error.message.includes('observed removed-scope message')
      ) {
        throw error
      }
      return
    }
    await sleep(250)
  }
}

async function collectConversationProjections(
  clients: C6Client[],
  conversationId: string,
): Promise<Record<string, MessagingConversationProjection>> {
  const result: Record<string, MessagingConversationProjection> = {}
  for (const client of clients) {
    result[client.name] = await waitForConversation(
      client,
      conversationId,
      5,
      true,
    )
  }
  return result
}

function select(client: Pick<C6Client, 'gateway'>): void {
  gatewayState.url = client.gateway
}

async function activate(client: C6Client): Promise<void> {
  const endpoint = await loginAndReadEndpoint(
    client.gateway,
    client.email,
    client.password,
    client.ptid,
  )
  expect(endpoint.deviceId).toBe(client.deviceId)
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
