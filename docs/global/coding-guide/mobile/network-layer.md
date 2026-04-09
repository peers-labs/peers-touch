# Mobile 网络层开发指南

本文档详细介绍 Peers-Touch Mobile 端（Android / iOS）的网络层架构、核心组件、依赖注入以及错误处理链路。
两端在设计上保持对齐：统一的 Bearer Token 认证、Station Base URL 管理、Interceptor 拦截模式。

---

## 目录

1. [架构总览](#架构总览)
2. [Android 网络层](#android-网络层)
   - [OkHttpClient + Retrofit 架构](#okhttpclient--retrofit-架构)
   - [AuthInterceptor](#android-authinterceptor)
   - [ApiClient](#android-apiclient)
   - [StationApi Retrofit 接口](#stationapi-retrofit-接口)
   - [NetworkModule Hilt DI](#networkmodule-hilt-di)
   - [错误处理链路](#android-错误处理链路)
3. [iOS 网络层](#ios-网络层)
   - [APIClient (URLSession)](#ios-apiclient)
   - [AuthInterceptor](#ios-authinterceptor)
   - [StationEndpoint 类型安全路由](#stationendpoint-类型安全路由)
   - [Container.swift DI](#containerswift-di)
   - [错误处理链路](#ios-错误处理链路)
4. [双端共享模式](#双端共享模式)
   - [Station Base URL 管理](#station-base-url-管理)
   - [Bearer Token 认证](#bearer-token-认证)
   - [超时与重试策略](#超时与重试策略)
   - [错误处理链：Network -> Repository -> ViewModel/View](#错误处理链)

---

## 架构总览

```
┌─────────────┐      ┌────────────────┐      ┌──────────────────┐
│  ViewModel   │ ---> │   Repository   │ ---> │   Network Layer  │
│  (UI State)  │      │  (数据协调)     │      │  (HTTP 通信)      │
└─────────────┘      └────────────────┘      └──────────────────┘
                                                      │
                                              ┌───────┴────────┐
                                              │ AuthInterceptor │
                                              │ (Token 注入)    │
                                              └───────┬────────┘
                                                      │
                                              ┌───────┴────────┐
                                              │ PreferenceStore │
                                              │ (Token/URL 存储)│
                                              └────────────────┘
```

Android 使用 OkHttpClient + Retrofit 技术栈；iOS 使用原生 URLSession。
两端均通过 AuthInterceptor 在请求发出前自动注入 Bearer Token，Token 统一从 PreferenceStore 读取。

---

## Android 网络层

### OkHttpClient + Retrofit 架构

Android 网络层基于 Square 的 OkHttp + Retrofit 构建：

- **OkHttpClient** -- HTTP 客户端，负责连接管理、超时配置、Interceptor 链
- **Retrofit** -- 类型安全的 HTTP 客户端，将接口方法映射为 HTTP 请求
- **GsonConverterFactory** -- JSON 序列化/反序列化

依赖关系：

```
OkHttpClient (含 AuthInterceptor + LoggingInterceptor)
      │
      ▼
  Retrofit (baseUrl + client + GsonConverterFactory)
      │
      ▼
  StationApi (Retrofit 接口)
      │
      ▼
  ApiClient (封装 Retrofit.create)
```

### Android AuthInterceptor

`AuthInterceptor` 实现 OkHttp 的 `Interceptor` 接口，在每个请求发出前自动注入认证头。

**源文件**: `apps/mobile/android/.../core/network/AuthInterceptor.kt`

```kotlin
class AuthInterceptor(
    private val preferenceStore: PreferenceStore
) : Interceptor {

    override fun intercept(chain: Interceptor.Chain): Response {
        val token = runBlocking { preferenceStore.getAccessToken().firstOrNull() }
        val request = chain.request().newBuilder().apply {
            if (!token.isNullOrBlank()) {
                addHeader("Authorization", "Bearer $token")
            }
            addHeader("Accept", "application/json")
        }.build()
        return chain.proceed(request)
    }
}
```

关键点：
- 通过 `runBlocking` 从 DataStore 的 Flow 中同步获取 Token（OkHttp Interceptor 运行在 IO 线程，不能直接 suspend）
- Token 为空时不添加 Authorization 头（允许匿名请求如 login/signUp）
- 始终添加 `Accept: application/json`

### Android ApiClient

`ApiClient` 是对 Retrofit 的轻量封装，提供泛型 `createService` 方法。

**源文件**: `apps/mobile/android/.../core/network/ApiClient.kt`

```kotlin
@Singleton
class ApiClient @Inject constructor(
    private val retrofit: Retrofit
) {
    fun <T> createService(serviceClass: Class<T>): T {
        return retrofit.create(serviceClass)
    }
}
```

使用方式：

```kotlin
val stationApi = apiClient.createService(StationApi::class.java)
val response = stationApi.login(mapOf("username" to "user", "password" to "pass"))
```

### StationApi Retrofit 接口

`StationApi` 定义了所有与 Station 服务端通信的 HTTP 端点，是 Retrofit 接口。

**源文件**: `apps/mobile/android/.../core/network/StationApi.kt`

```kotlin
interface StationApi {

    @POST("activitypub/login")
    suspend fun login(@Body credentials: Map<String, String>): Response<Map<String, Any>>

    @GET("activitypub/profile")
    suspend fun getProfile(): Response<Map<String, Any>>

    @POST("friend-chat/message/send")
    suspend fun sendFriendChatMessage(@Body message: Map<String, Any>): Response<Map<String, Any>>

    @GET("friend-chat/messages")
    suspend fun getFriendChatMessages(
        @Query("session_id") sessionId: String,
        @Query("limit") limit: Int? = null,
        @Query("before") before: String? = null
    ): Response<List<Map<String, Any>>>

    @POST("ai-chat/chat/completions")
    @Streaming
    suspend fun aiChatCompletions(@Body body: Map<String, Any>): Response<okhttp3.ResponseBody>

    @GET("events/stream")
    @Streaming
    suspend fun getEventStream(): Response<okhttp3.ResponseBody>

    // ...更多端点
}
```

接口设计要点：
- 所有方法均为 `suspend`，支持协程
- 返回 `Response<T>` 而非直接返回 `T`，让 Repository 层能检查 HTTP 状态码
- 流式接口（SSE、AI 补全）使用 `@Streaming` + `ResponseBody`
- 请求体统一使用 `Map<String, Any>` 作为临时方案（后续迁移至 Proto）

### NetworkModule Hilt DI

`NetworkModule` 使用 Hilt 提供网络层所有依赖的单例。

**源文件**: `apps/mobile/android/.../di/NetworkModule.kt`

```kotlin
@Module
@InstallIn(SingletonComponent::class)
object NetworkModule {

    @Provides
    @Singleton
    fun provideAuthInterceptor(preferenceStore: PreferenceStore): AuthInterceptor {
        return AuthInterceptor(preferenceStore)
    }

    @Provides
    @Singleton
    fun provideOkHttpClient(authInterceptor: AuthInterceptor): OkHttpClient {
        val loggingInterceptor = HttpLoggingInterceptor().apply {
            level = HttpLoggingInterceptor.Level.BODY
        }
        return OkHttpClient.Builder()
            .addInterceptor(authInterceptor)
            .addInterceptor(loggingInterceptor)
            .connectTimeout(30, TimeUnit.SECONDS)
            .readTimeout(30, TimeUnit.SECONDS)
            .writeTimeout(30, TimeUnit.SECONDS)
            .build()
    }

    @Provides
    @Singleton
    fun provideRetrofit(okHttpClient: OkHttpClient): Retrofit {
        return Retrofit.Builder()
            .baseUrl("https://api.peerstouch.com/")
            .client(okHttpClient)
            .addConverterFactory(GsonConverterFactory.create())
            .build()
    }

    @Provides
    @Singleton
    fun provideStationApi(retrofit: Retrofit): StationApi {
        return retrofit.create(StationApi::class.java)
    }
}
```

Interceptor 链的执行顺序：
1. `AuthInterceptor` -- 注入 Bearer Token
2. `HttpLoggingInterceptor` -- 记录请求/响应日志（Level.BODY 输出完整内容）

超时配置：
- `connectTimeout`: 30 秒
- `readTimeout`: 30 秒
- `writeTimeout`: 30 秒

### Android 错误处理链路

```
StationApi (Retrofit)
    │
    │ 抛出 HttpException / IOException / etc.
    ▼
Repository
    │
    │ 捕获异常，转换为业务错误或向上传播
    ▼
ViewModel
    │
    │ 更新 UI State（error message / loading / retry）
    ▼
Composable UI
```

Retrofit 的 `Response<T>` 模式允许 Repository 按需检查：

```kotlin
// Repository 层示例
suspend fun login(username: String, password: String): Result<Map<String, Any>> {
    return try {
        val response = stationApi.login(mapOf(
            "username" to username,
            "password" to password
        ))
        if (response.isSuccessful) {
            Result.success(response.body()!!)
        } else {
            Result.failure(Exception("HTTP ${response.code()}"))
        }
    } catch (e: Exception) {
        Result.failure(e)
    }
}
```

---

## iOS 网络层

### iOS APIClient

`APIClient` 基于原生 `URLSession` 构建，提供泛型 `request<T: Decodable>` 方法。

**源文件**: `apps/mobile/ios/PeersTouch/Core/Network/APIClient.swift`

```swift
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

        headers?.forEach { key, value in
            urlRequest.setValue(value, forHTTPHeaderField: key)
        }

        // AuthInterceptor 注入 Token
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

        do {
            return try decoder.decode(T.self, from: data)
        } catch {
            throw APIError.decodingError(error)
        }
    }

    func requestVoid(
        endpoint: String,
        method: HTTPMethod = .post,
        body: (any Encodable & Sendable)? = nil,
        headers: [String: String]? = nil
    ) async throws {
        let _: EmptyResponse = try await request(
            endpoint: endpoint, method: method,
            body: body, headers: headers
        )
    }
}
```

设计要点：
- `baseURL` 从 `PreferenceStore.stationBaseURL` 获取
- 自动 snake_case <-> camelCase 转换
- ISO 8601 日期策略
- `requestVoid` 用于无返回体的请求（如 logout）
- 内置 401 检测，抛出 `APIError.unauthorized`

### iOS AuthInterceptor

**源文件**: `apps/mobile/ios/PeersTouch/Core/Network/AuthInterceptor.swift`

```swift
final class AuthInterceptor: @unchecked Sendable {
    private let preferenceStore: PreferenceStore

    init(preferenceStore: PreferenceStore) {
        self.preferenceStore = preferenceStore
    }

    func intercept(request: URLRequest) -> URLRequest {
        var mutableRequest = request
        if let token = preferenceStore.accessToken {
            mutableRequest.setValue(
                "Bearer \(token)",
                forHTTPHeaderField: "Authorization"
            )
        }
        return mutableRequest
    }
}
```

与 Android 的 OkHttp Interceptor 接口不同，iOS 端的 AuthInterceptor 是一个普通类，在 `APIClient.request` 内部手动调用 `intercept(request:)` 方法。

### StationEndpoint 类型安全路由

`StationEndpoint` 是一个枚举，为每个 API 端点提供类型安全的 URL 构建。

**源文件**: `apps/mobile/ios/PeersTouch/Core/Network/StationAPI.swift`

```swift
enum StationEndpoint: Sendable {
    case signUp
    case login
    case logout
    case getProfile
    case updateProfile
    case verifySession

    case createFriendChatSession
    case getFriendChatSessions
    case sendFriendMessage
    case getFriendMessages(sessionId: String)
    // ...

    case createAIProvider
    case listAIProviders
    case aiCompletions

    case listApplets
    case getAppletDetails(appletId: String)
    case getAppletBundle(appletId: String)

    case health

    var path: String {
        switch self {
        case .login:            "/activitypub/login"
        case .getProfile:       "/activitypub/profile"
        case .getFriendMessages: "/friend-chat/messages"
        case .getPost(let id):  "/api/v1/social/posts/\(id)"
        case .health:           "/management/health"
        // ...
        }
    }

    var method: HTTPMethod {
        switch self {
        case .signUp, .login, .logout, .updateProfile,
             .createFriendChatSession, .sendFriendMessage,
             .createAIProvider, .createAISession, .aiCompletions,
             .createPost, .likePost, .followUser, .uploadFile:
            .post
        default:
            .get
        }
    }
}
```

在 Repository 中使用 StationEndpoint：

```swift
// Repository 层示例
func getProfile() async throws -> ProfileResponse {
    let endpoint = StationEndpoint.getProfile
    return try await apiClient.request(
        endpoint: endpoint.path,
        method: endpoint.method
    )
}

func getFriendMessages(sessionId: String) async throws -> [Message] {
    let endpoint = StationEndpoint.getFriendMessages(sessionId: sessionId)
    return try await apiClient.request(
        endpoint: endpoint.path,
        method: endpoint.method
    )
}
```

### Container.swift DI

iOS 端使用手动单例容器进行依赖注入（非 Swinject 等框架）。

**源文件**: `apps/mobile/ios/PeersTouch/DI/Container.swift`

```swift
final class Container: @unchecked Sendable {
    static let shared = Container()

    let apiClient: APIClient
    let preferenceStore: PreferenceStore
    // ...

    private init() {
        let preferenceStore = PreferenceStore()
        let apiClient = APIClient(
            baseURL: preferenceStore.stationBaseURL,
            authInterceptor: AuthInterceptor(preferenceStore: preferenceStore)
        )
        self.apiClient = apiClient
        self.preferenceStore = preferenceStore
        // ...
    }
}
```

构建链：`PreferenceStore` -> `AuthInterceptor` -> `APIClient`。

### iOS 错误处理链路

```
URLSession
    │
    │ 抛出 URLError / APIError
    ▼
APIClient
    │
    │ 映射为 APIError 枚举
    ▼
Repository
    │
    │ 捕获或传播
    ▼
ViewModel (@Observable)
    │
    │ 更新 Published 属性
    ▼
SwiftUI View
```

`APIError` 枚举定义：

```swift
enum APIError: Error, Sendable {
    case invalidURL
    case invalidResponse
    case httpError(statusCode: Int, data: Data)
    case decodingError(Error)
    case networkError(Error)
    case unauthorized
}
```

---

## 双端共享模式

### Station Base URL 管理

两端均从 PreferenceStore 读取 Station 服务器地址：

| 平台    | 存储方式                    | Key               | 默认值                        |
|---------|---------------------------|--------------------|-------------------------------|
| Android | Jetpack DataStore         | `station_url`      | 无（需用户配置）                |
| iOS     | UserDefaults              | `pt_station_base_url` | `http://localhost:3000`    |

Android PreferenceStore 核心方法：

```kotlin
class PreferenceStore(private val dataStore: DataStore<Preferences>) {
    companion object {
        private val KEY_STATION_URL = stringPreferencesKey("station_url")
        private val KEY_ACCESS_TOKEN = stringPreferencesKey("access_token")
    }

    fun getStationUrl(): Flow<String?> = dataStore.data.map { it[KEY_STATION_URL] }
    fun getAccessToken(): Flow<String?> = dataStore.data.map { it[KEY_ACCESS_TOKEN] }

    suspend fun setStationUrl(url: String) {
        dataStore.edit { it[KEY_STATION_URL] = url }
    }

    suspend fun clearAuth() {
        dataStore.edit {
            it.remove(KEY_ACCESS_TOKEN)
            it.remove(KEY_REFRESH_TOKEN)
            it.remove(KEY_USER_ID)
        }
    }
}
```

iOS PreferenceStore 核心属性：

```swift
final class PreferenceStore: @unchecked Sendable {
    private let defaults: UserDefaults

    var accessToken: String? {
        get { defaults.string(forKey: Keys.accessToken) }
        set { defaults.set(newValue, forKey: Keys.accessToken) }
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

    func clear() {
        Keys.allKeys.forEach { defaults.removeObject(forKey: $0) }
    }
}
```

### Bearer Token 认证

两端认证流程一致：

```
1. 用户登录 -> Station 返回 access_token + refresh_token
2. Token 写入 PreferenceStore
3. 后续每次请求 -> AuthInterceptor 读取 Token -> 添加 "Bearer $token" 头
4. 收到 401 -> 提示重新登录 / 刷新 Token
```

Token 生命周期管理方法：

| 操作       | Android                              | iOS                              |
|-----------|--------------------------------------|----------------------------------|
| 写入 Token | `preferenceStore.setAccessToken(token)` | `preferenceStore.accessToken = token` |
| 读取 Token | `preferenceStore.getAccessToken().firstOrNull()` | `preferenceStore.accessToken` |
| 清除认证   | `preferenceStore.clearAuth()`       | `preferenceStore.clear()`        |

### 超时与重试策略

| 配置项                    | Android (OkHttp)     | iOS (URLSession)              |
|--------------------------|----------------------|-------------------------------|
| 连接超时                  | 30 秒               | timeoutIntervalForRequest: 30 |
| 读取超时                  | 30 秒               | timeoutIntervalForResource: 60|
| 写入超时                  | 30 秒               | (同 request timeout)           |
| 日志级别                  | Level.BODY           | 无内置（可 URLProtocol 扩展）  |

当前两端均未实现自动重试逻辑。如需添加：
- Android: 通过自定义 `Interceptor` 或 OkHttp 的 `Authenticator` 实现
- iOS: 在 `APIClient.request` 内部包装重试循环

### 错误处理链

两端遵循相同的错误传播链：

```
Network Layer (HTTP 异常)
      │
      ▼
Repository Layer (捕获、转换、上报)
      │
      ▼
ViewModel Layer (状态管理、UI 反馈)
      │
      ▼
View Layer (展示错误、提供重试)
```

Repository 是错误边界的核心位置，负责：
1. 将底层网络异常转换为业务语义明确的错误
2. 决定是否需要重试
3. 处理 Token 过期等全局性错误
