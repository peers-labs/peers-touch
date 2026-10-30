---
name: pt-desktop-trial-packaging
description: Build an unsigned Desktop trial DMG with the existing distribution toolchain (make package + flavor/channel registries) and publish it to a minimal read-only HTTP download service on the SAME host as a given profile's Station. Use when handing a trial Desktop build to an internal user/friend for a specific profile. Not for signed releases, the updater pipeline, GitHub Releases, Station docker installers, or Mobile.
---

# PT Desktop Trial Packaging

Trial-only Desktop distribution. It reuses two existing owners and adds no
build logic of its own:

- Identity/build: `make package` over `tooling/distribution` (flavors.json,
  channels.json, `package.mjs`).
- Profile-scoped hosting: `tooling/distribution/publish-trial.sh` +
  `desktop-install.template.sh`.

It is deliberately separate from the signed release train
(`tooling/distribution/release-lifecycle.mjs`, `pt-github-release`): trial
builds have no minisign signature, no updater artifacts, and never promote a
Release.

## Invoke When

- "Give a friend an installable Desktop build that connects to profile X."
- Publish/refresh an unsigned trial DMG on a profile's Station host.
- Diagnose the trial download URL / install script for that profile.

Do not invoke for: signed/public releases (use the release lifecycle +
`pt-github-release`), Station self-host installation (root `install.sh` +
`installer.py`), Mobile packages, or deploying/restarting Station itself.

## Required Discipline

- Scope is **Desktop DMG on macOS Apple Silicon (aarch64)**. The rendered
  installer uses `hdiutil`/`ditto`/`xattr` and `/Applications`; there is no
  Windows/Linux/Mobile trial installer.
- The download service runs on the **same host as the profile's Station**, but
  as an independent host-level systemd unit
  `pt-distribution-<profile>.service` (Python `http.server`, read-only, its own
  port). Never put it inside the Station container, the Station compose
  project, `/sub-oss`, or x-config. Never touch Station containers or data
  volumes.
- Build identity comes only from registered flavors/channels; do not invent
  identifiers or hand-edit a tauri config. Trial builds use an existing flavor
  (normally `geek`) with the target profile's `CHANNEL`.
- `make package` supports build-time targeting labels (`LABELS=k=v,...`) that
  the packaged client carries into x-config directive evaluation for generic
  config rollout. Labels are fail-closed per flavor (`allowed_labels`; only
  flavor `xx` admits them today). Read the owner doc before using them:
  `docs/architecture/platform/client/control-plane/execution-plans/20261023-distribution-targeted-config/plan.md`
  (XCFG-D04/D05/D06), with the registry contract in
  `tooling/distribution/flavors.mjs` and directive authoring in
  `pt-x-config-catalog-publish`. This skill only builds/hosts the bundle; it
  does not author directives.
- The DMG is unsigned. The install script's SHA-256 comparison is the only
  integrity gate, and it clears `com.apple.quarantine`. Tell the requester this;
  do not imply Gatekeeper/notarization approval.
- The host must allow passwordless sudo for the systemd unit install; preflight
  `sudo -n true` and stop with a precise message if it fails.
- The chosen port must be free on the host and reachable by the recipient
  (internal network/VPN). The recipient must also be able to reach the profile
  Station's `PT_STATION_URL`.
- If the channel snapshot has no `network.default_station` directive, the
  installed app cannot auto-discover Station; the recipient must enter the
  Station URL once via the login-surface StationPicker. State this when handing
  over the command.

## Workflow

1. **Resolve the target from the env repository**, never from memory:
   - `env/peers-touch/<profile>/profile.env.example` for `PT_STATION_URL`.
   - `env/peers-touch/<profile>/deploy/<profile>-station.env.example` for
     `PT_DEPLOY_HOST` and `PT_DEPLOY_USER`.
   - Choose one dedicated, collision-checked distribution port (e.g. corpstable
     Station HTTP 18280 → trial 18380).
2. **Plan the build, then build** from the product repository root:
   ```sh
   make package-dry-run PRODUCT=desktop FLAVOR=geek CHANNEL=<profile> TARGET=dmg
   make package PRODUCT=desktop FLAVOR=geek CHANNEL=<profile> TARGET=dmg
   # Add LABELS= only when the flavor admits them; see the targeted-config
   # plan in Required Discipline before using label-targeted trials.
   ```
   Inspect the dry-run manifest: `identifier`, `display_name`,
   `deep_link_scheme`, `x_config_origins`, `labels`, target=dmg. A requested
   label not in the flavor's `allowed_labels` must stop the build.
3. **Verify the actual DMG, not just the manifest**: mount the produced
   `apps/desktop/src-tauri/target/release/bundle/dmg/*.dmg`, then read the
   mounted `Info.plist` bundle id and confirm the executable is `arm64`.
   For a label-targeted build, verify label delivery per the targeted-config
   plan (baked compile-time identity is authoritative; the sidecar manifest is
   diagnostic only); do not claim targeting works from the sidecar alone.
   Known tauri-cli 2.0.1 limitation: a `--config` top-level `identifier`
   override may not reach `Info.plist`; when manifest and plist disagree, the
   plist is the OS truth — report the discrepancy, do not ship pretending the
   flavor id applied.
4. **Publish** (copy the DMG under a canonical name first if desired):
   ```sh
   sh tooling/distribution/publish-trial.sh \
     --profile=<profile> --host=<user>@<station-host> --port=<dist-port> \
     --dmg=<path-to.dmg> --version=<x.y.z> --commit=<short-sha>
   ```
   The script renders the installer with the DMG SHA-256, uploads to
   `~/.peers-touch/distribution/<profile>/releases/<version-commit>/`,
   atomically flips the `current` symlink, installs/restarts/enables the
   systemd unit, and verifies `/current/install.sh` is publicly readable.
5. **Hand over** the exact one-liner the script prints:
   ```sh
   curl -fL http://<station-host>:<dist-port>/current/install.sh -o peers-install.sh && sh peers-install.sh
   ```
   Include the Station URL caveat from Required Discipline when applicable.

## Verification

Before reporting done, with evidence:

- `make package-dry-run` manifest matches the requested flavor/channel.
- Mounted DMG contains the expected `.app`, plist identity inspected, `arm64`
  confirmed.
- For a label-targeted build: dry-run `labels` equals the request and every key
  is in the flavor's `allowed_labels`; labels are present in the baked binary
  identity (sidecar manifest is diagnostic only) and the channel catalog's
  matching directive evaluates as intended.
- Remote: `systemctl is-active`/`is-enabled pt-distribution-<profile>` are
  active/enabled and the port is listening.
- `curl -fL http://<host>:<port>/current/install.sh` returns 200 with the
  rendered SHA-256; downloading the DMG through that URL hashes to the same
  value.
- Station container status and its data volumes are unchanged.
- Report the DMG as unsigned and the updater as unavailable.

## Anti-Patterns

- Creating a second build path, hand-rolled tauri flags, or a per-friend port.
- Running the file service inside Station/x-config containers or reusing
  `/sub-oss`.
- Shipping without mounting the DMG and checking the real plist/architecture.
- Describing the build as signed/notarized or claiming in-app update works.
- Extending this skill to GitHub Release promotion or Mobile packaging.
- Passing `LABELS=` outside the flavor's `allowed_labels`, or authoring the
  directive here instead of via `pt-x-config-catalog-publish`.
- Baking SSH credentials, host secrets, or user-home absolute paths into the
  skill or scripts.
