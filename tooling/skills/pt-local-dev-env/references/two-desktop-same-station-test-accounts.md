# Two Desktop Clients, Same Station — Test Accounts & Messaging E2E

Use this when you must verify IM messaging between two users end-to-end on one
Station. Two accounts on the **same** Station take the same-Station send
short-circuit and need no cross-Station federation; accounts on different
Stations require an active federation membership and otherwise fail with
`409 CONVERSATION_FEDERATION_STATION_INACTIVE`.

## 1. Why a second instance is possible

The desktop Tauri app has **no single-instance plugin**, so several
`peers-touch-desktop` binaries can run at once. Each instance must be isolated
on three axes, otherwise they collide:

| Axis | Env var | Why it must differ |
| --- | --- | --- |
| Storage root | `PEERS_STORAGE_ROOT` | Separate identities, sessions, DBs, caches |
| Local gateway port | `PT_GATEWAY_PORT` (+ `PT_DESKTOP_APP_GATEWAY_PORT`) | Only one process may bind a loopback port |
| AppKit identity | `TAURI_CONFIG.identifier` | Same bundle id makes AppKit conflate the two windows/Dock/AX representations |

Both instances point at the **same** `PEERS_STATION_URL` so the accounts are
same-Station peers. They can share one Vite dev server (the debug binary reads
its frontend from the `TAURI_CONFIG.build.devUrl` override).

## 2. Seed Station trust into a fresh storage root

A brand-new `PEERS_STORAGE_ROOT` has no verified Station, so the gateway returns
`Station identity has not been verified`. Copy the Station trust material from
an existing root — it holds only the pinned Station root key and routes, never
account tokens/sessions:

```text
<existing-root>/peers-touch/<profile>/config/stations.json
  -> <fresh-root>/peers-touch/<profile>/config/stations.json
```

`stations.json` contains no `token` / `session` / `password` / `ptid` fields.

## 3. Create a test account on the Station

The access login gate does **not** auto-register unknown emails (it returns
`400 user not found`). Register first against the public Station endpoint
`POST <station>/actor/sign-up` with JSON `{ "name", "email", "password" }`:

- `name`: 5–20 chars, lowercase letters / digits / `.` `_` `-`.
- `password`: 8–20 chars and must include letters, digits, **and a symbol**
  (e.g. `Test1234!`). A bare `1` only works for fixture-seeded accounts because
  fixtures bypass public signup validation.

## 4. Establish each session through the local gateway

The gateway speaks `POST http://127.0.0.1:<PT_GATEWAY_PORT>/` with body
`{ "cmd": "<command>", "args": { "input": { ... } } }`.

1. `access_start` → read `decision.attemptId`; a dev Station without an invite
   gate goes straight to `auth.login`.
2. `access_submit_login` with `account` / `password`, the `attemptId`,
   `gate_id:"auth.login"`, `gate_type:2`, and the schema fields from the gate.
3. A successful response returns `status:"authenticated"` and persists the
   session under the instance's `PEERS_STORAGE_ROOT`.

## 5. Session-uniqueness rule (important)

The Station enforces a single active session per actor. The webview window
session and the headless HTTP-gateway session are separate registrations;
calling gateway `auth_restore_session` (or a second login) **while the webview
is running rotates the token and surfaces a "Session ended" modal** in the UI.

Safe sequence:

1. Do all headless `access_*` calls while no competing webview login is active.
2. Restart the instance so its webview bootstraps the freshly persisted session.
3. After restart, never call gateway `auth_restore_session` again for that actor.

If a "Session ended" modal appears, re-run `access_submit_login` once and
restart the instance.

## 6. Launch detached so it survives the shell

A backgrounded binary launched from a tool shell is reaped with the process
group unless it becomes its own session leader. Launch with a new session
(Python `subprocess.Popen(..., start_new_session=True)` or an equivalent
`setsid`-style detach), redirecting all std streams.

The two launchers used in practice live outside the repo under the worktree
debug workspace (e.g. `launch-first-instance.sh`, `launch-second-instance.sh`)
because debug launch helpers must not be committed.

## 7. What can and cannot be automated headlessly

- Account signup, login, actor search (`actor_search_actors`) work over the
  gateway once a session is bound.
- The messaging engine is owned by the webview runtime; a headless gateway call
  to `messaging_create_direct` returns `messaging engine not active` until the
  chat surface has bootstrapped in the UI.
- Synthetic CG mouse events and the AX tree do not reliably reach WKWebView
  content in a sandboxed agent shell. Final GUI steps (open the contact, type,
  send, confirm receipt on the other window) are performed by a human at the
  machine; both windows are already logged in and positioned side by side.

## 8. Verify

- Two `peers-touch-desktop` processes exist, each with its own
  `PT_GATEWAY_PORT` listening and its own `PEERS_STORAGE_ROOT`.
- Both windows reach the ready chat surface (window resizes to the ready
  geometry) and show different rail avatars/identities.
- `actor_search_actors` from the first account resolves the second account with
  the same `homeStationPeerId` (same-Station, no federation required).
- A message sent from one window appears in the other without a 409.

## 9. Cleanup

Stop both instance process groups, remove the temporary fresh storage root and
the in-workspace debug launchers, and confirm both gateway ports are released.
Do not leave extra Station accounts or debug artifacts referenced in the repo.
