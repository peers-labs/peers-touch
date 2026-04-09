# Mobile 存储层开发指南

> 本文档基于 Android `PreferenceStore.kt`、`AppDatabase.kt`、`DatabaseModule.kt`、`AppModule.kt` 以及 iOS `PreferenceStore.swift`、`AppDatabase.swift`、`Container.swift` 的实际代码编写。

---

## 1. 存储架构总览

```
┌─────────────────────────────────────────────────────────┐
│                    Mobile 存储层                         │
│                                                         │
│  ┌─────────────────┐       ┌──────────────────────────┐ │
│  │ PreferenceStore  │       │ AppDatabase              │ │
│  │ (轻量 KV)       │       │ (结构化数据)              │ │
│  │                  │       │                          │ │
│  │ - access_token   │       │ Android: Room            │ │
│  │ - refresh_token  │       │ iOS:     SwiftData       │ │
│  │ - station_url    │       │                          │ │
│  │ - user_id        │       │ Entity -> Dao -> DB      │ │
│  │ - dark_mode      │       │ @Model -> ModelContainer │ │
│  └─────────────────┘       └──────────────────────────┘ │
│                                                         │
│  数据流向：Station (权威数据源) --> 本地 (缓存层)         │
└─────────────────────────────────────────────────────────┘
```

移动端存储分为两层：

1. **PreferenceStore**：轻量级 KV 存储，用于用户偏好和认证信息
2. **AppDatabase**：结构化数据库，用于业务数据的本地缓存

核心原则：**Station 是数据权威来源，本地存储仅为缓存层**。

---

## 2. Android 存储实现

### 2.1 PreferenceStore (DataStore)

基于 Jetpack DataStore 的响应式 KV 存储：

```kotlin
// core/storage/PreferenceStore.kt
class PreferenceStore(
    private val dataStore: DataStore<Preferences>
) {
    companion object {
        private val KEY_ACCESS_TOKEN = stringPreferencesKey("access_token")
        private val KEY_REFRESH_TOKEN = stringPreferencesKey("refresh_token")
        private val KEY_STATION_URL = stringPreferencesKey("station_url")
        private val KEY_USER_ID = stringPreferencesKey("user_id")
        private val KEY_DARK_MODE = booleanPreferencesKey("dark_mode")
    }

    // 读取：返回 Flow，数据变化时自动通知订阅者
    fun getAccessToken(): Flow<String?> = dataStore.data.map { it[KEY_ACCESS_TOKEN] }
    fun getRefreshToken(): Flow<String?> = dataStore.data.map { it[KEY_REFRESH_TOKEN] }
    fun getStationUrl(): Flow<String?> = dataStore.data.map { it[KEY_STATION_URL] }
    fun getUserId(): Flow<String?> = dataStore.data.map { it[KEY_USER_ID] }
    fun getDarkMode(): Flow<Boolean> = dataStore.data.map { it[KEY_DARK_MODE] ?: false }

    // 写入：挂起函数，事务性操作
    suspend fun setAccessToken(token: String) {
        dataStore.edit { it[KEY_ACCESS_TOKEN] = token }
    }

    suspend fun setRefreshToken(token: String) {
        dataStore.edit { it[KEY_REFRESH_TOKEN] = token }
    }

    suspend fun setStationUrl(url: String) {
        dataStore.edit { it[KEY_STATION_URL] = url }
    }

    suspend fun setUserId(userId: String) {
        dataStore.edit { it[KEY_USER_ID] = userId }
    }

    suspend fun setDarkMode(enabled: Boolean) {
        dataStore.edit { it[KEY_DARK_MODE] = enabled }
    }

    // 登出：清除所有认证相关数据
    suspend fun clearAuth() {
        dataStore.edit {
            it.remove(KEY_ACCESS_TOKEN)
            it.remove(KEY_REFRESH_TOKEN)
            it.remove(KEY_USER_ID)
        }
    }
}
```

存储的 5 个键：

| 键 | 类型 | 说明 | 安全等级 |
|---|---|---|---|
| `access_token` | String? | JWT 访问令牌 | 高 (应迁移至安全存储) |
| `refresh_token` | String? | 刷新令牌 | 高 (应迁移至安全存储) |
| `station_url` | String? | Station 服务器地址 | 低 |
| `user_id` | String? | 当前用户 ID | 中 |
| `dark_mode` | Boolean | 深色模式开关 | 低 |

DataStore 文件初始化：

```kotlin
// di/AppModule.kt
private val Context.dataStore: DataStore<Preferences> by preferencesDataStore(
    name = "peers_touch_prefs"
)

@Module
@InstallIn(SingletonComponent::class)
object AppModule {
    @Provides
    @Singleton
    fun provideDataStore(@ApplicationContext context: Context): DataStore<Preferences> {
        return context.dataStore
    }

    @Provides
    @Singleton
    fun providePreferenceStore(dataStore: DataStore<Preferences>): PreferenceStore {
        return PreferenceStore(dataStore)
    }
}
```

使用示例：

```kotlin
@Inject lateinit var preferenceStore: PreferenceStore

// 读取 (响应式)
fun observeStationUrl() {
    viewModelScope.launch {
        preferenceStore.getStationUrl().collect { url ->
            _uiState.update { it.copy(stationUrl = url) }
        }
    }
}

// 写入
fun updateStationUrl(url: String) {
    viewModelScope.launch {
        preferenceStore.setStationUrl(url)
    }
}

// 登出
fun logout() {
    viewModelScope.launch {
        preferenceStore.clearAuth()
    }
}
```

### 2.2 AppDatabase (Room)

基于 Room 的结构化数据库：

```kotlin
// core/storage/AppDatabase.kt
@Database(entities = [], version = 1, exportSchema = false)
abstract class AppDatabase : RoomDatabase()
```

当前 `entities = []` 为空，后续添加业务实体时需要：

```kotlin
// 1. 定义 Entity
@Entity(tableName = "messages")
data class MessageEntity(
    @PrimaryKey val id: String,
    @ColumnInfo(name = "conv_id") val convId: String,
    @ColumnInfo(name = "content") val content: String,
    @ColumnInfo(name = "sender_id") val senderId: String,
    @ColumnInfo(name = "created_at") val createdAt: Long
)

// 2. 定义 Dao
@Dao
interface MessageDao {
    @Query("SELECT * FROM messages WHERE conv_id = :convId ORDER BY created_at DESC")
    fun getMessagesByConversation(convId: String): Flow<List<MessageEntity>>

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun insertMessages(messages: List<MessageEntity>)

    @Query("DELETE FROM messages WHERE conv_id = :convId")
    suspend fun deleteByConversation(convId: String)
}

// 3. 注册到 AppDatabase
@Database(
    entities = [MessageEntity::class],
    version = 2,
    exportSchema = false
)
abstract class AppDatabase : RoomDatabase() {
    abstract fun messageDao(): MessageDao
}
```

Hilt 依赖注入：

```kotlin
// di/DatabaseModule.kt
@Module
@InstallIn(SingletonComponent::class)
object DatabaseModule {

    @Provides
    @Singleton
    fun provideAppDatabase(@ApplicationContext context: Context): AppDatabase {
        return Room.databaseBuilder(
            context,
            AppDatabase::class.java,
            "peers_touch_db"  // 数据库文件名
        ).build()
    }
}
```

---

## 3. iOS 存储实现

### 3.1 PreferenceStore (UserDefaults)

基于 UserDefaults 的同步 KV 存储：

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

    // 清除所有数据 (登出)
    func clear() {
        Keys.allKeys.forEach { defaults.removeObject(forKey: $0) }
    }
}

private extension PreferenceStore {
    enum Keys {
        static let accessToken = "pt_access_token"
        static let refreshToken = "pt_refresh_token"
        static let stationBaseURL = "pt_station_base_url"
        static let isOnboarded = "pt_is_onboarded"
        static let userId = "pt_user_id"

        static let allKeys = [
            accessToken, refreshToken, stationBaseURL, isOnboarded, userId
        ]
    }
}
```

存储的键：

| 键 | 类型 | 说明 | 安全等级 |
|---|---|---|---|
| `pt_access_token` | String? | JWT 访问令牌 | 高 (应迁移至 Keychain) |
| `pt_refresh_token` | String? | 刷新令牌 | 高 (应迁移至 Keychain) |
| `pt_station_base_url` | String (URL) | Station 地址，默认 `http://localhost:3000` | 低 |
| `pt_is_onboarded` | Bool | 是否已完成引导 | 低 |
| `pt_user_id` | String? | 当前用户 ID | 中 |

使用示例：

```swift
let store = Container.shared.preferenceStore

// 读取
let token = store.accessToken
let baseURL = store.stationBaseURL

// 写入
store.accessToken = "new_jwt_token"
store.stationBaseURL = URL(string: "https://my-station.local")!

// 登出
store.clear()
```

### 3.2 AppDatabase (SwiftData)

基于 SwiftData 的结构化数据库：

```swift
// Core/Storage/AppDatabase.swift
final class AppDatabase: Sendable {
    let modelContainer: ModelContainer

    init() {
        let schema = Schema([])  // 当前为空 schema
        let configuration = ModelConfiguration(
            schema: schema,
            isStoredInMemoryOnly: false  // 持久化到磁盘
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

后续添加业务模型时：

```swift
// 1. 定义 @Model
@Model
final class MessageModel {
    @Attribute(.unique) var id: String
    var convId: String
    var content: String
    var senderId: String
    var createdAt: Date

    init(id: String, convId: String, content: String, senderId: String, createdAt: Date) {
        self.id = id
        self.convId = convId
        self.content = content
        self.senderId = senderId
        self.createdAt = createdAt
    }
}

// 2. 注册到 Schema
let schema = Schema([MessageModel.self])

// 3. 查询
@MainActor
func fetchMessages(convId: String) throws -> [MessageModel] {
    let descriptor = FetchDescriptor<MessageModel>(
        predicate: #Predicate { $0.convId == convId },
        sortBy: [SortDescriptor(\.createdAt, order: .reverse)]
    )
    return try modelContext.fetch(descriptor)
}

// 4. 插入
@MainActor
func insertMessage(_ message: MessageModel) {
    modelContext.insert(message)
    try? modelContext.save()
}
```

DI 注册：

```swift
// DI/Container.swift
final class Container: @unchecked Sendable {
    static let shared = Container()

    let appDatabase: AppDatabase
    let preferenceStore: PreferenceStore

    private init() {
        let preferenceStore = PreferenceStore()
        let appDatabase = AppDatabase()
        // ...
        self.preferenceStore = preferenceStore
        self.appDatabase = appDatabase
    }
}
```

---

## 4. 平台差异对比

| 维度 | Android | iOS |
|---|---|---|
| KV 存储 | DataStore<Preferences> (异步, Flow) | UserDefaults (同步, 属性访问) |
| KV 文件名 | `peers_touch_prefs` | 系统默认 plist |
| KV 键前缀 | 无前缀 (`access_token`) | `pt_` 前缀 (`pt_access_token`) |
| 读取模式 | `Flow<T>` 响应式 | 直接属性 getter |
| 写入模式 | `suspend fun` 挂起函数 | 属性 setter (同步) |
| 结构化数据库 | Room (SQLite) | SwiftData (Core Data) |
| 数据库名 | `peers_touch_db` | SwiftData 默认路径 |
| Entity 定义 | `@Entity` + `@Dao` | `@Model` |
| DI | Hilt (Module + Provides) | Container 单例 |
| 清除认证 | `clearAuth()` 仅清 token + userId | `clear()` 清除所有键 |
| 额外键 | `dark_mode` (Boolean) | `isOnboarded` (Bool) |

---

## 5. 安全存储

### 5.1 问题：Token 不应存储在明文 KV 中

当前两端的 `access_token` 和 `refresh_token` 分别存储在 DataStore 和 UserDefaults 中。这些存储方式**不具备加密能力**，在 root/越狱设备上可被直接读取。

**Token 必须存储在安全存储中：**

### 5.2 Android: EncryptedSharedPreferences

```kotlin
// 安全 Token 存储示例
class SecureTokenStore(context: Context) {
    private val masterKey = MasterKey.Builder(context)
        .setKeyScheme(MasterKey.KeyScheme.AES256_GCM)
        .build()

    private val encryptedPrefs = EncryptedSharedPreferences.create(
        context,
        "secure_tokens",
        masterKey,
        EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
        EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM
    )

    var accessToken: String?
        get() = encryptedPrefs.getString("access_token", null)
        set(value) = encryptedPrefs.edit().putString("access_token", value).apply()

    var refreshToken: String?
        get() = encryptedPrefs.getString("refresh_token", null)
        set(value) = encryptedPrefs.edit().putString("refresh_token", value).apply()

    fun clearTokens() {
        encryptedPrefs.edit().clear().apply()
    }
}
```

### 5.3 iOS: Keychain

```swift
// 安全 Token 存储示例
final class KeychainStore {
    private let service = "com.peerstouch.mobile"

    func save(key: String, value: String) throws {
        guard let data = value.data(using: .utf8) else { return }

        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: key,
            kSecValueData as String: data,
            kSecAttrAccessible as String: kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
        ]

        SecItemDelete(query as CFDictionary)
        let status = SecItemAdd(query as CFDictionary, nil)
        guard status == errSecSuccess else {
            throw KeychainError.saveFailed(status)
        }
    }

    func load(key: String) -> String? {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: key,
            kSecReturnData as String: true,
            kSecMatchLimit as String: kSecMatchLimitOne
        ]

        var result: AnyObject?
        let status = SecItemCopyMatching(query as CFDictionary, &result)
        guard status == errSecSuccess, let data = result as? Data else {
            return nil
        }
        return String(data: data, encoding: .utf8)
    }

    func delete(key: String) {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: key
        ]
        SecItemDelete(query as CFDictionary)
    }
}
```

---

## 6. 离线缓存策略

### 6.1 核心原则

```
Station (权威数据源)
    │
    │  网络请求
    v
本地 AppDatabase (缓存层)
    │
    │  查询
    v
UI 层
```

- **Station 是唯一的数据权威来源**，本地数据库仅作为缓存
- 网络可用时，优先从 Station 拉取最新数据并更新本地缓存
- 网络不可用时，从本地缓存读取（允许过期数据）
- 写操作必须先提交到 Station，成功后再更新本地

### 6.2 Android 缓存模式

```kotlin
class MessageRepository @Inject constructor(
    private val stationApi: StationApi,
    private val messageDao: MessageDao
) {
    fun getMessages(convId: String): Flow<List<MessageEntity>> {
        return messageDao.getMessagesByConversation(convId)
    }

    suspend fun refreshMessages(convId: String) {
        val response = stationApi.getMessages(convId)
        val entities = response.map { it.toEntity() }
        messageDao.insertMessages(entities)
    }

    suspend fun sendMessage(convId: String, content: String): Result<MessageEntity> {
        return runCatching {
            val response = stationApi.sendMessage(convId, content)
            val entity = response.toEntity()
            messageDao.insertMessages(listOf(entity))
            entity
        }
    }
}
```

### 6.3 iOS 缓存模式

```swift
final class MessageRepository {
    private let apiClient: APIClient
    private let database: AppDatabase

    init(apiClient: APIClient, database: AppDatabase) {
        self.apiClient = apiClient
        self.database = database
    }

    @MainActor
    func getMessages(convId: String) throws -> [MessageModel] {
        let descriptor = FetchDescriptor<MessageModel>(
            predicate: #Predicate { $0.convId == convId },
            sortBy: [SortDescriptor(\.createdAt, order: .reverse)]
        )
        return try database.modelContext.fetch(descriptor)
    }

    func refreshMessages(convId: String) async throws {
        let messages = try await apiClient.getMessages(convId: convId)
        await MainActor.run {
            for msg in messages {
                database.modelContext.insert(msg.toModel())
            }
            try? database.modelContext.save()
        }
    }
}
```

---

## 7. 登出清除流程

登出时必须清除所有认证相关数据，防止信息泄露。

### Android

```kotlin
suspend fun logout() {
    // 1. 清除认证 Token 和 User ID
    preferenceStore.clearAuth()

    // 2. (如有) 清除安全存储中的 Token
    // secureTokenStore.clearTokens()

    // 3. 断开事件流
    eventStreamClient.disconnect()

    // 4. (可选) 清除本地数据库缓存
    // appDatabase.clearAllTables()
}
```

`clearAuth()` 精确清除 3 个键：

```kotlin
suspend fun clearAuth() {
    dataStore.edit {
        it.remove(KEY_ACCESS_TOKEN)   // 访问令牌
        it.remove(KEY_REFRESH_TOKEN)  // 刷新令牌
        it.remove(KEY_USER_ID)        // 用户 ID
    }
    // 注意：station_url 和 dark_mode 保留不清除
}
```

### iOS

```swift
func logout() {
    // 1. 清除所有存储数据
    preferenceStore.clear()

    // 2. (如有) 清除 Keychain
    // keychainStore.delete(key: "access_token")
    // keychainStore.delete(key: "refresh_token")

    // 3. 断开事件流
    eventStreamClient.disconnect()
}
```

`clear()` 清除所有 5 个键：

```swift
func clear() {
    Keys.allKeys.forEach { defaults.removeObject(forKey: $0) }
    // 清除: access_token, refresh_token, station_base_url, is_onboarded, user_id
}
```

两端清除范围差异：

| 清除项 | Android `clearAuth()` | iOS `clear()` |
|---|---|---|
| access_token | 清除 | 清除 |
| refresh_token | 清除 | 清除 |
| user_id | 清除 | 清除 |
| station_url | **保留** | 清除 |
| dark_mode / isOnboarded | **保留** | 清除 |

---

## 8. 依赖注入全景图

### Android (Hilt)

```
SingletonComponent
├── AppModule
│   ├── DataStore<Preferences>  <-- Context.dataStore
│   ├── PreferenceStore         <-- DataStore
│   └── EventStreamClient      <-- OkHttpClient
├── DatabaseModule
│   └── AppDatabase             <-- Room.databaseBuilder
└── NetworkModule
    ├── AuthInterceptor         <-- PreferenceStore
    ├── OkHttpClient            <-- AuthInterceptor
    ├── Retrofit                <-- OkHttpClient
    └── StationApi              <-- Retrofit
```

### iOS (Container)

```
Container.shared
├── preferenceStore     = PreferenceStore()
├── apiClient           = APIClient(baseURL, authInterceptor)
├── appDatabase         = AppDatabase()
├── eventStreamClient   = EventStreamClient()
├── lynxEngineManager   = LynxEngineManager.shared
├── lynxViewFactory     = LynxViewFactory(engineManager)
├── bridgeDispatcher    = BridgeDispatcher(modules: [...])
├── appletManager       = AppletManager(bundleStorage, bridgeDispatcher)
└── appletBundleStorage = AppletBundleStorage()
```
