# iOS 开发指南

本文档基于 `apps/mobile/ios` 目录下的真实代码编写,是 PeersTouch iOS 端的技术参考手册。

---

## 技术栈

| 分类 | 技术选型 |
|------|---------|
| 语言 | Swift |
| UI 框架 | SwiftUI |
| 并发模型 | Swift Concurrency (async/await, Task, AsyncStream) |
| 本地存储 | SwiftData (ModelContainer) + UserDefaults |
| 网络层 | URLSession (原生) |
| Applet 渲染 | Lynx Engine |
| 架构模式 | MVVM (SwiftUI 原生模式) |

---

## 架构分层

```
App                 PeersTouchApp + AppDelegate (入口与生命周期)
    |
Navigation          Router + AppTabView (导航与路由)
    |
Features            Views + ViewModels + Repositories (按功能模块组织)
    |
Core                Network, Storage, Event, Lynx, Applet, Theme (基础设施)
    |
DI                  Container.shared (手动依赖注入)
```

---

## 应用入口

### PeersTouchApp

```swift
// App/PeersTouchApp.swift
@main
struct PeersTouchApp: App {
    @UIApplicationDelegateAdaptor(AppDelegate.self) private var appDelegate
    @State private var router = Router()

    init() {
        LynxEngineManager.shared.initialize()
    }

    var body: some Scene {
        WindowGroup {
            AppTabView()
                .environment(router)
        }
    }
}
```

`@main` 标记为应用入口。在 `init()` 中初始化 Lynx 引擎。`Router` 通过 `.environment()` 注入到整个视图树中。

### AppDelegate

```swift
// App/AppDelegate.swift
final class AppDelegate: NSObject, UIApplicationDelegate {
    func application(
        _ application: UIApplication,
        didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil
    ) -> Bool {
        return true
    }

    func application(
        _ application: UIApplication,
        didRegisterForRemoteNotificationsWithDeviceToken deviceToken: Data
    ) {
        let token = deviceToken.map { String(format: "%02.2hhx", $0) }.joined()
        _ = token
    }

    func application(
        _ application: UIApplication,
        didFailToRegisterForRemoteNotificationsWithError error: Error
    ) {
    }
}
```

最小化实现,负责远程推送注册回调。通过 `@UIApplicationDelegateAdaptor` 桥接到 SwiftUI 生命周期。

---

## 依赖注入 (Container)

```swift
// DI/Container.swift
final class Container: @unchecked Sendable {
    static let shared = Container()

    let apiClient: APIClient
    let appDatabase: AppDatabase
    let preferenceStore: PreferenceStore
    let eventStreamClient: EventStreamClient

    let lynxEngineManager: LynxEngineManager
    let lynxViewFactory: LynxViewFactory
    let bridgeDispatcher: BridgeDispatcher
    let appletManager: AppletManager
    let appletBundleStorage: AppletBundleStorage

    private init() {
        let preferenceStore = PreferenceStore()
        let apiClient = APIClient(
            baseURL: preferenceStore.stationBaseURL,
            authInterceptor: AuthInterceptor(preferenceStore: preferenceStore)
        )
        let appDatabase = AppDatabase()
        let eventStreamClient = EventStreamClient()
        let appletBundleStorage = AppletBundleStorage()
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

        let appletManager = AppletManager(
            bundleStorage: appletBundleStorage,
            bridgeDispatcher: bridgeDispatcher
        )

        self.apiClient = apiClient
        self.appDatabase = appDatabase
        self.preferenceStore = preferenceStore
        self.eventStreamClient = eventStreamClient
        self.lynxEngineManager = lynxEngineManager
        self.lynxViewFactory = lynxViewFactory
        self.bridgeDispatcher = bridgeDispatcher
        self.appletManager = appletManager
        self.appletBundleStorage = appletBundleStorage
    }
}
```

采用手动 DI 方式,`Container.shared` 单例持有全部核心服务。构造顺序严格按照依赖链:

```
PreferenceStore
    -> AuthInterceptor -> APIClient
AppDatabase
EventStreamClient
AppletBundleStorage
LynxEngineManager.shared -> LynxViewFactory
6 BridgeModules -> BridgeDispatcher
AppletBundleStorage + BridgeDispatcher -> AppletManager
```

Feature 层的 Repository 通过 `Container.shared.apiClient` 访问:

```swift
final class HomeRepository: Sendable {
    private let apiClient: APIClient

    init(apiClient: APIClient = Container.shared.apiClient) {
        self.apiClient = apiClient
    }
}
```

---

## 导航系统

### Route (路由定义)

```swift
// Navigation/Routes.swift
enum Route: Hashable {
    case chat
    case imChat(id: String)
    case imAddFriend
    case aiChat
    case login
    case appletDetail(id: String)
}
```

使用 `Hashable` 枚举,关联值传递参数(如 `imChat(id:)`、`appletDetail(id:)`)。

### Router

```swift
// Navigation/Router.swift
@Observable
final class Router {
    var path = NavigationPath()

    func navigate(to route: Route) {
        path.append(route)
    }

    func pop() {
        guard !path.isEmpty else { return }
        path.removeLast()
    }

    func popToRoot() {
        path = NavigationPath()
    }
}
```

使用 iOS 17+ 的 `@Observable` 宏(替代 `ObservableObject`)。基于 `NavigationPath` 实现类型安全的编程式导航。

### AppTabView

```swift
// Navigation/AppTabView.swift
struct AppTabView: View {
    @Environment(Router.self) private var router
    @State private var selectedTab: Tab = .home

    enum Tab: String, CaseIterable {
        case home, im, ai, settings

        var icon: String {
            switch self {
            case .home: return "house.fill"
            case .im: return "message.fill"
            case .ai: return "sparkles"
            case .settings: return "gearshape.fill"
            }
        }

        var label: String {
            switch self {
            case .home: return "首页"
            case .im: return "消息"
            case .ai: return "AI助手"
            case .settings: return "设置"
            }
        }
    }

    var body: some View {
        @Bindable var router = router
        TabView(selection: $selectedTab) {
            NavigationStack(path: $router.path) {
                HomeScreen()
                    .navigationDestination(for: Route.self) { route in
                        destinationView(for: route)
                    }
            }
            .tag(Tab.home)
            .tabItem {
                Image(systemName: Tab.home.icon)
                Text(Tab.home.label)
            }

            // im, ai, settings 各自一个 NavigationStack
            // ...
        }
        .tint(Color(red: 0.420, green: 0.275, blue: 0.757))
    }

    @ViewBuilder
    func destinationView(for route: Route) -> some View {
        switch route {
        case .imChat(let id):
            IMChatDetailScreen(chatId: id)
        case .imAddFriend:
            IMAddFriendScreen()
        case .aiChat:
            AIChatScreen()
        case .login:
            LoginScreen()
        case .appletDetail(let id):
            AppletContainerView(appletId: id)
        case .chat:
            IMChatScreen()
        }
    }
}
```

4 个 Tab 页:首页 (Home)、消息 (IM)、AI 助手、设置。每个 Tab 内嵌独立 `NavigationStack`,共享同一 `Router.path`。`@Bindable` 用于从 `@Observable` 对象提取绑定。

---

## 主题系统

### Theme 结构体

```swift
// Core/Theme/Theme.swift
struct Theme {
    static let colors = ColorTokens()
    static let typography = Typography()

    static let cornerRadiusXS: CGFloat = 4
    static let cornerRadiusS: CGFloat = 6
    static let cornerRadius: CGFloat = 8
    static let cornerRadiusM: CGFloat = 10
    static let cornerRadiusL: CGFloat = 12
    static let cornerRadiusXL: CGFloat = 16

    static let spacingXS: CGFloat = 4      // 间距基数 4pt
    static let spacingS: CGFloat = 8
    static let spacingM: CGFloat = 12
    static let spacingL: CGFloat = 16
    static let spacingXL: CGFloat = 24
    static let spacingXXL: CGFloat = 32

    static let iconSizeSmall: CGFloat = 16
    static let iconSizeMedium: CGFloat = 24
    static let iconSizeLarge: CGFloat = 32
}
```

全部通过 `static` 属性访问,无需实例化。间距采用 4pt 基准系统。

### ColorTokens

```swift
// Core/Theme/ColorTokens.swift
struct ColorTokens {
    // Asset Catalog 颜色 (支持 Light/Dark 自动切换)
    let primary = Color("Primary", bundle: .main)
    let primaryVariant = Color("PrimaryVariant", bundle: .main)
    let secondary = Color("Secondary", bundle: .main)
    let secondaryVariant = Color("SecondaryVariant", bundle: .main)

    let background = Color("Background", bundle: .main)
    let surface = Color("Surface", bundle: .main)
    let surfaceVariant = Color("SurfaceVariant", bundle: .main)

    let textPrimary = Color("TextPrimary", bundle: .main)
    let textSecondary = Color("TextSecondary", bundle: .main)
    let textTertiary = Color("TextTertiary", bundle: .main)
    let textDisabled = Color("TextDisabled", bundle: .main)

    let error = Color("Error", bundle: .main)
    let success = Color("Success", bundle: .main)
    let warning = Color("Warning", bundle: .main)
    let info = Color("Info", bundle: .main)

    let border = Color("Border", bundle: .main)
    let divider = Color("Divider", bundle: .main)
    let overlay = Color("Overlay", bundle: .main)

    // Fallback 颜色 (Asset Catalog 缺失时使用)
    var fallbackPrimary: Color { Color(red: 0.420, green: 0.275, blue: 0.757) }
    var fallbackBackground: Color { Color(.systemBackground) }
    var fallbackSurface: Color { Color(.secondarySystemBackground) }
    var fallbackTextPrimary: Color { Color(.label) }
    var fallbackTextSecondary: Color { Color(.secondaryLabel) }
    var fallbackError: Color { Color(red: 0.937, green: 0.267, blue: 0.267) }
    var fallbackSuccess: Color { Color(red: 0.133, green: 0.773, blue: 0.369) }
    var fallbackWarning: Color { Color(red: 0.961, green: 0.620, blue: 0.043) }
}
```

颜色来源优先从 Asset Catalog 读取(自动适配 Light/Dark),提供 fallback 兜底。使用方式:

```swift
Text("Hello")
    .foregroundColor(Theme.colors.textPrimary)
    .background(Theme.colors.surface)
```

### Typography

```swift
// Core/Theme/Typography.swift
struct Typography {
    let largeTitle   = Font.system(size: 34, weight: .bold, design: .default)
    let title1       = Font.system(size: 28, weight: .bold, design: .default)
    let title2       = Font.system(size: 22, weight: .bold, design: .default)
    let title3       = Font.system(size: 20, weight: .semibold, design: .default)
    let headline     = Font.system(size: 17, weight: .semibold, design: .default)
    let body         = Font.system(size: 17, weight: .regular, design: .default)
    let callout      = Font.system(size: 16, weight: .regular, design: .default)
    let subheadline  = Font.system(size: 15, weight: .regular, design: .default)
    let footnote     = Font.system(size: 13, weight: .regular, design: .default)
    let caption1     = Font.system(size: 12, weight: .regular, design: .default)
    let caption2     = Font.system(size: 11, weight: .regular, design: .default)

    let monoBody     = Font.system(size: 17, weight: .regular, design: .monospaced)
    let monoCaption  = Font.system(size: 12, weight: .regular, design: .monospaced)
}
```

对齐 iOS Dynamic Type 的全部尺寸档位,额外提供等宽字体变体。使用方式:

```swift
Text("标题")
    .font(Theme.typography.title1)
```

---

## Feature 模块结构

iOS 端的 Feature 模块目录结构:

```
Features/<Name>/
  Views/          SwiftUI 视图
  ViewModels/     @Observable ViewModel
  Repositories/   数据访问层
```

以 Home 为例:

### HomeRepository

```swift
// Features/Home/Repositories/HomeRepository.swift
final class HomeRepository: Sendable {
    private let apiClient: APIClient

    init(apiClient: APIClient = Container.shared.apiClient) {
        self.apiClient = apiClient
    }
}
```

通过默认参数引用 `Container.shared` 实现隐式注入,测试时可替换。

### HomeViewModel

```swift
// Features/Home/ViewModels/HomeViewModel.swift
@Observable
final class HomeViewModel {
    private let repository: HomeRepository

    var isLoading = false

    init(repository: HomeRepository = HomeRepository()) {
        self.repository = repository
    }
}
```

使用 `@Observable` (iOS 17+) 替代 `ObservableObject + @Published`,简化状态管理。

### HomeScreen

```swift
// Features/Home/Views/HomeScreen.swift
struct HomeScreen: View {
    private let brandPurple = Color(red: 0.420, green: 0.275, blue: 0.757)

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 24) {
                searchBar
                pinnedSection
                trackingSection
            }
            .padding(.horizontal, 20)
            .padding(.top, 16)
        }
        .background(Color(red: 0.969, green: 0.973, blue: 0.976))
        .navigationBarHidden(true)
    }
}
```

### 全部 Feature 列表

| Feature | Tab | 说明 |
|---------|-----|------|
| Home | home | 首页 (Pinned + Tracking) |
| Chat (IM) | im | 即时通讯 (会话列表、聊天详情、加好友) |
| AI | ai | AI 对话 |
| Settings | settings | 设置 |
| Auth | - | 登录/认证 |
| Profile | - | 个人主页 |
| Applets | - | 小程序 |
| Channels | - | 频道 |
| Memory | - | 记忆管理 |
| Search | - | 搜索 |
| Skills | - | 技能 |
| Timeline | - | 时间线 |

---

## 网络层

### APIClient

```swift
// Core/Network/APIClient.swift
enum HTTPMethod: String, Sendable {
    case get = "GET"
    case post = "POST"
    case put = "PUT"
    case delete = "DELETE"
    case patch = "PATCH"
}

enum APIError: Error, Sendable {
    case invalidURL
    case invalidResponse
    case httpError(statusCode: Int, data: Data)
    case decodingError(Error)
    case networkError(Error)
    case unauthorized
}

final class APIClient: @unchecked Sendable {
    let baseURL: URL
    private let session: URLSession
    private let authInterceptor: AuthInterceptor
    private let decoder: JSONDecoder
    private let encoder: JSONEncoder

    init(baseURL: URL, authInterceptor: AuthInterceptor) {
        self.baseURL = baseURL
        self.authInterceptor = authInterceptor

        let configuration = URLSessionConfiguration.default
        configuration.timeoutIntervalForRequest = 30
        configuration.timeoutIntervalForResource = 60
        self.session = URLSession(configuration: configuration)

        let decoder = JSONDecoder()
        decoder.keyDecodingStrategy = .convertFromSnakeCase
        decoder.dateDecodingStrategy = .iso8601
        self.decoder = decoder

        let encoder = JSONEncoder()
        encoder.keyEncodingStrategy = .convertToSnakeCase
        encoder.dateEncodingStrategy = .iso8601
        self.encoder = encoder
    }

    func request<T: Decodable & Sendable>(
        endpoint: String,
        method: HTTPMethod = .get,
        body: (any Encodable & Sendable)? = nil,
        headers: [String: String]? = nil
    ) async throws -> T {
        guard let url = URL(string: endpoint, relativeTo: baseURL) else {
            throw APIError.invalidURL
        }

        var urlRequest = URLRequest(url: url)
        urlRequest.httpMethod = method.rawValue
        urlRequest.setValue("application/json", forHTTPHeaderField: "Content-Type")

        if let body {
            urlRequest.httpBody = try encoder.encode(body)
        }

        urlRequest = authInterceptor.intercept(request: urlRequest)

        let (data, response) = try await session.data(for: urlRequest)

        guard let httpResponse = response as? HTTPURLResponse else {
            throw APIError.invalidResponse
        }

        guard (200..<300).contains(httpResponse.statusCode) else {
            if httpResponse.statusCode == 401 {
                throw APIError.unauthorized
            }
            throw APIError.httpError(statusCode: httpResponse.statusCode, data: data)
        }

        return try decoder.decode(T.self, from: data)
    }

    func requestVoid(
        endpoint: String,
        method: HTTPMethod = .post,
        body: (any Encodable & Sendable)? = nil,
        headers: [String: String]? = nil
    ) async throws {
        let _: EmptyResponse = try await request(
            endpoint: endpoint,
            method: method,
            body: body,
            headers: headers
        )
    }
}
```

纯 URLSession 实现,内置 snake_case/camelCase 自动转换、ISO 8601 日期解析。泛型 `request<T>` 方法自动解码响应。

### AuthInterceptor

```swift
// Core/Network/AuthInterceptor.swift
final class AuthInterceptor: @unchecked Sendable {
    private let preferenceStore: PreferenceStore

    init(preferenceStore: PreferenceStore) {
        self.preferenceStore = preferenceStore
    }

    func intercept(request: URLRequest) -> URLRequest {
        var mutableRequest = request
        if let token = preferenceStore.accessToken {
            mutableRequest.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        }
        return mutableRequest
    }
}
```

从 `PreferenceStore` 读取 token,附加到请求头。

### StationAPI (端点定义)

```swift
// Core/Network/StationAPI.swift
enum StationEndpoint: Sendable {
    case signUp
    case login
    case logout
    case getProfile
    case updateProfile
    case verifySession
    case getPublicProfile(actor: String)
    case getActorBasicInfo(id: String)
    case listActors
    case searchActors(query: String)

    case createFriendChatSession
    case getFriendChatSessions
    case sendFriendMessage
    case getFriendMessages(sessionId: String)
    // ... 好友聊天、群聊、AI 对话、事件、社交、小程序、OSS、搜索等

    var path: String {
        switch self {
        case .signUp:    "/activitypub/sign-up"
        case .login:     "/activitypub/login"
        case .logout:    "/activitypub/logout"
        // ...
        case .health:    "/management/health"
        }
    }

    var method: HTTPMethod {
        switch self {
        case .signUp, .login, .logout, .updateProfile,
             .createFriendChatSession, .sendFriendMessage, /* ... */:
            .post
        default:
            .get
        }
    }
}
```

通过枚举关联值传递参数,每个 case 同时定义 path 和 method。与 Android 端的 Retrofit 接口一一对应。

---

## 存储层

### PreferenceStore

```swift
// Core/Storage/PreferenceStore.swift
final class PreferenceStore: @unchecked Sendable {
    private let defaults: UserDefaults

    init(defaults: UserDefaults = .standard) {
        self.defaults = defaults
    }

    var accessToken: String? {
        get { defaults.string(forKey: Keys.accessToken) }
        set { defaults.set(newValue, forKey: Keys.accessToken) }
    }

    var refreshToken: String? {
        get { defaults.string(forKey: Keys.refreshToken) }
        set { defaults.set(newValue, forKey: Keys.refreshToken) }
    }

    var stationBaseURL: URL {
        get {
            if let urlString = defaults.string(forKey: Keys.stationBaseURL),
               let url = URL(string: urlString) {
                return url
            }
            return URL(string: "http://localhost:3000")!
        }
        set { defaults.set(newValue.absoluteString, forKey: Keys.stationBaseURL) }
    }

    var isOnboarded: Bool {
        get { defaults.bool(forKey: Keys.isOnboarded) }
        set { defaults.set(newValue, forKey: Keys.isOnboarded) }
    }

    var userId: String? {
        get { defaults.string(forKey: Keys.userId) }
        set { defaults.set(newValue, forKey: Keys.userId) }
    }

    func clear() {
        Keys.allKeys.forEach { defaults.removeObject(forKey: $0) }
    }
}
```

基于 UserDefaults,使用计算属性封装读写。Key 前缀 `pt_` 避免冲突。存储键:

| Key | 类型 | 说明 |
|-----|------|------|
| `pt_access_token` | String? | 访问令牌 |
| `pt_refresh_token` | String? | 刷新令牌 |
| `pt_station_base_url` | URL | Station 服务地址 |
| `pt_is_onboarded` | Bool | 是否完成引导 |
| `pt_user_id` | String? | 用户 ID |

### AppDatabase

```swift
// Core/Storage/AppDatabase.swift
final class AppDatabase: Sendable {
    let modelContainer: ModelContainer

    init() {
        let schema = Schema([])
        let configuration = ModelConfiguration(
            schema: schema,
            isStoredInMemoryOnly: false
        )
        do {
            self.modelContainer = try ModelContainer(
                for: schema,
                configurations: [configuration]
            )
        } catch {
            fatalError("Failed to create ModelContainer: \(error)")
        }
    }

    @MainActor
    var modelContext: ModelContext {
        modelContainer.mainContext
    }
}
```

基于 SwiftData (`ModelContainer` / `ModelContext`),当前 schema 为空,按需添加 `@Model` 类型。`modelContext` 限定在主线程访问。

---

## 事件系统

### EventStreamClient

```swift
// Core/Event/EventStreamClient.swift
struct StationEvent: Sendable {
    let type: String
    let data: String
    let id: String?
}

final class EventStreamClient: @unchecked Sendable {
    private let session: URLSession
    private var currentTask: Task<Void, Never>?

    init() {
        let configuration = URLSessionConfiguration.default
        configuration.timeoutIntervalForRequest = .infinity
        configuration.timeoutIntervalForResource = .infinity
        self.session = URLSession(configuration: configuration)
    }

    func connect(baseURL: URL, token: String) -> AsyncStream<StationEvent> {
        let url = baseURL.appendingPathComponent("events/stream")

        return AsyncStream { continuation in
            let task = Task {
                do {
                    var request = URLRequest(url: url)
                    request.setValue("text/event-stream", forHTTPHeaderField: "Accept")
                    request.setValue("no-cache", forHTTPHeaderField: "Cache-Control")
                    request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")

                    let (bytes, _) = try await session.bytes(for: request)
                    var eventType: String?
                    var eventId: String?
                    var dataBuffer = ""

                    for try await line in bytes.lines {
                        if line.hasPrefix("event:") {
                            eventType = String(line.dropFirst(6)).trimmingCharacters(in: .whitespaces)
                        } else if line.hasPrefix("data:") {
                            let data = String(line.dropFirst(5)).trimmingCharacters(in: .whitespaces)
                            if !dataBuffer.isEmpty { dataBuffer.append("\n") }
                            dataBuffer.append(data)
                        } else if line.hasPrefix("id:") {
                            eventId = String(line.dropFirst(3)).trimmingCharacters(in: .whitespaces)
                        } else if line.isEmpty, !dataBuffer.isEmpty {
                            continuation.yield(StationEvent(
                                type: eventType ?? "message",
                                data: dataBuffer,
                                id: eventId
                            ))
                            eventType = nil
                            eventId = nil
                            dataBuffer = ""
                        }
                    }
                    continuation.finish()
                } catch {
                    continuation.finish()
                }
            }

            self.currentTask = task
            continuation.onTermination = { _ in task.cancel() }
        }
    }

    func disconnect() {
        currentTask?.cancel()
        currentTask = nil
        session.invalidateAndCancel()
    }
}
```

使用 `URLSession.bytes(for:)` + `AsyncStream` 实现 SSE,逐行解析 event/data/id 字段。连接使用无限超时配置。消费方式:

```swift
let stream = eventStreamClient.connect(baseURL: url, token: token)
for await event in stream {
    // event.type, event.data
}
```

### EventRouter

```swift
// Core/Event/EventRouter.swift
typealias EventHandler = @Sendable (StationEvent) -> Void

final class EventRouter: @unchecked Sendable {
    private var handlers: [String: [EventHandler]] = [:]
    private let lock = NSLock()

    func register(eventType: String, handler: @escaping EventHandler) {
        lock.withLock {
            handlers[eventType, default: []].append(handler)
        }
    }

    func dispatch(event: StationEvent) {
        let matchedHandlers: [EventHandler] = lock.withLock {
            handlers[event.type] ?? []
        }
        for handler in matchedHandlers {
            handler(event)
        }
    }

    func removeAll(for eventType: String) {
        lock.withLock {
            handlers.removeValue(forKey: eventType)
        }
    }
}
```

线程安全的事件路由,使用 `NSLock` 保护 handlers 字典。

---

## Lynx 集成

### LynxEngineManager

```swift
// Core/Lynx/LynxEngineManager.swift
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

全局单例,线程安全。在 `PeersTouchApp.init()` 中初始化。

### LynxViewFactory

```swift
// Core/Lynx/LynxViewFactory.swift
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

创建 `LynxView` 并加载 bundle。`config` 从 `LynxEngineManager` 传入。

### BridgeDispatcher

```swift
// Core/Lynx/Bridge/BridgeDispatcher.swift
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

    // "module.method" 格式便捷调用
    func invoke(api: String, params: [String: Any]?) async -> BridgeResult {
        let components = api.split(separator: ".", maxSplits: 1)
        guard components.count == 2 else {
            return .error(code: "BRIDGE_INVALID_PARAMS", message: "API format must be 'module.method'")
        }
        return await invoke(module: String(components[0]), method: String(components[1]), params: params)
    }

    func register(module: any BridgeModule) {
        lock.withLock { modules[module.moduleName] = module }
    }

    func hasModule(_ moduleName: String) -> Bool {
        lock.withLock { modules[moduleName] != nil }
    }

    func getRegisteredModules() -> Set<String> {
        lock.withLock { Set(modules.keys) }
    }
}
```

6 个 Bridge 模块:

| 模块 | 文件 | 职责 |
|------|------|------|
| `SystemBridgeModule` | Bridge/SystemBridgeModule.swift | 系统信息 |
| `StorageBridgeModule` | Bridge/StorageBridgeModule.swift | 本地存储 |
| `NetworkBridgeModule` | Bridge/NetworkBridgeModule.swift | 网络请求代理 |
| `NotificationBridgeModule` | Bridge/NotificationBridgeModule.swift | 推送通知 |
| `DeviceBridgeModule` | Bridge/DeviceBridgeModule.swift | 设备信息 |
| `UIBridgeModule` | Bridge/UIBridgeModule.swift | 原生 UI 交互 |

### AppletContainerView

```swift
// Core/Applet/UI/AppletContainerView.swift
struct AppletContainerView: View {
    let appletId: String

    @State private var viewState: ViewState = .loading
    @State private var errorMessage: String?

    private let appletManager = Container.shared.appletManager
    private let lynxViewFactory = Container.shared.lynxViewFactory

    enum ViewState {
        case loading
        case running
        case error
    }

    var body: some View {
        Group {
            switch viewState {
            case .loading:
                AppletLoadingView(appletName: appletId)
            case .running:
                LynxViewRepresentable(appletId: appletId)
            case .error:
                AppletErrorView(
                    message: errorMessage ?? "Unknown error",
                    onRetry: { loadApplet() }
                )
            }
        }
        .task { loadApplet() }
    }
}

struct LynxViewRepresentable: UIViewRepresentable {
    let appletId: String

    func makeUIView(context: Context) -> UIView {
        let container = Container.shared
        guard let info = container.appletManager.getAppletInfo(id: appletId),
              let bundlePath = container.appletBundleStorage.bundlePath(for: appletId),
              let session = container.appletManager.getApplet(id: appletId) else {
            let errorView = UIView()
            errorView.backgroundColor = .systemRed
            return errorView
        }
        let entryURL = bundlePath.appendingPathComponent(info.main)
        return container.lynxViewFactory.create(bundleURL: entryURL, bridgeSession: session)
    }

    func updateUIView(_ uiView: UIView, context: Context) {}
}
```

通过 `UIViewRepresentable` 将 UIKit 的 `LynxView` 嵌入 SwiftUI 视图树。状态机:Loading -> Running / Error。

---

## 目录结构总览

```
PeersTouch/
  App/
    PeersTouchApp.swift                  # @main 应用入口
    AppDelegate.swift                    # UIApplicationDelegate
  DI/
    Container.swift                      # 手动 DI 容器 (单例)
  Navigation/
    Routes.swift                         # Route 枚举
    Router.swift                         # @Observable 路由器
    AppTabView.swift                     # 根 TabView (4 个 Tab)
  Core/
    Theme/
      Theme.swift                        # 间距、圆角、图标尺寸
      ColorTokens.swift                  # Asset Catalog 色彩 + Fallback
      Typography.swift                   # 字体档位 (11 + 2 mono)
    Network/
      APIClient.swift                    # URLSession 网络客户端
      AuthInterceptor.swift             # Bearer Token 拦截器
      StationAPI.swift                   # Station 端点枚举
    Storage/
      PreferenceStore.swift             # UserDefaults 偏好存储
      AppDatabase.swift                  # SwiftData 数据库
    Event/
      EventStreamClient.swift           # SSE 客户端 (AsyncStream)
      EventRouter.swift                  # 事件分发路由
    Lynx/
      LynxEngineManager.swift           # Lynx 引擎 (全局单例)
      LynxViewFactory.swift             # LynxView 工厂
      Bridge/
        BridgeDispatcher.swift          # Bridge 分发器
        SystemBridgeModule.swift
        StorageBridgeModule.swift
        NetworkBridgeModule.swift
        NotificationBridgeModule.swift
        DeviceBridgeModule.swift
        UIBridgeModule.swift
    Applet/
      AppletManager.swift               # Applet 生命周期管理
      AppletBundleStorage.swift         # Bundle 本地缓存
      AppletBridgeSession.swift         # Bridge 会话
      AppletManifestParser.swift        # Manifest 解析
      AppletState.swift                  # 状态枚举
      UI/
        AppletContainerView.swift       # Applet 渲染容器
        AppletLoadingView.swift
        AppletErrorView.swift
  Features/
    Home/       { Views/, ViewModels/, Repositories/ }
    Chat/       { Views/, ViewModels/, Repositories/ }
    AI/         { Views/, ViewModels/, Repositories/ }
    Auth/       { Views/, ViewModels/, Repositories/ }
    Applets/    { Views/, ViewModels/, Repositories/ }
    Channels/   { Views/, ViewModels/, Repositories/ }
    Memory/     { Views/, ViewModels/, Repositories/ }
    Profile/    { Views/, ViewModels/, Repositories/ }
    Search/     { Views/, ViewModels/, Repositories/ }
    Settings/   { Views/, ViewModels/, Repositories/ }
    Skills/     { Views/, ViewModels/, Repositories/ }
    Timeline/   { Views/, ViewModels/, Repositories/ }
```

---

## 与 Android 端的关键差异

| 维度 | Android | iOS |
|------|---------|-----|
| DI | Hilt (编译时注入) | Container.shared (手动单例) |
| 导航 | NavHost + sealed class Routes | NavigationStack + enum Route |
| 状态管理 | `@HiltViewModel` + StateFlow | `@Observable` + @State |
| 网络 | Retrofit + OkHttp | URLSession (原生) |
| SSE | OkHttp EventSources + SharedFlow | URLSession.bytes + AsyncStream |
| 本地 KV | DataStore<Preferences> + Flow | UserDefaults + 计算属性 |
| 数据库 | Room | SwiftData |
| Lynx 桥接 | AndroidView (Compose -> View) | UIViewRepresentable (SwiftUI -> UIView) |
| 线程安全 | Coroutine 调度 | NSLock + @unchecked Sendable |
