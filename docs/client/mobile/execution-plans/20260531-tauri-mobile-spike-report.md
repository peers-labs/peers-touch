# Tauri Mobile Spike Report

> Status: in progress
> Owner: Client Architecture
> Created: 2026-05-31
> Related plan: `20260531-tauri-mobile-mainline-migration.md`

---

## 1. 当前结论

P1 已调整为 iOS-first spike，并已补齐框架级 shell 骨架：

- `apps/mobile` 已加入 pnpm workspace。
- Root scripts 已增加 `mobile:*` 入口。
- `apps/mobile/src` 已建立 `app/providers`、`routes`、`pages`、`runtimes`、`services/platform` 边界。
- `apps/mobile/src-tauri` 已建立 `commands`、`platform/ios`、`error`、capability kernel 边界。
- mobile-web 已能通过 Tauri command 调用 `mobile_health`。
- secure storage 已建立 Web page → runtime smoke → platform adapter → Tauri command → Rust platform port 的框架边界。
- `mobile:check` 已升级为 Web + Rust + iOS Xcode project 三层门禁。

当前验证结果：

| 项 | 状态 | 说明 |
| --- | --- | --- |
| Framework check | passed | `pnpm mobile:check` |
| Vite build | passed | `pnpm --filter @peers-touch/app-mobile run build` |
| Rust check | passed | `cargo check --offline -q` |
| iOS init | passed | `pnpm --filter @peers-touch/app-mobile run tauri:ios:init` |
| Xcode project list | passed with environment warning | `xcodebuild -list -project peers-touch-mobile.xcodeproj` |
| iOS simulator build | blocked by local Xcode simulator platform | Rust/iOS link passed; `LaunchScreen.storyboard` compile requires installed iOS 26.5 platform |

---

## 2. 已落地产物

```text
apps/mobile/
├── .gitignore
├── index.html
├── package.json
├── tsconfig.json
├── vite.config.ts
├── src/
│   ├── app/
│   ├── pages/
│   ├── routes/
│   ├── runtimes/
│   ├── services/
│   ├── App.tsx
│   ├── main.tsx
│   └── styles.css
└── src-tauri/
    ├── Cargo.lock
    ├── Cargo.toml
    ├── build.rs
    ├── capabilities/
    │   └── default.json
    ├── icons/
    │   └── icon.png
    ├── gen/
    │   └── apple/
    ├── src/
    │   ├── commands/
    │   ├── platform/
    │   ├── error.rs
    │   ├── lib.rs
    │   └── main.rs
    └── tauri.conf.json
```

Root / workspace:

- `package.json`
- `pnpm-workspace.yaml`
- `pnpm-lock.yaml`

---

## 3. 验证记录

### 3.1 Framework Check

```bash
pnpm mobile:check
```

Result:

- Passed.
- Runs TypeScript check, Rust `cargo check --offline -q`, and Xcode project listing.

### 3.2 Web Build

```bash
pnpm --filter @peers-touch/app-mobile run build
```

Result:

- Passed.
- `dist/` generated locally and ignored by `apps/mobile/.gitignore`.

### 3.3 Rust Kernel

```bash
cd apps/mobile/src-tauri
cargo check --offline -q
```

Result:

- Passed.

### 3.4 iOS Init

```bash
pnpm --filter @peers-touch/app-mobile run tauri:ios:init
```

Result:

- Passed.
- `tauri ios init --ci --skip-targets-install` generated `apps/mobile/src-tauri/gen/apple`.
- Shared `tauri.conf.json` does not hardcode a development team; local signing should use `APPLE_DEVELOPMENT_TEAM` or a local config overlay.

Note:

- An earlier interactive run was stopped after it prompted for Homebrew dependency updates.
- The current script uses `--ci` to avoid prompts and `--skip-targets-install` because iOS Rust targets are already installed.

### 3.5 Xcode Project List

```bash
cd apps/mobile/src-tauri/gen/apple
xcodebuild -list -project peers-touch-mobile.xcodeproj
```

Result:

- Passed.
- Project exposes target and scheme `peers-touch-mobile_iOS`.
- Local Xcode emitted a CoreSimulator version warning, but project metadata is readable.

Observed environment warning:

```text
CoreSimulator is out of date. Current version (1051.50.0) is older than build version (1051.54.0).
```

### 3.6 iOS Simulator Build

```bash
pnpm mobile:build:ios
```

Result:

- Blocked by local Xcode/iOS simulator platform.
- Tauri entered Xcode build.
- Rust `aarch64-apple-ios-sim` build passed.
- Objective-C++ `main.mm` compile passed.
- App dylib link passed.
- Build currently stops at storyboard compilation because the local Xcode installation references an iOS simulator platform that is not installed.

Observed environment blocker:

```text
LaunchScreen.storyboard: error: iOS 26.5 Platform Not Installed.
```

Implementation note:

- The generated Xcode project originally treated `arm64-sim` as an Xcode `ARCHS` value, which produced the invalid clang triple `arm64-apple-ios13.0-simulator-sim`.
- The project now keeps `ARCHS = arm64` and selects Rust static library paths by SDK: `Externals/arm64` for device, `Externals/arm64-sim` for simulator.

### 3.7 Secure Storage Capability Boundary

```bash
pnpm mobile:check
pnpm mobile:build:ios
```

Result:

- Framework boundary added.
- Web smoke page uses a non-secret probe value only.
- Rust commands validate key shape and return typed mobile errors.
- Tauri capability remains minimal: `core:default`.
- iOS Keychain implementation is intentionally not linked yet; current iOS port returns a typed `MOBILE_SECURE_STORAGE` error that states a linked Tauri iOS plugin is required.

Rejected spike shape:

- Do not define Keychain C symbols in generated `main.mm` and call them from the Rust dylib.
- That shape fails because Rust is built and linked before the final Xcode app executable symbols are available.
- The proper next implementation is a real Tauri iOS plugin / native capability package with explicit permission registration and native source linkage.

---

## 4. 下一步

1. Install the matching iOS platform from Xcode > Settings > Components, or update Xcode/macOS so CoreSimulator matches Xcode.
2. Rerun `pnpm mobile:build:ios`.
3. Run `pnpm mobile:dev:ios` when simulator destination is available.
4. Add a non-interactive `mobile:doctor` script to check Xcode, iOS platform, CocoaPods, XcodeGen, and libimobiledevice.
5. Promote secure storage from framework boundary to a real Tauri iOS plugin with explicit permission registration and native Keychain linkage.
6. Wire Station health/auth API only after secure storage can persist session material through the plugin boundary.
