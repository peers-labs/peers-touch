# RD-T05 — Desktop Release Matrix And Signed Updater Channel

## Task Slice

```json
{
  "kind": "peers-touch-task-slice",
  "planId": "RD-20261021",
  "taskId": "RD-T05",
  "workstreamId": "RD",
  "title": "Production identifier, Tauri updater channel, tauri-action three-platform desktop-bundle job (rc4)",
  "workClass": "infrastructure",
  "completionClass": "functional",
  "executionMode": "build",
  "closureId": "rd-desktop-release",
  "journeyId": "RD-J05",
  "runtimeClass": "native-desktop",
  "writeSet": [
    ".github/workflows/release.yml",
    "apps/desktop/package.json",
    "apps/desktop/src-tauri/Cargo.toml",
    "apps/desktop/src-tauri/Cargo.lock",
    "apps/desktop/src-tauri/tauri.conf.json",
    "apps/desktop/src-tauri/capabilities"
  ],
  "readSet": [
    "docs/architecture/engineering/release-distribution/design.md"
  ],
  "budgets": {"focusedCheckSeconds": 1800, "functionalRunSeconds": 5400, "cleanupSeconds": 120},
  "checks": [
    {"id": "rd-t05-desktop-check", "command": "pnpm --dir apps/desktop run check", "verificationClass": "SOURCE_CHECK"},
    {"id": "rd-t05-rc4-matrix", "command": "gh run list -w release.yml -c $(git rev-parse v0.1.0-rc4^{commit}) --json conclusion --jq '.[0].conclusion' | jq -e '. == \"success\"'", "verificationClass": "FUNCTIONAL_CHECK"}
  ],
  "doneWhen": [
    "identifier is com.peers.touch.desktop before any public tag; bundle targets explicit dmg,nsis,appimage,deb; the dev2 identifier no longer appears in shipped config.",
    "tauri-plugin-updater + @tauri-apps/plugin-updater are added at versions aligned with tauri 2.0.x; updater capability granted under capabilities/; updater public key baked; createUpdaterArtifacts enabled; endpoints use {{target}}/{{arch}} templates pointing to concrete Release asset URLs, never /releases/latest.",
    "desktop-bundle matrix (macos-latest/windows-latest/ubuntu-22.04) uses tauri-apps/tauri-action@v1 with releaseId+tagName+releaseDraft:true mounted on the existing draft Release; ubuntu leg installs webkit2gtk/librsvg/patchelf prerequisites and sets up node/rust explicitly; macOS target is universal-apple-darwin.",
    "TAURI_SIGNING_PRIVATE_KEY comes from GitHub Secret (password secret slot retained though v1 key is passphrase-free); OS signing cert envs are absent, not stubbed.",
    "finalize needs becomes [station-image, verify-install, desktop-bundle] in this same change (verify-install exists because RD-T04 is merged first); workflow YAML is valid on every intermediate commit.",
    "rc4 operator-tagged proof: lipo -archs shows x86_64+arm64; NSIS installs silently; AppImage --version works; latest.json entries and .sig exist; every asset URL points at rc4 assets (static assertion, /releases/latest forbidden); tampered manifest fails updater verification (negative fixture).",
    "E20 resolution recorded in install docs: deb updater behavior is tested on locked 2.0.1 versions; if unsupported, deb is documented as manual-update and latest.json makes no deb promise (experiment, not a Gate)."
  ],
  "failureBehavior": [
    "A tampered latest.json URL/hash must fail updater verification; the negative fixture blocks done.",
    "Missing TAURI_SIGNING_PRIVATE_KEY fails the leg; unsigned installers are allowed, unsigned UPDATES are not.",
    "Any matrix leg failure leaves the Release draft; finalize never publishes partial artifacts."
  ],
  "updatedAt": "2026-10-21T00:00:00.000Z"
}
```

## Scope Notes

- 对应 RD-D05/D06/D07、E13/E20；design.md §5.1/§5.5、门 3/4。
- 前端"检查更新"UI 不属本 Task（desktop 平台契约）；只交付通道、权限、构建侧。
- 不做 Apple/Windows 代码签名；发布说明自动带未签名警示段落。

## Current Snapshot

- Precondition: RD-T04 merged (verify-install exists; finalize wiring established).
- Produces: production identifier, updater plugin/capabilities/config, desktop-bundle job, finalize three-job needs.
- Evidence is the operator-pushed rc4 full-matrix run; E20 deb result is documented, not gated.
