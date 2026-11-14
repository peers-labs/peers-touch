---
kind: playbook
title: Desktop Debug Runtime and Qualified Native Chooser
status: active
owns:
  - AGENTS.md
  - apps/desktop/
  - apps/applets/
  - tooling/scripts/applet-
  - tooling/acceptance/
referenced-by:
  - AGENTS.md
related:
  - docs/client/desktop/runtime-projections.md
  - docs/architecture/engineering/acceptance/decisions.md
detected: 2026-10-24
---

# Desktop Debug Runtime

## When to use

Use for live Desktop behavior, applet and page lifecycle, or Native Acceptance
observations. Packaging is reserved for explicitly requested release,
installer, signing, or package-only validation.

## Steps

1. Start development through `make desktop`; there is no Desktop browser shell.
   Do not use a manual `.app` launch or `tauri build` for ordinary debugging.
   Formal Acceptance uses its declared parent Runtime Cell and the canonical
   source-bound build producer. A prepared child consumes that executable;
   it does not build again or select an installed app.
   Launch profile selection is `PT_PROFILE` → last identity-verified profile
   (`<storage-root>/active-profile.json`) → `desktop`; an envless installed-app
   launch that empties the chat surface is a profile mismatch, not data loss —
   see `pitfalls/desktop-gui-launch-profile-pointer.md`.
2. Read the owning runtime/page contract before editing those surfaces.
   Keep the live runtime, logs and current-source identity available.
3. Use embedded WebDriver semantic input by default. Do not activate the app,
   move the physical pointer, redirect keyboard focus, or force window stacking.
4. A process-scoped macOS file chooser requires the parent Cell's real
   open/select/close/owned-stop qualification. Binding consumes the closed
   descriptor from the same source and Cell. Driver owns AX selection and
   operator sampling; shared picker owns visible triggering and closure.
   Use the Driver's shared exact-PID panel finder to observe absent/present/
   absent. Do not infer native panel state from AX window or sheet counts.
   Preserve one prelaunch operator baseline across all sampled phases.
   A mismatch stays failed even if the operator later returns.
5. Permission sheets, physical hover/drag, focus and global-input chooser
   mechanisms require `exclusive-native-input` in a reviewed
   `isolated-gui-session`. A Profile or platform name cannot supply isolation.
6. Keep equipment, framework checks, product Journey and formal Acceptance
   evidence distinct. Native panel selection alone does not prove receiver
   content or product closure. Product assertions remain with their Gate.
7. Release only owned processes, staging directories, storage and leases.
   Diagnose cleanup failure before further dispatch.

## Station Candidate Catalog (login surface)

The login Station switcher renders one candidate catalog built from three
source tiers, ordered by proximity to the local runtime
(architecture decision NCP-D22..D24, module `node-connectivity`):

1. `environment` — the Profile/environment-repository Station, delivered through
   the source-tagged `PEERS_PROFILE_STATION_URL` that `tooling/devctl/desktop.mjs`
   derives from the selected Profile's `PT_STATION_URL`. Packaged builds never
   set this tier.
2. `injected` — a process-level `PEERS_STATION_URL` supplied by a shell,
   operator/MDM launch, or an E2E/Acceptance harness.
3. `xconfig` — direct-Station suggestions from the accepted signed snapshot.

Ordering is `environment > injected > xconfig`; identical normalized origins
collapse into one row keeping the highest-priority source label. Verified
registry entries never reappear as suggestions.

Operational rules:

- No candidate is preselected. On a clean Profile storage the picker shows the
  Profile Station as the first suggestion and waits for a click.
- Selecting any candidate runs signed discovery (`station_add` for local tiers,
  `x_config_discover_suggestion` for cloud). Only verified routes enter
  `stations.json`; an environment variable can never bypass discovery or extend
  auth identity-migration origins (NCP-D23).
- After the first explicit selection the active Station id persists in
  `stations.json` and is restored automatically on later launches; no second
  click is needed. Removing the active Station returns to the unpicked catalog.
- X Config being unavailable never blocks the local catalog; cloud rows simply
  stay absent or nonactionable.

Quick triage when `make desktop` still shows "No stations configured":

```bash
# Is the Profile channel actually exported to the running app?
pgrep -af peers-touch | tr ' ' '\n' | grep PEERS_PROFILE_STATION_URL
# Read-only projection of the two local tiers (no discovery, no storage write)
# through the station_local_candidates command; the renderer catalog merges it
# with station_list and the x_config projection.
```

If the variable is missing, the machine registry is not bound to the expected
Profile — fix the Profile binding, not the client. If it is present but the row
is missing, check origin normalization (http/https only, trailing slash trimmed).

## Verification

Run the focused source and Driver/Cell checks, then the exact-source native
Journey. Inspect current Cell/run/source/binary binding, actual native window,
file identity, panel closure, distinct operator PID and unchanged operator
pointer/focus through owned stop. Reject stale descriptors, missing phases,
restored baselines, hidden windows and any physical fallback in semantic mode.

Use `test_file_chooser_qualification`, `test_native_desktop_macos`,
`test_native_runtime_binding` and `native_file_picker_test` for synthetic
contract coverage. Their PASS is framework evidence only.

## Crosswalks

- Pitfall `desktop-gui-launch-profile-pointer` — why an envless GUI launch must
  resolve the last identity-verified profile instead of the hardcoded
  `desktop` fallback, and how to diagnose continuity conflicts.
