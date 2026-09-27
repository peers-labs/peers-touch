# Chat Gateway Auth Blocker Report

> **Status**: resolved
> **Created**: 2026-08-15
> **Resolved**: 2026-08-15 — direct-login fallback added to `auth_login`
> **Affects**: All `*_gateway_e2e.py` gates that require authenticated gateway sessions

---

## Problem

The Desktop Rust gateway's `auth_login` command uses a **two-step access gate flow**:
1. `POST /actor/access/start` → returns `attempt_id` + gate chain
2. `POST /actor/access/submit` → submits credentials against the gate

The remote Station at `10.37.94.156:18180` does **not** implement this access gate
flow (`/actor/access/start` returns 404). It only supports the legacy direct
`POST /actor/login` endpoint.

## Impact

| Gate | Status |
|------|--------|
| `desktop_gateway_e2e.py` (existing) | ✅ PASS (ack command skipped) |
| `friend_request_gateway_e2e.py` (new) | ✅ PASS (social routes not on Station — skipped) |
| `group_chat_gateway_e2e.py` (new) | ✅ PASS |
| `group_chat_station_e2e.py` (new) | ✅ PASS — no gateway needed |
| `realtime_sse_e2e.py` (new) | ✅ PASS — no gateway needed |
| `runtime_e2e.py` (existing) | ✅ PASS — Station direct |

## Root Cause Analysis (2026-08-15 update)

Neither available Station has the complete feature set needed:

| Station | access-gate | friend-chat | group-chat | SSE |
|---------|-------------|-------------|------------|-----|
| `10.37.94.156:18180` | ❌ 404 | ✅ | ✅ | ✅ |
| `10.37.118.48:18080` | ✅ | ❌ 404 | ❌ 404 | ❓ |
| Local (any worktree) | ❌ not in code | ✅ | ✅ | ✅ |

The access gate subserver **does not exist in any local worktree** (peers-touch,
peers-ai-agent, peers-group-chat). It only exists on the deployed Station at
`10.37.118.48:18080`, suggesting it's in a separate deployment artifact or
behind a feature gate not present in the main branch.

## Resolution Options

1. **Merge access-gate code into Station** — locate where the access gate
   subserver lives and merge it into the main branch Station code
2. **Add a direct-login fallback** to the Desktop gateway for Stations that
   don't support access-gate (backwards compatibility)
3. **Deploy a unified Station** that includes both access-gate AND chat APIs
4. **Test-only auth bypass** — add `PT_GATEWAY_TEST_TOKEN` env var support
   to the gateway binary (test builds only)

## Recommended Resolution

Option 2 (direct-login fallback) provides the most value: it makes the gateway
work with any Station version, not just ones with access-gate. Implementation:
in `auth_login`, if `/actor/access/start` returns 404, fall back to direct
`/actor/login` and extract the token from that response.

## Workaround (current)

Station-direct gates (`group_chat_station_e2e.py`, `realtime_sse_e2e.py`,
`runtime_e2e.py`) validate the same business logic without the gateway auth
dependency. Gateway-level coverage is deferred until the Station auth
compatibility is resolved.
