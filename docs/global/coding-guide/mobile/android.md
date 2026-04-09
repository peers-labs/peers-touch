# Android 开发指南

本文档基于 `apps/mobile/android` 目录下的真实代码编写,是 PeersTouch Android 端的技术参考手册。

---

## 技术栈

| 分类 | 技术选型 |
|------|---------|
| 语言 | Kotlin |
| UI 框架 | Jetpack Compose + Material 3 |
| DI 框架 | Hilt (Dagger) |
| 网络层 | OkHttp + Retrofit + Gson |
| 本地存储 | Room (数据库) + DataStore (偏好) |
| Applet 渲染 | Lynx Engine |
| 架构模式 | MVVM + Repository |

---

## 架构分层

```
Presentation (UI)          @Composable Screens + @HiltViewModel ViewModels
        |
Business Logic             Repository 接口
        |
Data                       Room Entities/DAOs + Retrofit Services
        |
Infrastructure             DI Modules, Network, Storage, Lynx Engine
```

四层之间单向依赖:上层依赖下层,下层不感知上层。

---

## 应用入口

### PeersTouchApp

```kotlin
// PeersTouchApp.kt
@HiltAndroidApp
class PeersTouchApp : Application() {

    @Inject
    lateinit var lynxEngineManager: LynxEngineManager

    override fun onCreate() {
        super.onCreate()
        lynxEngineManager.initialize(this)
    }

    override fun onTerminate() {
        lynxEngineManager.shutdown()
        super.onTerminate()
    }
}
```

`@HiltAndroidApp` 标记为 Hilt 依赖注入的根节点。应用启动时通过 Hilt 注入 `LynxEngineManager` 并初始化 Lynx 运行时。

### MainActivity

```kotlin
// MainActivity.kt
@AndroidEntryPoint
class MainActivity : ComponentActivity() {

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        setContent {
            PeersTouchTheme {
                AppNavGraph()
            }
        }
    }
}
```

`@AndroidEntryPoint` 使 Activity 具备 Hilt 注入能力。`setContent` 以 Compose 方式设置 UI 树:主题包裹导航图。

---

## 依赖注入 (Hilt)

项目划分为 4 个 DI 模块,全部挂载在 `SingletonComponent` 上:

### AppModule

```kotlin
// di/AppModule.kt
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

    @Provides
    @Singleton
    fun provideEventStreamClient(okHttpClient: OkHttpClient): EventStreamClient {
        return EventStreamClient(okHttpClient)
    }
}
```

提供应用级基础服务:DataStore、PreferenceStore、EventStreamClient。

### NetworkModule

```kotlin
// di/NetworkModule.kt
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

依赖链:`PreferenceStore -> AuthInterceptor -> OkHttpClient -> Retrofit -> StationApi`。

### DatabaseModule

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
            "peers_touch_db"
        ).build()
    }
}
```

### AppletModule

```kotlin
// di/AppletModule.kt
@Module
@InstallIn(SingletonComponent::class)
object AppletModule {

    @Provides
    @Singleton
    fun provideLynxEngineManager(): LynxEngineManager {
        return LynxEngineManager()
    }

    @Provides
    @Singleton
    fun provideLynxViewFactory(lynxEngineManager: LynxEngineManager): LynxViewFactory {
        return LynxViewFactory(lynxEngineManager)
    }

    // 6 个 Bridge 模块通过 @IntoSet 注入到 Set<BridgeModule>
    @Provides @IntoSet
    fun provideSystemBridgeModule(@ApplicationContext context: Context): BridgeModule {
        return SystemBridgeModule(context)
    }

    @Provides @IntoSet
    fun provideStorageBridgeModule(@ApplicationContext context: Context): BridgeModule {
        return StorageBridgeModule(context)
    }

    @Provides @IntoSet
    fun provideNetworkBridgeModule(okHttpClient: OkHttpClient): BridgeModule {
        return NetworkBridgeModule(okHttpClient)
    }

    @Provides @IntoSet
    fun provideNotificationBridgeModule(@ApplicationContext context: Context): BridgeModule {
        return NotificationBridgeModule(context)
    }

    @Provides @IntoSet
    fun provideDeviceBridgeModule(@ApplicationContext context: Context): BridgeModule {
        return DeviceBridgeModule(context)
    }

    @Provides @IntoSet
    fun provideUIBridgeModule(@ApplicationContext context: Context): BridgeModule {
        return UIBridgeModule(context)
    }

    @Provides
    @Singleton
    fun provideBridgeDispatcher(modules: Set<@JvmSuppressWildcards BridgeModule>): BridgeDispatcher {
        return BridgeDispatcher(modules)
    }

    @Provides
    @Singleton
    fun provideAppletManager(
        appletBundleStorage: AppletBundleStorage,
        bridgeDispatcher: BridgeDispatcher
    ): AppletManager {
        return AppletManager(appletBundleStorage, bridgeDispatcher)
    }
}
```

通过 Dagger Multibindings (`@IntoSet`) 收集 6 个 Bridge 模块,统一注入到 `BridgeDispatcher`。

---

## 导航系统

### Routes (路由定义)

```kotlin
// navigation/Routes.kt
sealed class Routes(val route: String) {
    data object Chat : Routes("chat")
    data object AI : Routes("ai")
    data object Applets : Routes("applets")
    data object Search : Routes("search")
    data object Profile : Routes("profile")
    data object Settings : Routes("settings")
    data object Auth : Routes("auth")
    data object Memory : Routes("memory")
    data object Timeline : Routes("timeline")
    data object Channels : Routes("channels")
    data object Skills : Routes("skills")
    data object AppletDetail : Routes("applet_detail/{appletId}") {
        fun createRoute(appletId: String): String = "applet_detail/$appletId"
    }
}
```

共 12 条路由。`AppletDetail` 通过路径参数传递 `appletId`。

### AppNavGraph (导航图)

```kotlin
// navigation/AppNavGraph.kt
@Composable
fun AppNavGraph() {
    val navController = rememberNavController()
    val navBackStackEntry by navController.currentBackStackEntryAsState()
    val currentRoute = navBackStackEntry?.destination?.route

    val bottomBarRoutes = listOf(
        Routes.Chat.route,
        Routes.AI.route,
        Routes.Applets.route,
        Routes.Search.route,
        Routes.Profile.route
    )

    Scaffold(
        bottomBar = {
            if (currentRoute in bottomBarRoutes) {
                BottomNavBar(
                    currentRoute = currentRoute,
                    onNavigate = { route ->
                        navController.navigate(route) {
                            popUpTo(Routes.Chat.route) { saveState = true }
                            launchSingleTop = true
                            restoreState = true
                        }
                    }
                )
            }
        }
    ) { innerPadding ->
        NavHost(
            navController = navController,
            startDestination = Routes.Chat.route,
            modifier = Modifier.padding(innerPadding)
        ) {
            composable(Routes.Chat.route) { ChatScreen(navController) }
            composable(Routes.AI.route) { AIScreen(navController) }
            // ... 其余路由
            composable(
                route = Routes.AppletDetail.route,
                arguments = listOf(navArgument("appletId") { type = NavType.StringType })
            ) { backStackEntry ->
                val appletId = backStackEntry.arguments?.getString("appletId") ?: return@composable
                AppletContainerView(appletId = appletId)
            }
        }
    }
}
```

底部导航栏仅在 5 个主路由(Chat、AI、Applets、Search、Profile)时显示。默认起始页为 Chat。

### BottomNavBar

```kotlin
// navigation/BottomNavBar.kt
data class BottomNavItem(
    val label: String,
    val route: String,
    val icon: ImageVector
)

@Composable
fun BottomNavBar(
    currentRoute: String?,
    onNavigate: (String) -> Unit
) {
    val items = listOf(
        BottomNavItem("Chat", Routes.Chat.route, Icons.Filled.Chat),
        BottomNavItem("AI", Routes.AI.route, Icons.Filled.SmartToy),
        BottomNavItem("Applets", Routes.Applets.route, Icons.Filled.Apps),
        BottomNavItem("Search", Routes.Search.route, Icons.Filled.Search),
        BottomNavItem("Me", Routes.Profile.route, Icons.Filled.Person)
    )

    NavigationBar {
        items.forEach { item ->
            NavigationBarItem(
                selected = currentRoute == item.route,
                onClick = { onNavigate(item.route) },
                icon = { Icon(imageVector = item.icon, contentDescription = item.label) },
                label = { Text(text = item.label) }
            )
        }
    }
}
```

---

## 主题系统

### 色彩体系

```kotlin
// core/theme/Color.kt

// 亮色方案
val PeersPrimary = Color(0xFF6B46C1)           // 品牌紫
val PeersSecondary = Color(0xFF3B82F6)          // 品牌蓝
val PeersTertiary = Color(0xFF22C55E)           // 品牌绿
val PeersBackground = Color(0xFFF9FAFB)
val PeersSurface = Color(0xFFFFFFFF)
val PeersError = Color(0xFFEF4444)

// 暗色方案
val PeersPrimaryDark = Color(0xFFA78BFA)
val PeersSecondaryDark = Color(0xFF60A5FA)
val PeersTertiaryDark = Color(0xFF4ADE80)
val PeersBackgroundDark = Color(0xFF111111)
val PeersSurfaceDark = Color(0xFF1A1A1A)
val PeersErrorDark = Color(0xFFF87171)
```

完整定义了 Light / Dark 两套色板,涵盖 primary、secondary、tertiary、background、surface、error 及其 on* 变体。

### 主题入口

```kotlin
// core/theme/Theme.kt
@Composable
fun PeersTouchTheme(
    darkTheme: Boolean = isSystemInDarkTheme(),
    dynamicColor: Boolean = false,
    content: @Composable () -> Unit
) {
    val colorScheme = when {
        dynamicColor && Build.VERSION.SDK_INT >= Build.VERSION_CODES.S -> {
            val context = LocalContext.current
            if (darkTheme) dynamicDarkColorScheme(context) else dynamicLightColorScheme(context)
        }
        darkTheme -> DarkColorScheme
        else -> LightColorScheme
    }

    MaterialTheme(
        colorScheme = colorScheme,
        typography = PeersTouchTypography,
        content = content
    )
}
```

支持三种模式:自定义亮色、自定义暗色、Android 12+ 动态色彩(默认关闭)。同时设置了 StatusBar 颜色跟随主题。

### 字体排版

```kotlin
// core/theme/Type.kt
val PeersTouchTypography = Typography(
    displayLarge  = TextStyle(fontWeight = FontWeight.Bold,     fontSize = 57.sp),
    displayMedium = TextStyle(fontWeight = FontWeight.Bold,     fontSize = 45.sp),
    displaySmall  = TextStyle(fontWeight = FontWeight.Bold,     fontSize = 36.sp),
    headlineLarge = TextStyle(fontWeight = FontWeight.SemiBold, fontSize = 32.sp),
    headlineMedium= TextStyle(fontWeight = FontWeight.SemiBold, fontSize = 28.sp),
    headlineSmall = TextStyle(fontWeight = FontWeight.SemiBold, fontSize = 24.sp),
    titleLarge    = TextStyle(fontWeight = FontWeight.Medium,   fontSize = 22.sp),
    titleMedium   = TextStyle(fontWeight = FontWeight.Medium,   fontSize = 16.sp),
    titleSmall    = TextStyle(fontWeight = FontWeight.Medium,   fontSize = 14.sp),
    bodyLarge     = TextStyle(fontWeight = FontWeight.Normal,   fontSize = 16.sp),
    bodyMedium    = TextStyle(fontWeight = FontWeight.Normal,   fontSize = 14.sp),
    bodySmall     = TextStyle(fontWeight = FontWeight.Normal,   fontSize = 12.sp),
    labelLarge    = TextStyle(fontWeight = FontWeight.Medium,   fontSize = 14.sp),
    labelMedium   = TextStyle(fontWeight = FontWeight.Medium,   fontSize = 12.sp),
    labelSmall    = TextStyle(fontWeight = FontWeight.Medium,   fontSize = 11.sp),
)
```

覆盖 Material 3 全部 15 个文本样式档位。使用 `FontFamily.Default`。

---

## Feature 模块结构

项目包含 11 个 Feature 模块,统一遵循如下目录结构:

```
features/<name>/
  ui/           @Composable 页面组件
  viewmodel/    @HiltViewModel ViewModel
  repository/   数据访问层
```

以 Chat 为例:

### ChatRepository

```kotlin
// features/chat/repository/ChatRepository.kt
@Singleton
class ChatRepository @Inject constructor(
    private val stationApi: StationApi
)
```

通过 `@Inject constructor` 让 Hilt 自动注入 `StationApi`。

### ChatViewModel

```kotlin
// features/chat/viewmodel/ChatViewModel.kt
@HiltViewModel
class ChatViewModel @Inject constructor(
    private val chatRepository: ChatRepository
) : ViewModel()
```

`@HiltViewModel` 使 ViewModel 可在 Composable 中通过 `hiltViewModel()` 获取。

### ChatScreen

```kotlin
// features/chat/ui/ChatScreen.kt
@Composable
fun ChatScreen(
    navController: NavController,
    viewModel: ChatViewModel = hiltViewModel()
) {
    Box(
        modifier = Modifier.fillMaxSize(),
        contentAlignment = Alignment.Center
    ) {
        Text(text = "Chat")
    }
}
```

ViewModel 通过 `hiltViewModel()` 委托注入,无需手动传递。

### 全部 Feature 列表

| Feature | 路由 | 说明 |
|---------|------|------|
| chat | `chat` | 聊天会话 |
| ai | `ai` | AI 对话 |
| applets | `applets` | 小程序列表 |
| search | `search` | 全局搜索 |
| profile | `profile` | 个人主页 |
| settings | `settings` | 设置 |
| auth | `auth` | 认证/登录 |
| memory | `memory` | 记忆管理 |
| timeline | `timeline` | 时间线 |
| channels | `channels` | 频道 |
| skills | `skills` | 技能 |

---

## 网络层

### ApiClient

```kotlin
// core/network/ApiClient.kt
@Singleton
class ApiClient @Inject constructor(
    private val retrofit: Retrofit
) {
    fun <T> createService(serviceClass: Class<T>): T {
        return retrofit.create(serviceClass)
    }
}
```

泛型工厂方法,按需创建 Retrofit 接口实例。

### AuthInterceptor

```kotlin
// core/network/AuthInterceptor.kt
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

从 `PreferenceStore` 读取 token,自动附加 `Bearer` 请求头。

### StationApi (部分接口)

```kotlin
// core/network/StationApi.kt
interface StationApi {

    @POST("activitypub/login")
    suspend fun login(@Body credentials: Map<String, String>): Response<Map<String, Any>>

    @GET("friend-chat/sessions")
    suspend fun getFriendChatSessions(): Response<List<Map<String, Any>>>

    @POST("ai-chat/chat/completions")
    @Streaming
    suspend fun aiChatCompletions(@Body body: Map<String, Any>): Response<okhttp3.ResponseBody>

    @GET("events/stream")
    @Streaming
    suspend fun getEventStream(): Response<okhttp3.ResponseBody>

    @GET("applets")
    suspend fun getApplets(): Response<List<Map<String, Any>>>

    @GET("launcher/search")
    suspend fun search(@Query("q") query: String): Response<Map<String, Any>>

    // ... 完整定义见 StationApi.kt
}
```

包含认证、好友聊天、群聊、AI 对话、事件流、社交、小程序、OSS、搜索等全部 Station 端点。流式接口使用 `@Streaming` 注解。

---

## 存储层

### PreferenceStore

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

    fun getAccessToken(): Flow<String?> = dataStore.data.map { it[KEY_ACCESS_TOKEN] }

    suspend fun setAccessToken(token: String) {
        dataStore.edit { it[KEY_ACCESS_TOKEN] = token }
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

基于 Jetpack DataStore,读操作返回 `Flow`,写操作为 `suspend` 函数。存储键包括:access_token、refresh_token、station_url、user_id、dark_mode。

### AppDatabase

```kotlin
// core/storage/AppDatabase.kt
@Database(entities = [], version = 1, exportSchema = false)
abstract class AppDatabase : RoomDatabase()
```

Room 数据库,当前为空 schema,按需添加 Entity 和 DAO。

---

## 事件系统

### EventStreamClient

```kotlin
// core/event/EventStreamClient.kt
data class ServerEvent(
    val type: String,
    val data: String,
    val id: String? = null
)

class EventStreamClient(
    private val okHttpClient: OkHttpClient
) {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private val _events = MutableSharedFlow<ServerEvent>(extraBufferCapacity = 64)
    val events: SharedFlow<ServerEvent> = _events.asSharedFlow()

    fun connect(baseUrl: String, token: String) {
        // 通过 OkHttp EventSources API 建立 SSE 连接
        val request = Request.Builder()
            .url("$baseUrl/events/stream")
            .addHeader("Authorization", "Bearer $token")
            .addHeader("Accept", "text/event-stream")
            .build()

        val factory = EventSources.createFactory(okHttpClient)
        eventSource = factory.newEventSource(request, object : EventSourceListener() {
            override fun onEvent(...) {
                scope.launch { _events.emit(ServerEvent(...)) }
            }
            override fun onFailure(...) { scheduleReconnect() }
            override fun onClosed(...) { scheduleReconnect() }
        })
    }

    private fun scheduleReconnect() {
        reconnectJob = scope.launch {
            delay(5000)       // 5 秒后自动重连
            startConnection()
        }
    }
}
```

通过 OkHttp SSE (`EventSources`) 建立服务端推送连接。事件通过 `SharedFlow` 分发,断线后 5 秒自动重连。

### EventRouter

```kotlin
// core/event/EventRouter.kt
@Singleton
class EventRouter @Inject constructor(
    private val eventStreamClient: EventStreamClient
) {
    private val handlers = mutableMapOf<String, MutableList<EventHandler>>()

    fun register(eventType: String, handler: EventHandler) {
        handlers.getOrPut(eventType) { mutableListOf() }.add(handler)
    }

    fun startListening() {
        scope.launch {
            eventStreamClient.events.collect { event ->
                handlers[event.type]?.forEach { handler ->
                    launch { handler(event.data) }
                }
            }
        }
    }
}
```

按事件类型注册处理器,每个处理器在独立协程中执行。

---

## Lynx 集成

### LynxEngineManager

```kotlin
// core/lynx/LynxEngineManager.kt
class LynxEngineManager constructor() {
    var isInitialized: Boolean = false
        private set

    fun initialize(context: Context) {
        if (isInitialized) return
        applicationContext = context.applicationContext
        LynxEnv.inst().init(context.applicationContext, null, null, null)
        isInitialized = true
    }

    fun shutdown() {
        if (!isInitialized) return
        isInitialized = false
        applicationContext = null
    }
}
```

在 `PeersTouchApp.onCreate()` 时初始化 `LynxEnv`,全局单例生命周期。

### LynxViewFactory

```kotlin
// core/lynx/LynxViewFactory.kt
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

### BridgeDispatcher

```kotlin
// core/lynx/bridge/BridgeDispatcher.kt
interface BridgeModule {
    val moduleName: String
    suspend fun handle(method: String, params: Map<String, Any?>): Any?
}

class BridgeDispatcher constructor(
    modules: Set<@JvmSuppressWildcards BridgeModule>
) {
    private val moduleMap: Map<String, BridgeModule> = modules.associateBy { it.moduleName }

    suspend fun invoke(module: String, method: String, params: Map<String, Any?>): BridgeResult {
        val bridgeModule = moduleMap[module]
            ?: return BridgeResult.Error(...)
        return try {
            BridgeResult.Success(bridgeModule.handle(method, params))
        } catch (e: Exception) {
            BridgeResult.Error(...)
        }
    }

    // 支持 "module.method" 格式的便捷调用
    suspend fun invoke(api: String, params: Map<String, Any?>): BridgeResult {
        val components = api.split(".", limit = 2)
        return invoke(components[0], components[1], params)
    }
}
```

6 个 Bridge 模块:

| 模块 | 职责 |
|------|------|
| `SystemBridgeModule` | 系统信息、应用元数据 |
| `StorageBridgeModule` | 本地存储读写 |
| `NetworkBridgeModule` | 网络请求代理 |
| `NotificationBridgeModule` | 推送通知 |
| `DeviceBridgeModule` | 设备信息 |
| `UIBridgeModule` | 原生 UI 交互 |

### AppletContainerView

```kotlin
// core/applet/ui/AppletContainerView.kt
@Composable
fun AppletContainerView(
    appletId: String,
    appletManager: AppletManager = hiltViewModel<AppletContainerViewModel>().appletManager,
    lynxViewFactory: LynxViewFactory = hiltViewModel<AppletContainerViewModel>().lynxViewFactory
) {
    LaunchedEffect(appletId) {
        val session = appletManager.loadApplet(appletId)
        // 状态判断: Loading -> Running / Error
    }

    DisposableEffect(appletId) {
        onDispose { appletManager.unloadApplet(appletId) }
    }

    Box(modifier = Modifier.fillMaxSize()) {
        when (val state = containerState) {
            is AppletContainerState.Loading -> AppletLoadingView()
            is AppletContainerState.Running -> {
                AndroidView(
                    factory = { ctx -> lynxViewFactory.create(ctx, bundleUrl, session) },
                    modifier = Modifier.fillMaxSize()
                )
            }
            is AppletContainerState.Error -> AppletErrorView(
                message = state.message,
                onRetry = { containerState = AppletContainerState.Loading }
            )
        }
    }
}
```

通过 `AndroidView` 将原生 `LynxView` 嵌入 Compose 树。Applet 生命周期由 `LaunchedEffect` + `DisposableEffect` 管理。

---

## 目录结构总览

```
app/src/main/java/com/peerstouch/mobile/
  PeersTouchApp.kt                    # Application 入口
  MainActivity.kt                      # Activity 入口
  di/
    AppModule.kt                       # DataStore, PreferenceStore, EventStreamClient
    AppletModule.kt                    # Lynx, Bridge, AppletManager
    DatabaseModule.kt                  # Room Database
    NetworkModule.kt                   # OkHttp, Retrofit, StationApi
  navigation/
    Routes.kt                          # 路由定义 (12 条)
    AppNavGraph.kt                     # NavHost + Scaffold
    BottomNavBar.kt                    # 底部导航栏 (5 个 Tab)
  core/
    theme/
      Color.kt                         # 色彩 Token (Light + Dark)
      Theme.kt                         # PeersTouchTheme Composable
      Type.kt                          # Typography 定义
    network/
      ApiClient.kt                     # Retrofit 工厂
      AuthInterceptor.kt              # Bearer Token 拦截器
      StationApi.kt                    # Station API 接口
    storage/
      PreferenceStore.kt              # DataStore 偏好存储
      AppDatabase.kt                   # Room 数据库
    event/
      EventStreamClient.kt            # SSE 客户端
      EventRouter.kt                   # 事件分发路由
    lynx/
      LynxEngineManager.kt            # Lynx 引擎管理
      LynxViewFactory.kt              # LynxView 工厂
      bridge/
        BridgeDispatcher.kt           # Bridge 分发器
        SystemBridgeModule.kt
        StorageBridgeModule.kt
        NetworkBridgeModule.kt
        NotificationBridgeModule.kt
        DeviceBridgeModule.kt
        UIBridgeModule.kt
    applet/
      AppletManager.kt                # Applet 生命周期管理
      AppletBundleStorage.kt          # Bundle 本地缓存
      AppletBridgeSession.kt          # Bridge 会话
      AppletManifestParser.kt         # Manifest 解析
      AppletState.kt                   # 状态枚举
      ui/
        AppletContainerView.kt        # Applet 渲染容器
        AppletContainerViewModel.kt
        AppletLoadingView.kt
        AppletErrorView.kt
  features/
    ai/         { ui/, viewmodel/, repository/ }
    applets/    { ui/, viewmodel/, repository/ }
    auth/       { ui/, viewmodel/, repository/ }
    channels/   { ui/, viewmodel/, repository/ }
    chat/       { ui/, viewmodel/, repository/ }
    memory/     { ui/, viewmodel/, repository/ }
    profile/    { ui/, viewmodel/, repository/ }
    search/     { ui/, viewmodel/, repository/ }
    settings/   { ui/, viewmodel/, repository/ }
    skills/     { ui/, viewmodel/, repository/ }
    timeline/   { ui/, viewmodel/, repository/ }
```
