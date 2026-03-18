# 23.2 GlobalContext — 全局上下文架构现状

> **定位**：`GlobalContext` 是 PeersTouch 客户端的**中央状态枢纽**，负责管理会话(Session)、用户画像(Profile)、多账号(Accounts)、偏好设置(Preferences)、协议标识(ProtocolTag)、网络状态和登出事件。是整个客户端架构的底层基座。
>
> **本文档基于代码实际实现编写，反映当前状态，而非理想设计。**

---

## 1. 文件位置与结构

```
client/common/peers_touch_base/lib/context/
├── global_context.dart                      # 抽象接口
├── default_global_context.dart              # 唯一实现
├── app_lifecycle_orchestrator.dart           # 生命周期编排器接口
├── default_app_lifecycle_orchestrator.dart   # 生命周期编排器实现
├── ready_gate.dart                          # 就绪门控接口
└── default_ready_gate.dart                  # 就绪门控实现
```

---

## 2. GlobalContext 接口定义（当前）

```dart
abstract class GlobalContext {
  // ─── 状态读取 ───
  Map<String, dynamic>? get currentSession;     // 当前会话（actorId, handle, accessToken, refreshToken, sessionId, baseUrl, protocol, avatarUrl）
  Map<String, dynamic>? get userProfile;         // 用户画像（id, displayName, handle, summary, avatar, ...）
  List<Map<String, dynamic>> get accounts;       // 历史账号列表
  Map<String, dynamic> get preferences;          // 偏好设置
  String? get protocolTag;                       // 协议标识
  String? get actorId;                           // 快捷访问：当前用户 DID
  String? get actorHandle;                       // 快捷访问：当前用户 handle

  // ─── 事件流 ───
  Stream<Map<String, dynamic>?> get onSessionChange;
  Stream<Map<String, dynamic>?> get onProfileChange;
  Stream<List<Map<String, dynamic>>> get onAccountChange;
  Stream<Map<String, dynamic>> get onPreferencesChange;
  Stream<String?> get onProtocolChange;
  Stream<List<String>> get onNetworkStatusChange;
  Stream<LogoutReason> get onLogoutRequested;

  // ─── 状态写入 ───
  Future<void> setSession(Map<String, dynamic>? session);
  Future<void> setSessionSnapshot(ActorSessionSnapshot snapshot);
  ActorSessionSnapshot? getSessionSnapshot();
  Future<void> switchAccount(String userId, String baseUrl);
  Future<void> updatePreferences(Map<String, dynamic> prefs);
  Future<void> updatePreferencesSnapshot(ActorPreferences prefs);
  ActorPreferences? getPreferencesSnapshot();
  Future<void> setProtocolTag(String? tag);

  // ─── 生命周期 ───
  Future<void> hydrate();              // 从本地存储恢复状态
  Future<void> refreshProfile();       // 从服务器刷新用户画像
  void setProfile(Map<String, dynamic>? profile);
  void clearProfile();

  // ─── 登出 ───
  void requestLogout(LogoutReason reason, {String? message});
  String? get lastLogoutMessage;
  Future<bool> isOnline();
}
```

`LogoutReason` 枚举：`userInitiated` | `tokenExpired` | `userNotFound` | `forcedByServer` | `sessionCleared`

---

## 3. 内部存储层次（DefaultGlobalContext 实现）

`DefaultGlobalContext` 内部维护多层存储：

| 层次 | 载体 | 作用 |
|------|------|------|
| **内存** | `Map<String, dynamic>? _session` | 运行时快速读取，所有 getter 直接返回此值 |
| **SecureStorage** | `token_key`, `refresh_token_key`, `session_id_key` | 敏感凭证持久化 |
| **LocalStorage** | `global:current_session`, `global:current_session_pb`, `global:accounts`, `global:user_preferences`, `global:user_preferences_pb` | 会话/偏好持久化（含 Proto JSON 格式） |

### setSession() 写入流程

```
setSession(map)
  ├─ 1. _session = normalizeSession(map)       // 内存
  ├─ 2. _sessionCtrl.add(_session)             // 广播事件
  ├─ 3. secureStorage.set('token_key', ...)    // SecureStorage
  ├─ 4. secureStorage.set('refresh_token_key', ...)
  ├─ 5. localStorage.set('global:current_session', _session)   // LocalStorage (Map)
  ├─ 6. localStorage.set('global:current_session_pb', snap)    // LocalStorage (Proto JSON)
  ├─ 7. 更新 _accounts 列表
  └─ 8. refreshProfile()  ← fire-and-forget，无 await 无错误处理
```

### setSession(null) 清除流程

```
setSession(null)
  ├─ 1. _session = null
  ├─ 2. _sessionCtrl.add(null)
  ├─ 3. secureStorage.remove('token_key')
  ├─ 4. secureStorage.remove('refresh_token_key')
  ├─ 5. localStorage.remove('global:current_session')
  └─ 6. localStorage.remove('global:current_session_pb')
```

### hydrate() 恢复流程

```
hydrate()
  ├─ 1. 绑定网络状态监听
  ├─ 2. 从 localStorage 读 'global:current_session_pb' → setSessionSnapshot()
  │     └─ setSessionSnapshot() → setSession() → refreshProfile()
  ├─ 3. 从 localStorage 读 'global:current_session' → 覆盖 _session
  ├─ 4. 从 localStorage 读 'global:accounts'
  ├─ 5. 从 localStorage 读 'global:user_preferences'
  └─ 6. 从 localStorage 读 'global:user_preferences_pb' → updatePreferencesSnapshot()
```

**注意**：hydrate() 已增加幂等保护（`_isHydrated` + `Completer`），防止被多次调用。

---

## 4. 注册与初始化时序（当前实际）

```
main() async
  ├─ AppInitializer.init()
  │   ├─ LoggingService.initialize()
  │   ├─ _initializeCurrentUser()
  │   ├─ NetworkInitializer.initialize(baseUrl: 'http://localhost:18080')
  │   └─ _initialRoute = '/splash'
  └─ runApp(App())  ← initialBinding: InitialBinding()

InitialBinding.dependencies()
  ├─ _registerStorageServices()
  │   ├─ Get.put<LocalStorage>()
  │   ├─ Get.put<SecureStorage>()
  │   ├─ Get.put<SecureStorageAdapter>()
  │   └─ Get.put<LocalStorageAdapter>()
  ├─ _registerNetworkServices()
  │   ├─ Get.put<NetworkStatusService>()
  │   ├─ Get.put<ConnectivityAdapter>()
  │   ├─ Get.put<Libp2pNetworkService>()
  │   ├─ Get.put<TokenProvider>(DefaultTokenProvider(...))  ← 此时 GlobalContext 尚未注册！
  │   ├─ NetworkInitializer.setupAuth(                      ← tokenRefresher: 未提供 (null)
  │   │     tokenProvider, onUnauthenticated: () {
  │   │       GlobalContext.requestLogout(tokenExpired)
  │   │     })
  │   └─ Get.put<OssService>()
  └─ _registerBusinessServices()
      ├─ Get.put<UserStatusService>()
      ├─ Get.put<AuthController>()                          ← permanent: true
      ├─ Get.put<GlobalContext>(DefaultGlobalContext(...))   ← permanent: true
      ├─ gctx.hydrate()                                     ← 调用但未 await
      ├─ Get.put<AppLifecycleOrchestrator>(...)
      ├─ Get.put<ActorRepository>(...)
      └─ Get.put<AvatarResolver>(AvatarResolverDesktop())

_AppState.initState() → postFrameCallback
  ├─ _setupLogoutListener()   ← 监听 onLogoutRequested → _performLogout()
  └─ orch.awaitReadyGate()    ← 异步：hydrate → 验证 profile → 决定路由
       └─ 如果 refreshProfile() 网络失败，保持 sessionValid（不清 session）
       └─ 完成后仅在用户仍在 splash 页时才覆盖路由
```

---

## 5. Token 读取链路（三条路径）

`DefaultTokenProvider.readAccessToken()` 的读取优先级：

```
1. _cachedAccessToken（进程内缓存）
2. GlobalContext.currentSession['accessToken']（内存）
3. SecureStorage.get('token_key')（持久化）
```

**消费者**（谁在读 token）：

| 消费者 | 读取方式 | 说明 |
|--------|---------|------|
| `AuthInterceptor` | 通过 `TokenProvider.readAccessToken()` | Dio 拦截器，自动加 `Authorization` header |
| `EventStreamService` | 直接 `GlobalContext.currentSession['accessToken']` | SSE 连接鉴权 |
| `RTCSignalingService` | 直接 `GlobalContext.currentSession['accessToken']` | WebRTC 信令鉴权 |
| `RemoteImageCacheService` | 直接 `GlobalContext.currentSession['accessToken']` | 图片缓存鉴权 |
| `AuthMiddleware` | 直接 `GlobalContext.currentSession['accessToken']` | 路由守卫 |

**问题**：`EventStreamService`、`RTCSignalingService`、`RemoteImageCacheService` 绕过了 `TokenProvider`，直接从 `GlobalContext` 读取 token。这意味着如果将来 token 刷新只更新了 `TokenProvider`，这些服务拿到的仍是旧 token。

---

## 6. 登出流程（当前实际）

### 统一登出路径（正确路径）

```
任意组件调用 GlobalContext.requestLogout(reason, message?)
    ↓
_logoutCtrl.add(reason)  ← 广播事件
    ↓
main.dart _setupLogoutListener() 监听
    ├─ 显示 snackbar
    ├─ TokenProvider.clear()            ← 清缓存 + SecureStorage
    ├─ GlobalContext.setSession(null)    ← 清内存 + SecureStorage + LocalStorage
    ├─ GlobalContext.clearProfile()
    └─ Get.offAllNamed('/login')
```

### 调用 requestLogout() 的入口

| 位置 | 触发条件 | LogoutReason |
|------|---------|-------------|
| `InitialBinding.onUnauthenticated` | 任意 HTTP 401（且无 TokenRefresher） | `tokenExpired` |
| `AuthController.logout()` | 用户手动登出 | `userInitiated` |
| `ProfileController.logout()` | 用户手动登出 | `userInitiated` |
| `SplashController._checkAuthAndNavigate()` | Token 验证失败 / Profile 不存在 | `tokenExpired` / `userNotFound` |
| `FriendChatController._handleSessionKicked()` | 会话被另一设备踢出 | `forcedByServer` |

---

## 7. refreshProfile() 行为

```dart
Future<void> refreshProfile() async {
  // 防重入：如果已在刷新中，等待完成
  if (_isRefreshingProfile) { /* 轮询等待 */ }
  
  // 需要 handle 才能请求
  final handle = actorHandle;
  if (handle == null || handle.isEmpty) throw;
  
  // 调用 /activitypub/$handle/profile
  final response = await HttpServiceLocator().httpService.getResponse('/activitypub/$handle/profile');
  
  if (response.statusCode == 200 && response.data is Map) {
    _userProfile = response.data;
    _profileCtrl.add(_userProfile);  // 广播事件
    // 同步 avatarUrl 到 _session
    // 缓存到 localStorage
  } else {
    throw Exception('Profile not found');
  }
}
```

**调用时机**：
1. `setSession(map)` 末尾自动调用（fire-and-forget，不 await）
2. `awaitReadyGate()` 中主动调用并 await
3. `SplashController._verifyUserProfile()` 中主动调用
4. `ProfileController.refreshProfile()` 由用户触发

---

## 8. GlobalContext 的消费者全景

### 按模块分类

#### 基础设施层（`peers_touch_base`）
| 文件 | 用途 |
|------|------|
| `default_token_provider.dart` | 读/写 token（三级回落：缓存→GlobalContext→SecureStorage） |
| `auth_interceptor.dart` | 间接（通过 TokenProvider）读 token；401 时触发 onUnauthenticated |
| `event_stream_service.dart` | 直接读 `currentSession['accessToken']` 用于 SSE 鉴权 |
| `rtc_signaling.dart` | 直接读 `currentSession['accessToken']` 用于 WebRTC 信令 |
| `remote_image_cache_service.dart` | 直接读 `currentSession['accessToken']` 用于图片缓存鉴权 |
| `default_app_lifecycle_orchestrator.dart` | hydrate + refreshProfile + 决定初始路由 |

#### 应用框架层（`desktop`）
| 文件 | 用途 |
|------|------|
| `initial_binding.dart` | 注册 GlobalContext；设置 onUnauthenticated 回调 |
| `main.dart` | 监听 onLogoutRequested → 执行登出清理 + 导航 |
| `auth_middleware.dart` | 路由守卫：检查 `currentSession['accessToken']` |
| `app_initializer.dart` | 初始化网络服务（不直接用 GlobalContext） |
| `avatar_resolver_desktop.dart` | 从 `userProfile` 读取当前用户头像/名称 |

#### 业务功能层（`features/`）
| 文件 | 用途 |
|------|------|
| `auth_controller.dart` | 登录写 `setSession()`；登出调 `requestLogout()`；设置 `protocolTag` |
| `splash_controller.dart` | 验证 token + profile → 决定导航 |
| `profile_controller.dart` | 同步 profile 到 UI；触发 refreshProfile()；登出 |
| `profile_module.dart` | 读 `preferences` 中的 feature_flags |
| `friend_chat_controller.dart` | 读 `actorId`/`actorHandle`/`avatarUrl`/`sessionId`；会话踢出检测 |
| `group_chat_controller.dart` | 读 `currentSession` |
| `discovery_controller.dart` | 读 `actorId`/`actorHandle` |
| `activity_controller.dart` | 读 `currentSession` |
| `home_controller.dart` | 读 `currentSession` 获取用户名 |
| `shell_page.dart` | 读 `preferences` |
| `discovery_content_item.dart` | 读 `currentSession` 判断是否为当前用户 |

---

## 9. 已知问题与当前状态

### 9.1 TokenRefresher 未实现

`InitialBinding.setupAuth()` 没有提供 `tokenRefresher`。任何 HTTP 401 都直接触发 `onUnauthenticated()` → 登出。无 token 自动刷新能力。

### 9.2 数据类型为 `Map<String, dynamic>`

`currentSession`、`userProfile`、`preferences` 都是非类型化的 `Map<String, dynamic>`。虽然有 Proto snapshot 的读写方法（`setSessionSnapshot`/`getSessionSnapshot`），但内部运行时仍以 Map 为主，容易出现 key 拼写错误（如 `accessToken` vs `access_token`）。

### 9.3 refreshProfile() 的 HTTP 端点

`refreshProfile()` 直接使用 `HttpServiceLocator().httpService` 发起 GET `/activitypub/$handle/profile`。这个请求经过 `AuthInterceptor`，如果 token 过期会触发 401 → 登出。这意味着 profile 刷新失败可能导致连锁登出。

### 9.4 setSession() 末尾的 refreshProfile()

`setSession(map)` 在末尾调用 `refreshProfile()` 但**不 await**。如果 profile 刷新失败，错误被静默吞掉（因为没有人在等这个 Future）。但如果在 `awaitReadyGate()` 中调用，失败会被捕获并影响路由决策。

### 9.5 多处直接读 GlobalContext 而非 TokenProvider

`EventStreamService`、`RTCSignalingService`、`RemoteImageCacheService` 绕过 `TokenProvider` 直接从 `GlobalContext.currentSession` 读 token，破坏了单一 token 读取入口的设计意图。

### 9.6 Session Map 被外部直接修改

`DefaultTokenProvider.writeTokens()` 中直接修改 `GlobalContext.currentSession` 的 Map 引用：

```dart
session['accessToken'] = accessToken;
```

这绕过了 `setSession()` 的正式写入流程，不会触发 `onSessionChange` 事件，不会持久化到 LocalStorage/SecureStorage。

---

## 10. 依赖关系图

```
                    ┌──────────────────────┐
                    │    GlobalContext      │
                    │  (DefaultGlobalCtx)   │
                    ├──────────────────────┤
                    │ _session (Map)        │
                    │ _userProfile (Map)    │
                    │ _accounts (List<Map>) │
                    │ _preferences (Map)    │
                    │ _protocolTag          │
                    └────────┬─────────────┘
                             │
              ┌──────────────┼──────────────────┐
              │              │                  │
              ▼              ▼                  ▼
      ┌──────────────┐ ┌──────────┐   ┌────────────────┐
      │SecureStorage │ │LocalStg  │   │HttpServiceLoc  │
      │(token_key,   │ │(session, │   │(.httpService)  │
      │refresh_token)│ │ accounts,│   │                │
      └──────────────┘ │ prefs)   │   └───────┬────────┘
                       └──────────┘           │
                                              ▼
                                    ┌──────────────────┐
                                    │  refreshProfile() │
                                    │  GET /activitypub │
                                    │    /$handle/prof  │
                                    └──────────────────┘

   读取 GlobalContext 的组件:
   ┌─────────────┐  ┌──────────────┐  ┌──────────────┐
   │TokenProvider │  │AuthMiddleware│  │AvatarResolver│
   │(read token)  │  │(read token)  │  │(read profile)│
   └──────┬──────┘  └──────────────┘  └──────────────┘
          │
          ▼
   ┌─────────────┐  ┌──────────────┐  ┌──────────────┐
   │AuthIntercept│  │EventStreamSvc│  │RTCSignaling  │
   │(via TokProv)│  │(direct read) │  │(direct read) │
   └─────────────┘  └──────────────┘  └──────────────┘

   写入 GlobalContext 的组件:
   ┌──────────────┐  ┌───────────────────────┐
   │AuthController│  │AppLifecycleOrchestrat.│
   │(setSession)  │  │(setSession(null))     │
   └──────────────┘  └───────────────────────┘
   ┌──────────────┐  ┌──────────────┐
   │main.dart     │  │TokenProvider │
   │(setSession   │  │(writeTokens  │
   │  null)       │  │ → 直改 Map)  │
   └──────────────┘  └──────────────┘
```

---

## 11. 测试覆盖

`client/desktop/test/context/` 目录下有 10 个测试文件：

| 测试文件 | 覆盖范围 |
|---------|---------|
| `default_global_context_test.dart` | 基本实例化 |
| `default_global_context_hydrate_test.dart` | hydrate 恢复 |
| `default_global_context_persist_test.dart` | 持久化写入 |
| `default_global_context_pb_write_test.dart` | Proto 快照写入 |
| `default_global_context_accounts_schema_test.dart` | 账号 schema |
| `default_global_context_snapshot_test.dart` | Session 快照 |
| `default_global_context_network_test.dart` | 网络状态 |
| `default_global_context_protocol_test.dart` | 协议标识 |
| `default_global_context_schema_test.dart` | Schema 版本 |
| `default_global_context_proto_hydrate_test.dart` | Proto 格式恢复 |

**缺失测试**：`refreshProfile()`、`requestLogout()`、幂等 hydrate、`onSessionChange` 事件流。

---

## 12. 总结：当前架构的核心矛盾

1. **GlobalContext 承担了太多职责**：会话管理、profile 管理、偏好设置、协议检测、网络状态、登出事件——全部揉在一个类里。
2. **Map 做数据载体**：缺乏类型安全，key 拼写靠约定，没有编译期检查。
3. **token 读取路径不统一**：部分组件走 `TokenProvider`，部分直接读 `GlobalContext.currentSession`，未来 token 刷新时很容易不一致。
4. **refreshProfile() 与 setSession() 耦合**：setSession 自动触发 profile 刷新，但不等待结果，导致时序不可预测。
5. **登出逻辑分散在 main.dart**：`_performLogout()` 作为一个 Widget State 的私有方法来执行全局登出清理，职责放错了位置。
