# Desktop Group Admin E2E Acceptance Script

> **Status: SUPERSEDED / HISTORICAL — DO NOT EXECUTE**
>
> Superseded by
> `docs/architecture/api-ownership/execution-plans/20260906-conversation-authority-hard-cut.md`.
> All route examples, commands, matrices, evidence claims, and run instructions
> below are historical records only. They must not be used as current acceptance
> guidance or as alternatives to Conversation and resource-owned APIs.
>
> Scope: Desktop group detail, Station group admin APIs, realtime membership refresh, group sender-key rotation

## Purpose

This script verifies the Desktop implementation of P2 Group Admin Closure against real Station-backed behavior. It must be run with real Desktop clients, not mocked UI state.

## Preconditions

- Start one Station instance with realtime SSE enabled.
- Start at least three Desktop clients signed in as distinct actors:
  - `owner`: creates the group.
  - `admin`: promoted by owner.
  - `member`: ordinary member.
  - Optional `observer`: second ordinary member for cross-client refresh checks.
- Ensure all actors have published key-exchange bundles so group sender-key distribution can run.
- Open logs for Station and all Desktop clients.

## Verification Matrix

| Case | Actor | Action | Expected Station Result | Expected Desktop Result | E2EE / Realtime Check |
| --- | --- | --- | --- | --- | --- |
| Owner promotes admin | owner | Promote `admin` | `/group-chat/member/update` succeeds and member role becomes admin | Owner sees `Admin` badge for admin; admin client refreshes role | `UPDATED` membership event received by active clients |
| Admin removes member | admin | Remove `member` | `/group-chat/member/remove` succeeds | Member disappears from owner/admin rosters; member client leaves/clears active group | `REMOVED` event received; remaining members rotate sender key |
| Admin cannot manage admin | admin | Remove or mute another admin | Station returns permission denied | Button is locked or request fails with user-safe error | No roster mutation; no sender-key rotation |
| Admin cannot manage owner | admin | Remove or mute owner | Station returns owner-protected error | Owner row is locked with reason | No roster mutation |
| Member is read-only | member | Open group detail | No management mutation calls are available | Permission section says member; roster rows show lock/read-only state | No mutation event emitted |
| Owner transfers ownership | owner | Transfer owner to `admin` | `/group-chat/ownership/transfer` succeeds; old owner becomes admin | New owner sees owner permission; old owner loses dissolve permission | `TRANSFERRED` event received; sender key rotates |
| Old owner cannot dissolve after transfer | old owner | Try dissolve group | Station returns permission denied | UI no longer shows dissolve; API denial if stale UI exists | No dissolve event |
| New owner dissolves group | new owner | Dissolve group | `/group-chat/dissolve` succeeds | All clients remove/clear active group | `DISSOLVED` event received; clients stop sending |
| Group plaintext rejection | owner | Send group message with plaintext `content` only | Station returns bad request; encrypted payload send succeeds | Client send path must provide encrypted payload | Station never stores/sees plaintext group message bodies |
| Removed member cannot read/send | removed member | Refresh messages / send new group message | Station returns forbidden/not member | Client shows no active group and cannot send | Removed member cannot decrypt new post-removal messages |

## Step-By-Step Run

0. Run the Station-level gate first against the current worktree Station:
   `python3 tooling/acceptance/gates/chat/group_admin_e2e.py`.
   For a remote Station, set the URL explicitly:
   `CHAT_GROUP_ADMIN_STATION_URL=http://<station-host>:18180 python3 tooling/acceptance/gates/chat/group_admin_e2e.py`.
   To fail fast on a stale remote deployment, also set:
   `CHAT_GROUP_ADMIN_EXPECTED_BUILD=<commit-or-build-label>`.
0.1. After the manual multi-Desktop run, generate an evidence bundle:
   `CHAT_GROUP_ADMIN_DESKTOP_LOG_GLOB="<desktop-log-glob>" CHAT_GROUP_ADMIN_SCREENSHOT_DIR=<screenshot-dir> python3 tooling/acceptance/gates/chat/desktop_group_admin_evidence.py`.
   For blocking acceptance, add `CHAT_GROUP_ADMIN_REQUIRE_ARTIFACTS=1`; this fails if realtime/sender-key logs or required screenshots are missing.
1. Create a group as `owner` with `admin`, `member`, and optional `observer`.
2. Open Desktop group detail on `owner`; verify the permission card says owner and member rows show role badges.
3. Promote `admin`; verify both `owner` and `admin` clients refresh role labels without app restart.
4. As `admin`, remove `member`; verify `member` is removed from all rosters and `member` client clears the active group.
5. As `admin`, attempt to manage `owner` or another admin; verify UI lock reason and Station denial if invoked.
6. As `owner`, transfer ownership to `admin`; verify old owner becomes admin and new owner sees owner permission.
7. Send a group message from a remaining member after transfer; verify clients still in group decrypt it and removed member cannot.
8. As new owner, dissolve the group; verify all clients clear the active group and the group disappears from lists.
9. Attempt to list messages and send a group message as a removed/dissolved actor; verify Station denies access.

## Evidence To Capture

- Station logs for:
  - `/group-chat/member/update`
  - `/group-chat/member/remove`
  - `/group-chat/ownership/transfer`
  - `/group-chat/dissolve`
- Desktop logs for realtime events:
  - `UPDATED`
  - `REMOVED`
  - `TRANSFERRED`
  - `DISSOLVED`
- Desktop logs for `rotateGroupSenderChain` after removal and transfer.
- Screenshots of:
  - Owner permission card.
  - Admin permission card.
  - Member read-only permission card.
  - Locked owner/admin member rows.
- Evidence report from `tooling/acceptance/gates/chat/desktop_group_admin_evidence.py`, stored under `artifacts/acceptance/group-admin` by default.

## Current Automated Coverage

- `tooling/acceptance/gates/chat/group_admin_e2e.py` covers the real Station HTTP contract for create group, encrypted group send, plaintext body rejection, promote admin, remove member, denied admin/member actions, nickname update, ownership transfer, dissolve, and read/send denial after removal/dissolve.
- `tooling/acceptance/gates/chat/group_admin_e2e.py` reads `/app-meta/version` before mutating data so remote runs expose the Station build commit/label.
- `tooling/acceptance/gates/chat/desktop_group_admin_evidence.py` runs the Station gate and emits a JSON report for Desktop logs/screenshots; with `CHAT_GROUP_ADMIN_REQUIRE_ARTIFACTS=1` it becomes a blocking semi-automated Desktop evidence gate.
- Station application permission matrix covers owner/admin/member mutations.
- Station handler tests cover create-with-initial-members owner/member role projection, transfer ownership, dissolve group, and nickname update.
- Desktop `eventStream` tests cover `TRANSFERRED` and `DISSOLVED` decode.
- Desktop `socialRealtime` tests cover sender-key rotation after `REMOVED`, `LEFT`, and `TRANSFERRED`, and active group clearing after `DISSOLVED`.
- Desktop permission tests cover member action visibility for owner/admin/member/self.

## Latest Gate Evidence

- PASS `CHAT_GROUP_ADMIN_EXPECTED_BUILD=local-p2-probe python3 tooling/acceptance/gates/chat/group_admin_e2e.py` on 2026-06-24 against a local Station built from the current worktree with sqlite local config, including build-label validation, plaintext group body rejection, and encrypted payload send success.
- PASS local DB-backed regression `TestCreateGroupProjectsOwnerMembershipRoleWithDB`, proving current GORM create/list member projection writes the creator as `GROUP_ROLE_OWNER`.
- BLOCKED remote gate `CHAT_GROUP_ADMIN_STATION_URL=http://10.37.94.156:18180 python3 tooling/acceptance/gates/chat/group_admin_e2e.py`: created group owner member row is returned as `GROUP_ROLE_MEMBER`. Current evidence points to remote deployment/version or remote data-path mismatch rather than the current worktree DB path.
