# Mobile (Android + iOS) — Agent Platform Rules

> Load this file when working on `apps/mobile/android/` or `apps/mobile/ios/`.
> Parent rules: [AGENTS.md](../../AGENTS.md)
>
> ⚠️ `apps/mobile/flutter/` is **DEPRECATED** — do not read, modify, or reference it.

---

## Android (Kotlin)

| Rule | Detail |
|------|--------|
| UI | Jetpack Compose only, no XML layouts |
| DI | Hilt (`@HiltAndroidApp`, `@AndroidEntryPoint`, `@HiltViewModel`) |
| Async | Coroutines + Flow, **no RxJava** |
| Theme | Material 3 via `PeersTouchTheme` |
| Storage | DataStore (preferences), Room (structured) |

### Feature Module Structure

```
feature/<name>/
├── ui/              # Composable screens
├── viewmodel/       # ViewModel
├── repository/      # Data repository
└── model/           # Data models
```

### Logger — Timber

```kotlin
Timber.d("bridge: module %s initialized", moduleName)
Timber.i("applet: session created for %s", appletId)
Timber.w("network: retry attempt %d/%d", current, max)
Timber.e(exception, "bridge: method %s.%s failed", module, method)
```

**Forbidden**: `Log.d/i/w/e` direct calls, `println()`.

### Token Storage

```kotlin
val prefs = EncryptedSharedPreferences.create(
    "peers_secure_prefs",
    MasterKeys.getOrCreate(MasterKeys.AES256_GCM_SPEC),
    context,
    EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
    EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM
)
```

### Verification

```bash
cd apps/mobile/android && ./gradlew build
```

---

## iOS (Swift)

| Rule | Detail |
|------|--------|
| UI | SwiftUI only, no UIKit (except Lynx bridge) |
| State | `@Observable` (iOS 17+) |
| DI | `Container.shared` manual DI pattern |
| Async | `async/await`, no callback nesting |
| Colors | Asset Catalog + `ColorTokens`, no hardcoded colors |
| Routing | `NavigationPath` + `Router` |

### Logger — os.Logger

```swift
import os

extension Logger {
    static let network = Logger(subsystem: Bundle.main.bundleIdentifier!, category: "network")
    static let bridge  = Logger(subsystem: Bundle.main.bundleIdentifier!, category: "bridge")
    static let applet  = Logger(subsystem: Bundle.main.bundleIdentifier!, category: "applet")
    static let auth    = Logger(subsystem: Bundle.main.bundleIdentifier!, category: "auth")
}

Logger.network.info("Request started: \(url, privacy: .public)")
Logger.bridge.error("Call failed: \(error.localizedDescription, privacy: .public)")
```

**Forbidden**: `print()`, `NSLog()`.

Note: Use `.public` for values visible in production logs, `.private` for sensitive data.

### Token Storage — Keychain

```swift
let query: [String: Any] = [
    kSecClass as String: kSecClassGenericPassword,
    kSecAttrAccount as String: "peers_access_token",
    kSecValueData as String: token.data(using: .utf8)!
]
SecItemAdd(query as CFDictionary, nil)
```

### Verification

```bash
cd apps/mobile/ios && xcodebuild -scheme PeersTouch build
```

---

## Shared: Applet Container

Mobile uses **Lynx** as the applet/mini-program container.
- Android: native `LynxView` integration
- iOS: same pattern via `LynxView`
- Applets run in Lynx sandbox, communicate with host app via Bridge

### Proto Generation (Mobile)

```bash
./tooling/scripts/proto-gen-mobile.sh           # All
./tooling/scripts/proto-gen-mobile.sh kotlin     # Kotlin only
./tooling/scripts/proto-gen-mobile.sh swift      # Swift only
```

Output:
- Kotlin: `apps/mobile/android/app/src/main/java/`
- Swift: `apps/mobile/ios/PeersTouch/Core/Proto/`
