# 修复登录导航问题 - 基于事件的优雅方案

## 问题分析

### 当前实现的问题

1. **时序依赖**：使用 `await Future.delayed(800ms)` 硬编码等待时间
   - 如果系统慢，800ms 可能不够
   - 如果系统快，800ms 浪费时间
   - 脆弱且不可靠

2. **架构缺陷**：logout 流程缺乏完成通知
   ```dart
   // GlobalContext
   requestLogout() {
     _logoutCtrl.add(reason);  // 只是发出事件，无法追踪完成状态
   }
   
   // AppController
   _logoutSubscription = globalContext.onLogoutRequested.listen((reason) {
     _performLogout();  // 异步执行，但调用者无法等待
   });
   ```

3. **根本原因**：单向事件流，缺少反馈机制
   - Splash → GlobalContext：触发 logout
   - GlobalContext → AppController：传递 logout 事件
   - AppController → ❓：完成后没有通知任何人

## 优雅的解决方案

### 方案 A：添加 Logout 完成事件流（推荐）

在 GlobalContext 中添加一个新的 Stream 来通知 logout 完成：

```dart
// GlobalContext 接口
abstract class GlobalContext {
  // 现有
  Stream<LogoutReason> get onLogoutRequested;
  
  // 新增：logout 完成通知
  Stream<bool> get onLogoutCompleted;
  
  // 内部方法：AppController 调用以通知完成
  void notifyLogoutCompleted();
}
```

**优点**：
- 完全基于事件，符合现有架构
- 解耦，各模块职责清晰
- 可扩展，其他地方也可以监听 logout 完成

**缺点**：
- 需要修改 GlobalContext 接口
- 需要确保 AppController 正确调用 `notifyLogoutCompleted()`

### 方案 B：Logout 返回 Completer/Future

让 `requestLogout` 返回一个 Future，调用者可以等待：

```dart
// GlobalContext
final Map<String, Completer<void>> _logoutCompleters = {};

Future<void> requestLogout(LogoutReason reason) {
  final id = DateTime.now().millisecondsSinceEpoch.toString();
  final completer = Completer<void>();
  _logoutCompleters[id] = completer;
  
  _logoutCtrl.add({'id': id, 'reason': reason});
  
  return completer.future;
}

void _completeLogout(String id) {
  _logoutCompleters[id]?.complete();
  _logoutCompleters.remove(id);
}
```

**优点**：
- 直观，调用者直接 await
- 不需要额外的监听器

**缺点**：
- 改变了 `requestLogout` 的签名（breaking change）
- 需要传递 logout ID，增加复杂度
- 如果 AppController 忘记调用 complete，会永久挂起

### 方案 C：重新设计 Splash 登录检查流程（最简单）

问题的根源在于 Splash 的 `directLogin` 流程过于复杂。我们可以简化：

```dart
void directLogin() async {
  if (isLoading.value) return;
  
  isLoading.value = true;
  showButtons.value = false;
  statusMessage.value = '验证身份...';
  
  final tokenProvider = Get.find<TokenProvider>();
  final token = await tokenProvider.readAccessToken();
  
  if (token == null || token.isEmpty) {
    // 直接导航到登录页，不触发 logout 事件
    LoggingService.info('Splash: No token, navigating to login');
    Get.offAllNamed(AppRoutes.login);
    return;
  }
  
  // 验证 token
  final verifyResult = await _verifyToken();
  
  if (verifyResult != _VerifyResult.valid) {
    // Token 无效，清除并导航到登录页
    LoggingService.info('Splash: Token invalid, clearing and navigating to login');
    await Get.find<GlobalContext>().setSession(null);
    await tokenProvider.clear();
    Get.offAllNamed(AppRoutes.login);
    return;
  }
  
  // Token 有效，继续验证 profile
  await _checkProfileAndNavigate();
}
```

**关键变化**：
- Splash 直接控制导航，不依赖 AppController 的 logout 监听器
- 只在必要时清除 session，然后立即导航
- 避免了事件触发 → 等待完成的复杂性

**优点**：
- 最简单，不需要修改 GlobalContext 或 AppController
- 流程清晰，Splash 自己负责自己的导航
- 无时序问题

**缺点**：
- Splash 需要直接调用 `setSession(null)`，增加了职责
- 可能与 AppController 的 logout 监听器有重复逻辑

## 推荐方案

### 综合方案：方案 A + 方案 C 的混合

1. **短期修复（方案 C）**：
   - 立即修复 Splash 的登录流程，让它自己控制导航
   - 移除 800ms 延迟
   - 不依赖 logout 事件的完成通知

2. **长期优化（方案 A）**：
   - 在 GlobalContext 中添加 `onLogoutCompleted` stream
   - 让其他需要等待 logout 完成的地方可以监听
   - 保持架构的一致性和可扩展性

### 实现步骤

#### 步骤 1：修复 Splash Controller（立即）

```dart
// splash_controller.dart

Future<void> _checkAuthAndNavigate() async {
  try {
    statusMessage.value = '验证身份...';
    
    final tokenProvider = Get.find<TokenProvider>();
    final token = await tokenProvider.readAccessToken();
    
    if (token == null || token.isEmpty) {
      LoggingService.info('Splash: No token found, navigating to login');
      statusMessage.value = '请登录';
      await Future.delayed(const Duration(milliseconds: 300));
      Get.offAllNamed(AppRoutes.login);
      return;
    }
    
    LoggingService.info('Splash: Token found, verifying with backend');
    final verifyResult = await _verifyToken();
    
    if (verifyResult == _VerifyResult.valid) {
      // Token 有效，检查 profile
      await _checkProfileAndNavigate();
    } else if (verifyResult == _VerifyResult.networkError) {
      // 网络错误，允许进入
      LoggingService.warning('Splash: Token verify skipped (network error), entering app');
      statusMessage.value = '登录成功';
      await Future.delayed(const Duration(milliseconds: 300));
      Get.offAllNamed(AppRoutes.shell);
    } else {
      // Token 无效，清除并导航到登录
      LoggingService.warning('Splash: Token invalid, clearing session and navigating to login');
      
      // 清除 session（不触发 logout 事件）
      if (Get.isRegistered<GlobalContext>()) {
        await Get.find<GlobalContext>().setSession(null);
      }
      await tokenProvider.clear();
      
      statusMessage.value = '请重新登录';
      await Future.delayed(const Duration(milliseconds: 300));
      Get.offAllNamed(AppRoutes.login);
    }
  } catch (e) {
    LoggingService.error('Splash: Error checking auth: $e');
    statusMessage.value = '验证失败';
    await Future.delayed(const Duration(milliseconds: 300));
    Get.offAllNamed(AppRoutes.login);
  }
}
```

**关键改动**：
- 移除 `requestLogout()` 调用
- 移除 800ms 延迟
- 直接清除 session 并导航
- Splash 完全控制自己的导航流程

#### 步骤 2：添加 Logout 完成事件（可选，后续优化）

如果未来有其他地方需要等待 logout 完成，可以添加：

```dart
// global_context.dart
abstract class GlobalContext {
  Stream<bool> get onLogoutCompleted;
  void notifyLogoutCompleted();
}

// default_global_context.dart
final _logoutCompletedCtrl = StreamController<bool>.broadcast();

@override
Stream<bool> get onLogoutCompleted => _logoutCompletedCtrl.stream;

@override
void notifyLogoutCompleted() {
  _logoutCompletedCtrl.add(true);
}

// app_controller.dart
Future<void> _performLogout() async {
  try {
    // ... 现有的 logout 逻辑 ...
    
    // 通知完成
    if (Get.isRegistered<GlobalContext>()) {
      Get.find<GlobalContext>().notifyLogoutCompleted();
    }
  } finally {
    _isHandlingLogout = false;
  }
}
```

## 测试计划

1. **场景 1：Token 过期**
   - 启动应用 → Splash 页面
   - 点击"直接登录"
   - 验证：应立即跳转到登录页（无 800ms 延迟）

2. **场景 2：登录成功**
   - 在登录页输入用户名密码
   - 点击登录
   - 验证：应立即跳转到 shell 页面

3. **场景 3：Token 有效**
   - 启动应用（已登录状态）
   - 点击"直接登录"
   - 验证：应直接进入 shell 页面

## 总结

**立即行动**：
- 使用方案 C，修复 Splash Controller
- 移除 800ms 延迟
- 让 Splash 自己控制导航流程

**为什么之前选择了延迟方案**：
- 我错误地认为必须等待 AppController 的 logout 监听器完成导航
- 实际上，Splash 可以自己清除 session 并导航，不需要依赖事件流
- 这是对现有架构理解不够深入导致的次优方案

**新方案的优势**：
- 简单直接，无时序依赖
- 流程清晰，职责明确
- 无需修改 GlobalContext 或 AppController
- 完全基于同步控制流，而非异步事件等待
