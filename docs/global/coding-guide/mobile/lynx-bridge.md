# Lynx Bridge 开发指南

本文档详细介绍 Peers-Touch Mobile 端（Android / iOS）的 Lynx Bridge 架构，包括引擎管理、视图工厂、
Bridge 分发器、6 个内置 Bridge 模块的实现细节，以及 Applet 生命周期管理。
两端在模块命名、方法签名、参数结构上保持严格对齐。

---

## 目录

1. [架构总览](#架构总览)
2. [LynxEngineManager](#lynxenginemanager)
   - [Android 实现](#android-lynxenginemanager)
   - [iOS 实现](#ios-lynxenginemanager)
3. [LynxViewFactory](#lynxviewfactory)
   - [Android 实现](#android-lynxviewfactory)
   - [iOS 实现](#ios-lynxviewfactory)
4. [BridgeDispatcher](#bridgedispatcher)
   - [Android 实现](#android-bridgedispatcher)
   - [iOS 实现](#ios-bridgedispatcher)
5. [Bridge 模块详解](#bridge-模块详解)
   - [BridgeModule 协议/接口](#bridgemodule-协议接口)
   - [System 模块](#system-模块)
   - [Storage 模块](#storage-模块)
   - [Network 模块](#network-模块)
   - [Notification 模块](#notification-模块)
   - [Device 模块](#device-模块)
   - [UI 模块](#ui-模块)
6. [Bridge 模块开发规范](#bridge-模块开发规范)
   - [新增模块步骤](#新增模块步骤)
   - [跨平台对齐要求](#跨平台对齐要求)
7. [AppletManager 与生命周期](#appletmanager-与生命周期)
   - [AppletBundleStorage](#appletbundlestorage)
   - [AppletManifest 解析](#appletmanifest-解析)
   - [Applet 加载与卸载](#applet-加载与卸载)
   - [AppletContainerView (Android)](#appletcontainerview-android)
8. [依赖注入](#依赖注入)
   - [Android Hilt 配置](#android-hilt-配置)
   - [iOS Container 配置](#ios-container-配置)

---

## 架构总览

```
┌───────────────────────────────────────────────────────────┐
│                     Applet (Lynx JS)                      │
│                                                           │
│   bridge.invoke("system.getInfo", {})                     │
│   bridge.invoke("storage.set", {key: "k", value: "v"})   │
│   bridge.invoke("network.request", {url: "...", ...})     │
└────────────────────────┬──────────────────────────────────┘
                         │  Bridge 调用
                         ▼
┌────────────────────────────────────────────────────────────┐
│                   BridgeDispatcher                         │
│                                                            │
│   解析 "module.method" -> 路由到对应 BridgeModule           │
│   统一错误处理 -> 返回 BridgeResult.Success / .Error        │
└───────────┬────────┬────────┬───────┬───────┬──────┬──────┘
            │        │        │       │       │      │
            ▼        ▼        ▼       ▼       ▼      ▼
        System   Storage  Network  Notif.  Device    UI
        Module   Module   Module   Module  Module  Module
```

核心组件：

| 组件                  | 职责                                           |
|----------------------|------------------------------------------------|
| LynxEngineManager    | 单例，App 启动时初始化 Lynx 引擎环境              |
| LynxViewFactory      | 创建平台原生 LynxView 实例                       |
| BridgeDispatcher     | 路由 Bridge 调用到对应模块                       |
| BridgeModule (x6)    | 实现具体功能域的方法                              |
| AppletManager        | 管理 Applet 生命周期（扫描、加载、卸载）          |
| AppletBundleStorage  | Applet bundle 文件存储与缓存                     |

---

## LynxEngineManager

LynxEngineManager 负责 Lynx 引擎的初始化与销毁。必须在创建任何 LynxView 之前完成初始化。

### Android LynxEngineManager

**源文件**: `apps/mobile/android/.../core/lynx/LynxEngineManager.kt`

```kotlin
class LynxEngineManager constructor() {
    var isInitialized: Boolean = false
        private set

    private var applicationContext: Context? = null

    fun initialize(context: Context) {
        if (isInitialized) return
        applicationContext = context.applicationContext
        LynxEnv.inst().init(
            context.applicationContext,
            null,  // resourceProvider
            null,  // behaviorBundle
            null   // extra
        )
        isInitialized = true
    }

    fun shutdown() {
        if (!isInitialized) return
        isInitialized = false
        applicationContext = null
    }

    fun getApplicationContext(): Context {
        return applicationContext
            ?: throw IllegalStateException("LynxEngineManager not initialized")
    }
}
```

关键点：
- 幂等初始化：`isInitialized` 防止重复调用
- 通过 Hilt 作为 `@Singleton` 提供
- 在 Application.onCreate 或首次使用前调用 `initialize(context)`

### iOS LynxEngineManager

**源文件**: `apps/mobile/ios/PeersTouch/Core/Lynx/LynxEngineManager.swift`

```swift
final class LynxEngineManager: @unchecked Sendable {
    static let shared = LynxEngineManager()

    private(set) var isInitialized = false
    private let lock = NSLock()
    private(set) var config: LynxConfig?

    private init() {}

    func initialize() {
        lock.withLock {
            guard !isInitialized else { return }
            let lynxConfig = LynxConfig(provider: nil)
            LynxEnv.sharedInstance().prepareConfig(lynxConfig)
            config = lynxConfig
            isInitialized = true
        }
    }

    func shutdown() {
        lock.withLock {
            guard isInitialized else { return }
            config = nil
            isInitialized = false
        }
    }
}
```

关键点：
- 使用 `static let shared` 实现真单例
- `NSLock` 保证线程安全
- `config` 存储 LynxConfig，后续 LynxViewFactory 创建视图时使用

---

## LynxViewFactory

LynxViewFactory 负责创建平台原生的 LynxView 实例。

### Android LynxViewFactory

**源文件**: `apps/mobile/android/.../core/lynx/LynxViewFactory.kt`

```kotlin
class LynxViewFactory constructor(
    private val engineManager: LynxEngineManager
) {
    fun create(
        context: Context,
        bundleUrl: String,
        bridgeSession: AppletBridgeSession
    ): View {
        check(engineManager.isInitialized) { "LynxEngineManager must be initialized" }
        val lynxView = LynxView(context)
        lynxView.loadTemplateUrl(bundleUrl)
        return lynxView
    }
}
```

### iOS LynxViewFactory

**源文件**: `apps/mobile/ios/PeersTouch/Core/Lynx/LynxViewFactory.swift`

```swift
final class LynxViewFactory: Sendable {
    private let engineManager: LynxEngineManager

    init(engineManager: LynxEngineManager) {
        self.engineManager = engineManager
    }

    func create(bundleURL: URL, bridgeSession: AppletBridgeSession) -> LynxView {
        guard engineManager.isInitialized else {
            fatalError("LynxEngineManager must be initialized before creating views")
        }
        let lynxView = LynxView(builderBlock: { builder in
            builder.frame = UIScreen.main.bounds
            builder.config = self.engineManager.config
        })
        lynxView.loadTemplate(fromURL: bundleURL.absoluteString)
        return lynxView
    }
}
```

两端均在创建前检查引擎初始化状态。iOS 端通过 builder 模式配置 frame 和 config。

---

## BridgeDispatcher

BridgeDispatcher 是 Bridge 调用的路由中枢。接收 `module.method` 格式的调用，分发到对应 BridgeModule。

### Android BridgeDispatcher

**源文件**: `apps/mobile/android/.../core/lynx/bridge/BridgeDispatcher.kt`

```kotlin
interface BridgeModule {
    val moduleName: String
    suspend fun handle(method: String, params: Map<String, Any?>): Any?
}

sealed class BridgeResult {
    data class Success(val data: Any?) : BridgeResult()
    data class Error(val code: String, val message: String) : BridgeResult()
}

enum class BridgeError(val code: String, val message: String) {
    MODULE_NOT_FOUND("BRIDGE_MODULE_NOT_FOUND", "Bridge module not found"),
    METHOD_NOT_FOUND("BRIDGE_METHOD_NOT_FOUND", "Bridge method not found"),
    INVALID_PARAMS("BRIDGE_INVALID_PARAMS", "Invalid bridge parameters"),
    EXECUTION_FAILED("BRIDGE_EXECUTION_FAILED", "Bridge execution failed")
}

class BridgeDispatcher constructor(
    modules: Set<@JvmSuppressWildcards BridgeModule>
) {
    private val moduleMap: Map<String, BridgeModule> = modules.associateBy { it.moduleName }

    suspend fun invoke(module: String, method: String, params: Map<String, Any?>): BridgeResult {
        val bridgeModule = moduleMap[module]
            ?: return BridgeResult.Error(
                BridgeError.MODULE_NOT_FOUND.code,
                "${BridgeError.MODULE_NOT_FOUND.message}: $module"
            )
        return try {
            val result = bridgeModule.handle(method, params)
            BridgeResult.Success(result)
        } catch (e: Exception) {
            BridgeResult.Error(
                BridgeError.EXECUTION_FAILED.code,
                "${BridgeError.EXECUTION_FAILED.message}: $module.$method - ${e.message}"
            )
        }
    }

    // 支持 "module.method" 格式的快捷调用
    suspend fun invoke(api: String, params: Map<String, Any?>): BridgeResult {
        val components = api.split(".", limit = 2)
        if (components.size != 2) {
            return BridgeResult.Error(
                BridgeError.INVALID_PARAMS.code,
                "API format must be 'module.method', got: $api"
            )
        }
        return invoke(components[0], components[1], params)
    }

    fun hasModule(moduleName: String): Boolean = moduleMap.containsKey(moduleName)
    fun getRegisteredModules(): Set<String> = moduleMap.keys
}
```

Android 使用 Hilt 的 `@IntoSet` 多绑定，将所有 BridgeModule 收集为 `Set<BridgeModule>` 注入 Dispatcher。

### iOS BridgeDispatcher

**源文件**: `apps/mobile/ios/PeersTouch/Core/Lynx/Bridge/BridgeDispatcher.swift`

```swift
protocol BridgeModule: Sendable {
    var moduleName: String { get }
    func handle(method: String, params: [String: Any]?) async throws -> Any?
}

enum BridgeResult {
    case success(Any?)
    case error(code: String, message: String)
}

final class BridgeDispatcher: @unchecked Sendable {
    private var modules: [String: any BridgeModule] = [:]
    private let lock = NSLock()

    init(modules: [any BridgeModule]) {
        for module in modules {
            self.modules[module.moduleName] = module
        }
    }

    func register(module: any BridgeModule) {
        lock.withLock {
            modules[module.moduleName] = module
        }
    }

    func invoke(module: String, method: String, params: [String: Any]?) async -> BridgeResult {
        let bridgeModule: (any BridgeModule)? = lock.withLock {
            modules[module]
        }

        guard let bridgeModule else {
            return .error(
                code: BridgeErrorCode.moduleNotFound.rawValue,
                message: "Bridge module not found: \(module)"
            )
        }

        do {
            let result = try await bridgeModule.handle(method: method, params: params)
            return .success(result)
        } catch {
            return .error(
                code: BridgeErrorCode.executionFailed.rawValue,
                message: "Bridge execution failed: \(module).\(method) - \(error.localizedDescription)"
            )
        }
    }

    func invoke(api: String, params: [String: Any]?) async -> BridgeResult {
        let components = api.split(separator: ".", maxSplits: 1)
        guard components.count == 2 else {
            return .error(
                code: BridgeErrorCode.invalidParams.rawValue,
                message: "API format must be 'module.method', got: \(api)"
            )
        }
        return await invoke(
            module: String(components[0]),
            method: String(components[1]),
            params: params
        )
    }
}
```

iOS 端额外提供了 `register(module:)` 方法支持运行时动态注册模块。

---

## Bridge 模块详解

### BridgeModule 协议/接口

两端定义统一的模块接口：

**Android (Kotlin interface)**:

```kotlin
interface BridgeModule {
    val moduleName: String
    suspend fun handle(method: String, params: Map<String, Any?>): Any?
}
```

**iOS (Swift protocol)**:

```swift
protocol BridgeModule: Sendable {
    var moduleName: String { get }
    func handle(method: String, params: [String: Any]?) async throws -> Any?
}
```

核心约定：
- `moduleName` -- 模块的唯一标识符，同时作为 Bridge 调用的路由 key
- `handle(method:params:)` -- 方法路由入口，内部通过 switch/when 分发到具体方法
- 返回 `Any?` -- 由 Dispatcher 统一包装为 `BridgeResult`

### System 模块

**模块名**: `"system"`

| 方法        | 参数 | 返回值                                                              |
|------------|------|---------------------------------------------------------------------|
| `getInfo`  | 无   | `{platform, os, version, appVersion, appName, screenWidth, screenHeight, ...}` |
| `getLocale`| 无   | `{language, country, tag}`                                         |

**Android 实现**:

```kotlin
class SystemBridgeModule constructor(
    private val context: Context
) : BridgeModule {

    override val moduleName: String = "system"

    override suspend fun handle(method: String, params: Map<String, Any?>): Any? {
        return when (method) {
            "getInfo" -> getInfo()
            "getLocale" -> getLocale()
            else -> throw IllegalArgumentException("Unknown method: $moduleName.$method")
        }
    }

    private fun getInfo(): Map<String, Any> {
        return mapOf(
            "platform" to "mobile",
            "os" to "android",
            "version" to Build.VERSION.RELEASE,
            "appVersion" to getAppVersion(),
            "appName" to "PeersTouch",
            "screenWidth" to context.resources.displayMetrics.widthPixels,
            "screenHeight" to context.resources.displayMetrics.heightPixels,
            "density" to context.resources.displayMetrics.density
        )
    }
}
```

**iOS 实现**:

```swift
struct SystemBridgeModule: BridgeModule {
    let moduleName = "system"

    func handle(method: String, params: [String: Any]?) async throws -> Any? {
        switch method {
        case "getInfo":
            return await systemInfo()
        case "getLocale":
            return getLocale()
        default:
            throw BridgeError.methodNotFound(module: moduleName, method: method)
        }
    }

    @MainActor
    private func systemInfo() -> [String: Any] {
        let screen = UIScreen.main.bounds
        return [
            "platform": "mobile",
            "os": "ios",
            "version": UIDevice.current.systemVersion,
            "appVersion": Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String ?? "0.0.0",
            "appName": "PeersTouch",
            "screenWidth": Int(screen.width),
            "screenHeight": Int(screen.height),
            "statusBarHeight": Int(UIApplication.shared.connectedScenes
                .compactMap { $0 as? UIWindowScene }
                .first?.statusBarManager?.statusBarFrame.height ?? 0)
        ]
    }
}
```

注意：iOS 端 `systemInfo()` 需要 `@MainActor`，因为访问了 `UIScreen` 和 `UIApplication`。

### Storage 模块

**模块名**: `"storage"`

| 方法      | 参数                            | 返回值         |
|----------|---------------------------------|---------------|
| `get`    | `{key: String}`                 | `String?`     |
| `set`    | `{key: String, value: String}`  | `null`        |
| `remove` | `{key: String}`                 | `null`        |
| `clear`  | 无                              | `null`        |

**Android 实现** -- 使用 `SharedPreferences("applet_storage")`：

```kotlin
class StorageBridgeModule constructor(
    private val context: Context
) : BridgeModule {
    override val moduleName: String = "storage"

    private val prefs: SharedPreferences by lazy {
        context.getSharedPreferences("applet_storage", Context.MODE_PRIVATE)
    }

    override suspend fun handle(method: String, params: Map<String, Any?>): Any? {
        return when (method) {
            "get" -> {
                val key = params["key"] as? String
                    ?: throw IllegalArgumentException("key is required")
                prefs.getString(key, null)
            }
            "set" -> {
                val key = params["key"] as? String
                    ?: throw IllegalArgumentException("key is required")
                val value = params["value"] as? String
                    ?: throw IllegalArgumentException("value is required")
                prefs.edit().putString(key, value).apply()
                null
            }
            "remove" -> {
                val key = params["key"] as? String
                    ?: throw IllegalArgumentException("key is required")
                prefs.edit().remove(key).apply()
                null
            }
            "clear" -> {
                prefs.edit().clear().apply()
                null
            }
            else -> throw IllegalArgumentException("Unknown method: $moduleName.$method")
        }
    }
}
```

**iOS 实现** -- 使用 `UserDefaults(suiteName: "applet_storage")`：

```swift
struct StorageBridgeModule: BridgeModule {
    let moduleName = "storage"
    private let defaults: UserDefaults

    init(suiteName: String = "applet_storage") {
        self.defaults = UserDefaults(suiteName: suiteName) ?? .standard
    }

    func handle(method: String, params: [String: Any]?) async throws -> Any? {
        switch method {
        case "get":
            guard let key = params?["key"] as? String else {
                throw BridgeError.invalidParams("Missing 'key' parameter")
            }
            return defaults.string(forKey: key)
        case "set":
            guard let key = params?["key"] as? String,
                  let value = params?["value"] as? String else {
                throw BridgeError.invalidParams("Missing 'key' or 'value' parameter")
            }
            defaults.set(value, forKey: key)
            return nil
        case "remove":
            guard let key = params?["key"] as? String else {
                throw BridgeError.invalidParams("Missing 'key' parameter")
            }
            defaults.removeObject(forKey: key)
            return nil
        case "clear":
            if let bundleId = Bundle.main.bundleIdentifier {
                defaults.removePersistentDomain(forName: bundleId)
            }
            return nil
        default:
            throw BridgeError.methodNotFound(module: moduleName, method: method)
        }
    }
}
```

两端均使用独立的 `applet_storage` 命名空间，与主应用的 PreferenceStore 隔离。

### Network 模块

**模块名**: `"network"`

| 方法       | 参数                                                     | 返回值                                    |
|-----------|----------------------------------------------------------|------------------------------------------|
| `request` | `{url, method?, headers?, data?, timeout?}`              | `{data, status, headers}`                |
| `download`| `{url, headers?, filePath?}`                             | `{filePath, statusCode, fileSize}`       |
| `upload`  | `{url, filePath, name, headers?, formData?}`             | `{data, statusCode}`                     |

**Android 实现** -- 使用 OkHttpClient 直接发请求：

```kotlin
class NetworkBridgeModule constructor(
    private val okHttpClient: OkHttpClient
) : BridgeModule {
    override val moduleName: String = "network"

    override suspend fun handle(method: String, params: Map<String, Any?>): Any? {
        return when (method) {
            "request" -> request(params)
            "download" -> download(params)
            "upload" -> upload(params)
            else -> throw IllegalArgumentException("Unknown method: $moduleName.$method")
        }
    }

    private suspend fun request(params: Map<String, Any?>): Map<String, Any?> {
        val url = params["url"] as? String
            ?: throw IllegalArgumentException("url is required")
        val method = (params["method"] as? String)?.uppercase() ?: "GET"
        val headers = params["headers"] as? Map<String, String> ?: emptyMap()

        return withContext(Dispatchers.IO) {
            val requestBuilder = Request.Builder().url(url)
            headers.forEach { (key, value) -> requestBuilder.addHeader(key, value) }
            // ... 构建 RequestBody，执行请求
            val response = okHttpClient.newCall(requestBuilder.build()).execute()
            mapOf(
                "data" to responseBody,
                "status" to response.code,
                "headers" to responseHeaders
            )
        }
    }
}
```

**iOS 实现** -- 使用 URLSession：

```swift
struct NetworkBridgeModule: BridgeModule {
    let moduleName = "network"
    private let session: URLSession

    init() {
        let configuration = URLSessionConfiguration.default
        configuration.timeoutIntervalForRequest = 30
        self.session = URLSession(configuration: configuration)
    }

    func handle(method: String, params: [String: Any]?) async throws -> Any? {
        switch method {
        case "request":
            return try await handleRequest(params: params)
        case "download":
            return try await handleDownload(params: params)
        case "upload":
            return try await handleUpload(params: params)
        default:
            throw BridgeError.methodNotFound(module: moduleName, method: method)
        }
    }
}
```

Network 模块为 Applet 提供独立的网络能力，与主应用的 APIClient 解耦。Android 复用 Hilt 注入的 OkHttpClient（含 AuthInterceptor），iOS 使用独立 URLSession。

### Notification 模块

**模块名**: `"notification"`

| 方法     | 参数                                   | 返回值                          |
|---------|----------------------------------------|---------------------------------|
| `show`  | `{title, content?, sound?}`            | `{id, shown: Boolean}`          |
| `cancel`| `{id}`                                 | `null`                          |

**Android 实现** -- 使用 NotificationCompat + NotificationChannel：

```kotlin
class NotificationBridgeModule constructor(
    private val context: Context
) : BridgeModule {
    override val moduleName: String = "notification"

    init { createNotificationChannel() }

    override suspend fun handle(method: String, params: Map<String, Any?>): Any? {
        return when (method) {
            "show" -> show(
                params["title"] as? String ?: "",
                params["content"] as? String ?: ""
            )
            "cancel" -> cancel((params["id"] as? Number)?.toInt() ?: 0)
            else -> throw IllegalArgumentException("Unknown method: $moduleName.$method")
        }
    }

    private fun show(title: String, content: String): Map<String, Any> {
        val notificationId = System.currentTimeMillis().toInt()
        // Android 13+ 需要 POST_NOTIFICATIONS 权限检查
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            if (ContextCompat.checkSelfPermission(context, Manifest.permission.POST_NOTIFICATIONS)
                != PackageManager.PERMISSION_GRANTED
            ) {
                return mapOf("id" to notificationId, "shown" to false)
            }
        }
        // 构建并发送通知
        val notification = NotificationCompat.Builder(context, CHANNEL_ID)
            .setSmallIcon(android.R.drawable.ic_dialog_info)
            .setContentTitle(title)
            .setContentText(content)
            .setPriority(NotificationCompat.PRIORITY_DEFAULT)
            .setAutoCancel(true)
            .build()
        NotificationManagerCompat.from(context).notify(notificationId, notification)
        return mapOf("id" to notificationId, "shown" to true)
    }
}
```

**iOS 实现** -- 使用 UNUserNotificationCenter：

```swift
struct NotificationBridgeModule: BridgeModule {
    let moduleName = "notification"

    func handle(method: String, params: [String: Any]?) async throws -> Any? {
        switch method {
        case "show":
            return try await showNotification(params: params)
        case "cancel":
            guard let id = params?["id"] as? String else {
                throw BridgeError.invalidParams("Missing 'id' parameter")
            }
            UNUserNotificationCenter.current()
                .removePendingNotificationRequests(withIdentifiers: [id])
            UNUserNotificationCenter.current()
                .removeDeliveredNotifications(withIdentifiers: [id])
            return nil
        default:
            throw BridgeError.methodNotFound(module: moduleName, method: method)
        }
    }

    private func showNotification(params: [String: Any]?) async throws -> [String: Any] {
        let notificationId = UUID().uuidString
        let content = UNMutableNotificationContent()
        content.title = params?["title"] as? String ?? ""
        if let body = params?["content"] as? String {
            content.body = body
        }
        let trigger = UNTimeIntervalNotificationTrigger(timeInterval: 0.1, repeats: false)
        let request = UNNotificationRequest(
            identifier: notificationId, content: content, trigger: trigger
        )
        try await UNUserNotificationCenter.current().add(request)
        return ["id": notificationId, "shown": true]
    }
}
```

### Device 模块

**模块名**: `"device"`

| 方法                  | 参数                | 返回值                                               |
|----------------------|---------------------|------------------------------------------------------|
| `getClipboardContent`| 无                  | `String?`                                            |
| `setClipboardContent`| `{content: String}` | `null`                                               |
| `getDeviceInfo`      | 无                  | `{brand, model, manufacturer, osVersion, ...}`       |

**Android 实现**:

```kotlin
class DeviceBridgeModule constructor(
    private val context: Context
) : BridgeModule {
    override val moduleName: String = "device"

    override suspend fun handle(method: String, params: Map<String, Any?>): Any? {
        return when (method) {
            "getClipboardContent" -> getClipboardContent()
            "setClipboardContent" -> setClipboardContent(
                params["content"] as? String
                    ?: throw IllegalArgumentException("content is required")
            )
            "getDeviceInfo" -> getDeviceInfo()
            else -> throw IllegalArgumentException("Unknown method: $moduleName.$method")
        }
    }

    private fun getDeviceInfo(): Map<String, Any> {
        return mapOf(
            "brand" to Build.BRAND,
            "model" to Build.MODEL,
            "manufacturer" to Build.MANUFACTURER,
            "osVersion" to Build.VERSION.RELEASE,
            "sdkInt" to Build.VERSION.SDK_INT
        )
    }
}
```

**iOS 实现**:

```swift
struct DeviceBridgeModule: BridgeModule {
    let moduleName = "device"

    func handle(method: String, params: [String: Any]?) async throws -> Any? {
        switch method {
        case "getClipboardContent":
            return await getClipboardContent()
        case "setClipboardContent":
            guard let content = params?["content"] as? String else {
                throw BridgeError.invalidParams("Missing 'content' parameter")
            }
            await setClipboardContent(content)
            return nil
        case "getDeviceInfo":
            return await getDeviceInfo()
        default:
            throw BridgeError.methodNotFound(module: moduleName, method: method)
        }
    }

    @MainActor
    private func getDeviceInfo() -> [String: Any] {
        [
            "brand": "Apple",
            "model": UIDevice.current.model,
            "manufacturer": "Apple",
            "osVersion": UIDevice.current.systemVersion,
            "name": UIDevice.current.name
        ]
    }
}
```

iOS 端 clipboard 和 device info 操作需要 `@MainActor`。

### UI 模块

**模块名**: `"ui"`

| 方法        | 参数                                              | 返回值 |
|------------|---------------------------------------------------|--------|
| `showToast`| `{content: String, duration?: Number, type?: String}` | `null` |

**Android 实现** -- 使用 Toast + MainHandler：

```kotlin
class UIBridgeModule constructor(
    private val context: Context
) : BridgeModule {
    override val moduleName: String = "ui"
    private val mainHandler = Handler(Looper.getMainLooper())

    override suspend fun handle(method: String, params: Map<String, Any?>): Any? {
        return when (method) {
            "showToast" -> showToast(
                params["content"] as? String
                    ?: throw IllegalArgumentException("content is required"),
                (params["duration"] as? Number)?.toLong() ?: 2000L,
                params["type"] as? String ?: "info"
            )
            else -> throw IllegalArgumentException("Unknown method: $moduleName.$method")
        }
    }

    private fun showToast(content: String, duration: Long, type: String) {
        val toastDuration = if (duration > 2500) Toast.LENGTH_LONG else Toast.LENGTH_SHORT
        mainHandler.post {
            Toast.makeText(context, content, toastDuration).show()
        }
    }
}
```

**iOS 实现** -- 使用 @MainActor（Toast 具体 UI 待实现）：

```swift
struct UIBridgeModule: BridgeModule {
    let moduleName = "ui"

    func handle(method: String, params: [String: Any]?) async throws -> Any? {
        switch method {
        case "showToast":
            guard let content = params?["content"] as? String else {
                throw BridgeError.invalidParams("Missing 'content' parameter")
            }
            let duration = params?["duration"] as? TimeInterval ?? 2000
            let typeString = params?["type"] as? String ?? "info"
            let type = ToastType(rawValue: typeString) ?? .info
            await showToast(content: content, duration: duration, type: type)
            return nil
        default:
            throw BridgeError.methodNotFound(module: moduleName, method: method)
        }
    }
}
```

`type` 支持的值：`"success"`, `"error"`, `"info"`, `"warning"`。

---

## Bridge 模块开发规范

### 新增模块步骤

以新增一个 `"camera"` 模块为例：

**步骤 1 -- 定义跨平台 API 规范**

先确定模块名和所有方法签名，确保 Android/iOS 一致：

```
模块名: "camera"
方法:
  - takePhoto(params: {quality?: String}) -> {filePath: String, width: Int, height: Int}
  - pickFromGallery(params: {maxCount?: Int}) -> [{filePath: String}]
```

**步骤 2 -- Android 实现**

在 `core/lynx/bridge/` 下创建 `CameraBridgeModule.kt`：

```kotlin
class CameraBridgeModule constructor(
    private val context: Context
) : BridgeModule {
    override val moduleName: String = "camera"

    override suspend fun handle(method: String, params: Map<String, Any?>): Any? {
        return when (method) {
            "takePhoto" -> takePhoto(params)
            "pickFromGallery" -> pickFromGallery(params)
            else -> throw IllegalArgumentException("Unknown method: $moduleName.$method")
        }
    }

    private suspend fun takePhoto(params: Map<String, Any?>): Map<String, Any> {
        // 实现拍照逻辑
    }

    private suspend fun pickFromGallery(params: Map<String, Any?>): List<Map<String, Any>> {
        // 实现相册选择逻辑
    }
}
```

在 `AppletModule.kt` 注册：

```kotlin
@Provides
@IntoSet
fun provideCameraBridgeModule(@ApplicationContext context: Context): BridgeModule {
    return CameraBridgeModule(context)
}
```

**步骤 3 -- iOS 实现**

在 `Core/Lynx/Bridge/` 下创建 `CameraBridgeModule.swift`：

```swift
struct CameraBridgeModule: BridgeModule {
    let moduleName = "camera"

    func handle(method: String, params: [String: Any]?) async throws -> Any? {
        switch method {
        case "takePhoto":
            return try await takePhoto(params: params)
        case "pickFromGallery":
            return try await pickFromGallery(params: params)
        default:
            throw BridgeError.methodNotFound(module: moduleName, method: method)
        }
    }
}
```

在 `Container.swift` 的 BridgeDispatcher 初始化中添加：

```swift
let bridgeDispatcher = BridgeDispatcher(modules: [
    SystemBridgeModule(),
    StorageBridgeModule(),
    NetworkBridgeModule(),
    NotificationBridgeModule(),
    DeviceBridgeModule(),
    UIBridgeModule(),
    CameraBridgeModule()   // <-- 新增
])
```

### 跨平台对齐要求

| 对齐项          | 要求                                         |
|----------------|----------------------------------------------|
| 模块名          | 两端 `moduleName` 完全相同（全小写）           |
| 方法名          | 两端 `method` 字符串完全相同（camelCase）       |
| 参数 Key        | 两端参数字典的 key 完全相同                     |
| 返回值结构      | 两端返回相同结构的 Map/Dictionary               |
| 错误处理        | 未知方法统一抛异常，由 Dispatcher 统一包装      |

---

## AppletManager 与生命周期

### AppletBundleStorage

负责 Applet bundle 文件的本地存储、下载和缓存管理。

**Android 实现** -- 存储路径 `filesDir/applet_bundles/{appletId}/`：

```kotlin
class AppletBundleStorage constructor(private val context: Context) {
    private val bundlesDir: File
        get() = File(context.filesDir, "applet_bundles").also { it.mkdirs() }

    fun getBundlePath(appletId: String): File?
    suspend fun downloadBundle(appletId: String, url: String): File
    fun deleteBundle(appletId: String)
    fun listCachedBundles(): List<AppletManifest>
}
```

**iOS 实现** -- 存储路径 `cachesDirectory/applet-bundles/{appletId}/`：

```swift
final class AppletBundleStorage: @unchecked Sendable {
    private let bundleDirectory: URL  // cachesDirectory/applet-bundles/

    func bundlePath(for appletId: String) -> URL?
    func downloadBundle(appletId: String, from url: URL) async throws -> URL
    func deleteBundle(appletId: String) throws
    func listCachedBundles() -> [AppletManifest]
}
```

### AppletManifest 解析

每个 Applet bundle 目录下包含一个 `applet.json` 清单文件。`AppletManifestParser` 负责解析和校验。

清单文件结构：

```json
{
  "manifestVersion": 2,
  "id": "my-applet",
  "name": "My Applet",
  "version": "1.0.0",
  "description": "A sample applet",
  "author": "PeersTouch Team",
  "icon": "icon.png",
  "permissions": ["storage", "network"],
  "capabilities": [],
  "minPlatformVersion": "0.1.0",
  "targetPlatforms": ["mobile", "desktop"],
  "load": {
    "type": "lynx",
    "entry": "bundle.js"
  },
  "bridge": {
    "version": 2,
    "protocol": "peers-touch.applet.bridge.v2"
  }
}
```

校验规则：
- `manifestVersion` 必须等于 `2`
- `id` 必须匹配 `^[a-z0-9][a-z0-9-]*$`
- `version` 必须是合法 semver
- `load.type` 目前仅支持 `"lynx"`
- `bridge.protocol` 必须等于 `"peers-touch.applet.bridge.v2"`
- `targetPlatforms` 可选，有效值为 `"desktop"`, `"mobile"`, `"web"`

### Applet 加载与卸载

AppletManager 管理完整的 Applet 生命周期：

```
scanLocalApplets()
    │
    │ 扫描本地 bundle，校验清单，过滤平台不匹配项
    ▼
loadApplet(id)
    │
    │ 版本兼容检查 -> 创建 BridgeSession -> LOADING -> READY
    ▼
AppletBridgeSession (READY / RUNNING)
    │
    │ Applet 正常运行，通过 BridgeDispatcher 调用 Bridge 模块
    ▼
unloadApplet(id)
    │
    │ 状态 -> UNLOADED，移除 session
    ▼
已卸载
```

**Android AppletManager 核心流程**:

```kotlin
class AppletManager constructor(
    private val appletBundleStorage: AppletBundleStorage,
    private val bridgeDispatcher: BridgeDispatcher
) {
    fun scanLocalApplets(): List<AppletManifest> {
        // 清空旧数据 -> 扫描 bundlesDir -> 校验 -> 过滤 targetPlatforms
        // 返回可用的 manifest 列表
    }

    fun loadApplet(id: String): AppletBridgeSession {
        // 查找 applet info -> 校验 minPlatformVersion -> 复用已有 session
        // -> 创建新 session -> transition(LOADING) -> transition(READY)
        // -> 返回 session
    }

    fun unloadApplet(id: String) {
        // session.transition(UNLOADED) -> 移除 session
    }
}
```

**iOS AppletManager** 结构基本一致，额外使用 `NSLock` 保证线程安全：

```swift
final class AppletManager: @unchecked Sendable {
    private let lock = NSLock()

    func scanLocalApplets() -> [AppletManifest]
    func loadApplet(id: String) throws -> AppletBridgeSession
    func unloadApplet(id: String)
    func getLoadedApplets() -> [AppletBridgeSession]
    func getDiagnostics() -> [AppletDiagnostic]
}
```

`getDiagnostics()` 可获取被拒绝的 Applet 诊断信息（重复 ID、平台不匹配、校验失败等）。

### AppletContainerView (Android)

Android 端提供了 `@Composable` 的 `AppletContainerView`，封装了 Applet 的加载、渲染和卸载逻辑：

```kotlin
@Composable
fun AppletContainerView(
    appletId: String,
    appletManager: AppletManager = hiltViewModel<AppletContainerViewModel>().appletManager,
    lynxViewFactory: LynxViewFactory = hiltViewModel<AppletContainerViewModel>().lynxViewFactory
) {
    var containerState by remember { mutableStateOf<AppletContainerState>(AppletContainerState.Loading) }

    LaunchedEffect(appletId) {
        try {
            val session = appletManager.loadApplet(appletId)
            containerState = if (session.state == AppletState.READY || session.state == AppletState.RUNNING) {
                AppletContainerState.Running
            } else {
                AppletContainerState.Error("Applet is in ${session.state} state")
            }
        } catch (e: Exception) {
            containerState = AppletContainerState.Error(e.message ?: "Unknown error")
        }
    }

    DisposableEffect(appletId) {
        onDispose { appletManager.unloadApplet(appletId) }
    }

    Box(modifier = Modifier.fillMaxSize()) {
        when (val state = containerState) {
            is AppletContainerState.Loading -> AppletLoadingView()
            is AppletContainerState.Running -> {
                val session = appletManager.getApplet(appletId)
                if (session != null) {
                    AndroidView(
                        factory = { ctx ->
                            lynxViewFactory.create(ctx, session.manifest.load.entry, session)
                        },
                        modifier = Modifier.fillMaxSize()
                    )
                }
            }
            is AppletContainerState.Error -> AppletErrorView(
                message = state.message,
                onRetry = { containerState = AppletContainerState.Loading }
            )
        }
    }
}
```

状态机：`Loading` -> `Running` / `Error`。组件销毁时自动 unload。

---

## 依赖注入

### Android Hilt 配置

`AppletModule` 在 Hilt 中提供所有 Lynx/Bridge 相关的依赖：

```kotlin
@Module
@InstallIn(SingletonComponent::class)
object AppletModule {

    @Provides @Singleton
    fun provideLynxEngineManager(): LynxEngineManager = LynxEngineManager()

    @Provides @Singleton
    fun provideLynxViewFactory(mgr: LynxEngineManager): LynxViewFactory = LynxViewFactory(mgr)

    // 6 个 Bridge 模块通过 @IntoSet 注入到 Set<BridgeModule>
    @Provides @IntoSet
    fun provideSystemBridgeModule(@ApplicationContext ctx: Context): BridgeModule = SystemBridgeModule(ctx)

    @Provides @IntoSet
    fun provideStorageBridgeModule(@ApplicationContext ctx: Context): BridgeModule = StorageBridgeModule(ctx)

    @Provides @IntoSet
    fun provideNetworkBridgeModule(client: OkHttpClient): BridgeModule = NetworkBridgeModule(client)

    @Provides @IntoSet
    fun provideNotificationBridgeModule(@ApplicationContext ctx: Context): BridgeModule = NotificationBridgeModule(ctx)

    @Provides @IntoSet
    fun provideDeviceBridgeModule(@ApplicationContext ctx: Context): BridgeModule = DeviceBridgeModule(ctx)

    @Provides @IntoSet
    fun provideUIBridgeModule(@ApplicationContext ctx: Context): BridgeModule = UIBridgeModule(ctx)

    // BridgeDispatcher 接收完整的 Set<BridgeModule>
    @Provides @Singleton
    fun provideBridgeDispatcher(modules: Set<@JvmSuppressWildcards BridgeModule>): BridgeDispatcher {
        return BridgeDispatcher(modules)
    }

    @Provides @Singleton
    fun provideAppletBundleStorage(@ApplicationContext ctx: Context): AppletBundleStorage {
        return AppletBundleStorage(ctx)
    }

    @Provides @Singleton
    fun provideAppletManager(
        storage: AppletBundleStorage,
        dispatcher: BridgeDispatcher
    ): AppletManager = AppletManager(storage, dispatcher)
}
```

Hilt 的 `@IntoSet` 多绑定机制让新增模块只需添加一个 `@Provides @IntoSet` 方法，无需修改 BridgeDispatcher。

### iOS Container 配置

iOS 端在 `Container.swift` 中手动组装所有依赖：

```swift
final class Container: @unchecked Sendable {
    static let shared = Container()

    let lynxEngineManager: LynxEngineManager
    let lynxViewFactory: LynxViewFactory
    let bridgeDispatcher: BridgeDispatcher
    let appletManager: AppletManager
    let appletBundleStorage: AppletBundleStorage

    private init() {
        let lynxEngineManager = LynxEngineManager.shared
        let lynxViewFactory = LynxViewFactory(engineManager: lynxEngineManager)

        let bridgeDispatcher = BridgeDispatcher(modules: [
            SystemBridgeModule(),
            StorageBridgeModule(),
            NetworkBridgeModule(),
            NotificationBridgeModule(),
            DeviceBridgeModule(),
            UIBridgeModule()
        ])

        let appletBundleStorage = AppletBundleStorage()
        let appletManager = AppletManager(
            bundleStorage: appletBundleStorage,
            bridgeDispatcher: bridgeDispatcher
        )

        self.lynxEngineManager = lynxEngineManager
        self.lynxViewFactory = lynxViewFactory
        self.bridgeDispatcher = bridgeDispatcher
        self.appletManager = appletManager
        self.appletBundleStorage = appletBundleStorage
    }
}
```

新增模块时，在 `BridgeDispatcher(modules: [...])` 数组中追加即可。
