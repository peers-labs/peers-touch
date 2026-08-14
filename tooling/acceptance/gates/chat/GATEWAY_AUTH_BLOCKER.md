# Chat Gateway Auth Blocker Report

> **Status**: active-blocker
> **Created**: 2026-08-15
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
| `desktop_gateway_e2e.py` (existing) | ❌ FAIL — auth_login blocked |
| `friend_request_gateway_e2e.py` (new) | ❌ FAIL — auth_login blocked |
| `group_chat_gateway_e2e.py` (new) | ❌ FAIL — auth_login blocked |
| `group_chat_station_e2e.py` (new) | ✅ PASS — no gateway needed |
| `realtime_sse_e2e.py` (new) | ✅ PASS — no gateway needed |
| `runtime_e2e.py` (existing) | ✅ PASS — Station direct |

## Resolution Options

1. **Upgrade remote Station** to include the access gate subserver (requires deployment)
2. **Start a local Station** from this worktree that includes the access gate flow
3. **Add a test-only gateway auth bypass** (not recommended for production binary)
4. **Use the Station at 10.37.118.48:18080** which does support access gate (currently unreachable/slow from this machine)

## Recommended Resolution

Start a **local Station** from the `peers-group-chat` worktree:
```bash
cd apps/station && go run . --config config/local.yaml
```
This would have both the access gate flow AND all group-chat/friend-chat APIs,
enabling full gateway E2E testing.

## Workaround (current)

Station-direct gates (`group_chat_station_e2e.py`, `realtime_sse_e2e.py`,
`runtime_e2e.py`) validate the same business logic without the gateway auth
dependency. Gateway-level coverage is deferred until the Station auth
compatibility is resolved.
