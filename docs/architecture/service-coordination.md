# Service Coordination Map

> **Status**: active
> **Version**: v1.0
> **Created**: 2026-07-24 | **Updated**: 2026-09-21
> **Owner**: Architecture Team

---

## 1. Purpose

Defines the runtime coordination rules between Peers-Touch's first-class services: **Relay**, **Station**, **Desktop**, and **Mobile**. Answers:

- What does each service need from the others to function?
- In what order must services be brought up?
- What credentials/tokens flow between them and how are they obtained?

This is **not** an operational runbook (see `docs/knowledge/playbooks/` for step-by-step procedures). It defines the **contracts** that any operational automation (`make station`, `make desktop`, etc.) must satisfy.

---

## 2. Service Roles

| Service | Role | Runtime | Owner |
|---------|------|---------|-------|
| **Relay** | Federation message forwarding, DHT bootstrap seed hosting, inter-station routing | Go, Docker | Operator |
| **Station** | Core business logic, actor identity, data storage, federation governance | Go, Docker | Operator |
| **LiveKit** | Shared SFU media infrastructure for group voice/video calls | Go (Pion), Docker | Operator |
| **Desktop** | Client UI + Rust BFF (gateway), connects to one Station | Tauri + React/TS | End user |
| **Mobile** | Client UI + native plugins, connects to one Station | Tauri v2 Mobile | End user |

### 2.1 Station ↔ Relay Relationship

Relay is **not** a separate product — it is a Station capability configured via `RELAY_CLIENT_ENABLED=true`. When enabled, the Station registers ("mounts") itself with a Relay instance to gain cross-station message forwarding. A Station without relay-client enabled can still participate in DHT discovery but cannot forward resolve requests to remote stations.

### 2.2 Station ↔ LiveKit Relationship

LiveKit Server is **shared media infrastructure** — one instance serves all
Stations in a deployment cluster. It is NOT co-located 1:1 with each Station.

Deploy LiveKit on one host (e.g. the Relay host or a dedicated media host),
then point every Station at it via `LIVEKIT_API_URL` and
`LIVEKIT_PUBLIC_URL`. Use
`--profile livekit` on the host that runs it; other hosts only set
`LIVEKIT_API_URL`/`LIVEKIT_PUBLIC_URL`/`LIVEKIT_API_KEY`/
`LIVEKIT_API_SECRET` in their Station env.

**Station does NOT handle media.** Station's `groupcall` subserver only:

1. Validates group membership before granting room access.
2. Creates LiveKit rooms and generates participant JWTs via `server-sdk-go`.
3. Receives LiveKit webhook callbacks for room lifecycle events.
4. Publishes `ROOM_ACTIVE` / `ROOM_ENDED` SSE notifications to group members.

Desktop connects to LiveKit directly via `@livekit/livekit-client` using the
URL and token returned by Station's `POST /group-call/join`.

**Deployment topology**:

```
LiveKit host (shared)              Station-2          Station-4
┌──────────────────┐          ┌──────────────┐   ┌──────────────┐
│  LiveKit :7880   │◄─────────│  Station     │   │  Station     │
│ RTC TCP/UDP :7881│◄─────────│  :18080      │   │  :18080      │
└────────┬─────────┘          └──────────────┘   └──────────────┘
  webhook│                          ▲                    ▲
  POST   │     ┌────────────────────┘                    │
         ▼     │                                         │
   LIVEKIT_WEBHOOK_URL                              Desktop B
   → Station-N:18080/hooks/livekit              (ws://lk-host:7880)
```

**TURN reuse**: LiveKit's built-in TURN is disabled (`turn.enabled: false`).
Station already runs a Pion TURN subserver on `:3478`. Group call
participants obtain ICE servers from the same `/api/v1/turn/ice-servers`
endpoint as 1v1 calls.

**Secrets**: `LIVEKIT_API_KEY` and `LIVEKIT_API_SECRET` are shared across
the LiveKit container and all Station containers that use it. Generate one
pair per cluster.

**Webhook routing**: LiveKit sends room lifecycle webhooks to
`LIVEKIT_WEBHOOK_URL`. In multi-Station setups, each Station that creates
a room receives the webhook (LiveKit supports multiple webhook URLs in
`livekit.yaml`). For single-Station deployments, set it to that Station.

See `docs/architecture/realtime/group-call-architecture.md` for the full
design.

---

## 3. Dependency DAG

```
┌─────────────────────────────────────────────────────────────────┐
│                    Bootstrap Order (bottom-up)                    │
├─────────────────────────────────────────────────────────────────┤
│                                                                   │
│   1. Relay (must be running first)                               │
│      ├── Exposes: HTTP API (:18081), Stream port (:4501),        │
│      │            libp2p DHT (:4001)                             │
│      └── Provides: invite-token generation for new stations      │
│                                                                   │
│   2. LiveKit (shared; readied by its designated host profile)    │
│      ├── Exposes: HTTP/WS (:7880), RTC TCP/UDP mux (:7881)      │
│      ├── Needs from Station: webhook URL (http://station:18080   │
│      │                       /hooks/livekit)                     │
│      └── Provides: SFU rooms, media forwarding, simulcast,      │
│                     active speaker, reconnection                 │
│                                                                   │
│   3. Station (depends on Relay for federation,                   │
│      │         depends on LiveKit for group calls)               │
│      ├── Needs from Relay: invite-token → mount → relay_token    │
│      ├── Needs from DHT: bootstrap-nodes multiaddrs              │
│      ├── Needs from LiveKit: API_URL, PUBLIC_URL, key + secret   │
│      ├── Exposes: HTTP API (:18080), libp2p (:4001/:4002),       │
│      │            SSE events stream                              │
│      └── Provides: actor identity, session tokens, federation    │
│                     resolve, data APIs, group-call tokens        │
│                                                                   │
│   4. Desktop / Mobile (depends on Station)                       │
│      ├── Needs from Station: URL + session token                 │
│      ├── Needs from LiveKit: WS URL + token (via Station)        │
│      ├── Needs from Relay: nothing directly (Station proxies)    │
│      └── Provides: user interface, local cache                   │
│                                                                   │
└─────────────────────────────────────────────────────────────────┘
```

---

## 4. Credential Contracts

### 4.1 Relay Invite → Station Mount

| Step | Actor | Action | Artifact |
|------|-------|--------|----------|
| 1 | Operator | Generate invite on Relay | `invite-token` (one-time) |
| 2 | Station | Present invite-token at mount | `relay_token` (long-lived, cached at `data/relay_token`) |
| 3 | Station | Periodic heartbeat to Relay | Keeps mount alive |

**Key rules:**
- First mount requires an `invite-token` from the Relay operator
- Subsequent restarts reuse the cached `relay_token` — no invite needed
- If `relay_token` is lost (DB reset, fresh deploy), a new invite is required
- The profile field `PT_RELAY_INVITE_TOKEN` supplies the invite for automated first-mount

### 4.2 DHT Bootstrap Nodes

| Field | Source | Consumer |
|-------|--------|----------|
| `PEERS_BOOTSTRAP_NODES` | Relay/seed operator publishes multiaddrs | Station Docker env |

**Key rules:**
- Every Station must have at least one bootstrap node to join the DHT
- Bootstrap nodes are typically Relay instances (they run a persistent DHT)
- Format: `/ip4/<host>/tcp/<port>/p2p/<peer-id>` (comma-separated for multiple)
- Without bootstrap nodes, the Station's DHT remains empty → federation resolve fails

### 4.3 Station → Desktop/Mobile

| Field | Source | Consumer |
|-------|--------|----------|
| `PT_STATION_URL` | Profile config | Desktop/Mobile gateway |
| `station_peer_id` | Signed Station handshake | Desktop/Mobile identity scope |
| Session token | Login flow (access gate → auth) | All subsequent API calls |
| SSE cursor | Event stream connection | Realtime updates |

### 4.4 Station Identity Handshake

This target contract was accepted with the Mobile Shell PRODUCT/DESIGN package
on 2026-08-27. Model/Station protocol work remains an implementation
requirement.

`PT_STATION_URL` and user-entered URLs are connection hints, not Station
identity. Before auth, a client sends a cryptographically random 32-byte
challenge and receives:

- deterministic protobuf bytes for a statement containing the exact challenge,
  stable `station_peer_id`, normalized canonical origin, UTF-8-byte-sorted
  capability IDs, issue time, and expiry;
- the marshalled libp2p Ed25519 host public key;
- a host-key signature over
  `"peers-touch/station-identity/v1\0" || deterministic_protobuf(statement)`.

The client derives the PeerID from the public key, verifies equality with the
signed `station_peer_id`, verifies the signature, requires a signed lifetime no
longer than 60 seconds, and permits at most 30 seconds of clock skew. Required
capabilities use subset matching; unknown capabilities are ignored.

The explicit first-add action pins the verified peer ID to the local Station
registry. OAuth attempts, sessions, caches, cursors, and durable commands are
scoped by `station_peer_id`, never by URL alone. A known URL returning another
peer ID fails closed and requires explicit Station replacement. Handshake HTTP
redirects are rejected. Host-key rotation changes the PeerID and also requires
explicit Station replacement; no URL alias or unrelated signing key proves
continuity.

The handshake contract is Proto-first. Development-only HTTP profiles may use
the same signature proof, but production credentials and OAuth callbacks require
TLS. Relay identity does not substitute for Station identity.

---

## 5. Profile Configuration Reference

A dev profile (`make profile-init`) must declare these cross-service bindings:

```bash
# Station location
PT_STATION_URL=http://<station-host>:18080

# Relay location (required for federation)
PT_RELAY_URL=http://<relay-host>:18081
PT_RELAY_DEPLOY_ENV=<relay-env-name>

# LiveKit SFU (required for group calls)
PT_LIVEKIT_URL=ws://<shared-livekit-host>:7880

# Federation DHT (Station Docker env must include these)
# PEERS_BOOTSTRAP_NODES=<multiaddr1>,<multiaddr2>,...
# PEERS_NODE_SERVER_BASEURL=http://<station-host>:18080
# RELAY_CLIENT_ENABLED=true
# RELAY_CLIENT_RELAY_URL=http://<relay-host>:18081
# RELAY_CLIENT_RELAY_STREAM_ADDR=<relay-host>:4501

# LiveKit SFU (Station Docker env — one shared cluster key pair)
# LIVEKIT_API_URL=http://<shared-livekit-host>:7880
# LIVEKIT_PUBLIC_URL=ws://<shared-livekit-host>:7880
# LIVEKIT_API_KEY=<openssl rand -hex 16>
# LIVEKIT_API_SECRET=<openssl rand -hex 32>
# LIVEKIT_NODE_IP=<shared-livekit-host>
# LIVEKIT_PORT=7880
```

---

## 6. `make station` Automation Contract

When `make station` runs, it MUST ensure:

1. **Stable dependencies are ready** — run the profile's
   `PT_DEPLOY_DEPENDENCIES_CMD` without `--build` or forced recreation.
   Docker Compose creates or starts missing dependencies and reuses unchanged
   running containers. The designated media host includes `livekit`; every
   Station host includes its project-scoped `postgres`.
2. **Station binary is current and healthy** — build Station, then recreate
   only Station with `docker compose up -d --no-deps station`.
3. **DHT bootstrap** — Station has `PEERS_BOOTSTRAP_NODES` configured and reaches `ready=true` within 30s
4. **Relay mount** — If relay is declared in profile:
   - Check if Station already has a valid `relay_token` (heartbeat succeeds)
   - If not: check for `PT_RELAY_INVITE_TOKEN` in profile → auto-mount
   - If no invite available: warn operator with instructions to obtain one

Current gap: step 3 is not yet automated. Manual invite generation is required for first-time station-relay binding.

---

## 7. Troubleshooting Index

| Symptom | Likely cause | Check |
|---------|-------------|-------|
| `resolver: relay-client not registered` | Station has no relay_token | Check logs for "could not acquire relay token" |
| `federation health: seeds=0` | Missing `PEERS_BOOTSTRAP_NODES` in Station Docker env | `curl <station>/actor/federation/health` |
| `federation health: ready=false` | DHT bootstrap failed or seeds unreachable | Check network between Station and seed addresses |
| Desktop "unknown command: federation_*" | Gateway missing route | Ensure Rust gateway has federation commands |
| Login succeeds then returns to login | Station session expired (redeploy cleared sessions) | Re-login with password (not PIN) |
| `groupcall: livekit CreateRoom failed` | LiveKit container not running or `LIVEKIT_API_URL` wrong | `docker compose ps livekit`, check `LIVEKIT_API_URL` env |
| `groupcall: token generation failed` | `LIVEKIT_API_KEY`/`LIVEKIT_API_SECRET` empty or mismatched | Verify env vars match between Station and LiveKit containers |
| `groupcall: webhook verification failed` | LiveKit webhook URL misconfigured or key mismatch | Check `LIVEKIT_CONFIG` webhook values and `LIVEKIT_KEYS` env |
| Desktop group call stuck on "Connecting" | LiveKit port `:7880` not reachable from Desktop | `curl ws://<host>:7880`, check firewall |
| Group call has no audio/video | LiveKit RTC media port blocked | Ensure `:7881/udp` and TCP fallback are open between peers and LiveKit host |

---

## 8. Generating a Relay Invite Token

```bash
# From the machine running the Relay container:
docker exec <relay-container> /app/peers-touch-station relay invite create --label "<station-name>"

# Or via Relay HTTP API (if exposed):
curl -X POST http://<relay-host>:18081/sub-relay/invites \
  -H "Content-Type: application/json" \
  -d '{"label": "<station-name>"}'
```

The returned token goes into the Station's Docker env as:
```bash
RELAY_CLIENT_INVITE_TOKEN=<token>
```

Then recreate the Station container (`docker compose up -d station`).

---

## 9. Cross-references

- Federation architecture: `docs/architecture/federation/README.md`
- Federation execution plan: `docs/architecture/federation/execution-plans/phase-1-federation-ledger.md`
- Group call architecture: `docs/architecture/realtime/group-call-architecture.md`
- Local dev environment: `docs/global/local-dev-environment.md`
- Profile system: `tooling/scripts/local-dev/profile.sh`
- Deploy system: `tooling/scripts/deploy/deploy.sh`
- LiveKit compose config: `tooling/docker/compose.yml` (station profile)
- LiveKit server config: `tooling/docker/compose.yml` (`LIVEKIT_CONFIG`)
- Mobile Station pinning and recovery:
  `docs/architecture/mobile/design.md`,
  `docs/architecture/mobile/data-model.md`
