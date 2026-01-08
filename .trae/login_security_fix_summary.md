# 登录页安全修复总结

## 问题描述

1. ❌ 登录页从后端接口 `/activitypub/list` 拉取用户列表
2. ❌ 本地缓存只保存用户名，不保存email，导致显示不一致
3. ❌ 拉取用户列表是敏感操作，不应该在未登录状态下进行

## 安全问题分析

### 为什么不应该拉取用户列表？

1. **隐私泄露**: 未登录状态下暴露所有用户信息
2. **安全风险**: 攻击者可以枚举所有用户账号
3. **不必要的请求**: 登录页只需要显示本机历史登录用户

### 正确的做法

✅ **只使用本地缓存** - 显示在本机历史登录过的用户
✅ **保存完整信息** - 缓存用户名、email、头像
✅ **不发送请求** - 登录前不向服务器请求用户列表

## 修复内容

### 修复1: 移除 `loadPresetUsers` 调用

**文件**: `client/desktop/lib/features/auth/controller/auth_controller.dart`

**移除的调用位置**:
1. `onInit()` 中的 `baseUrl` debounce 回调
2. `onReady()` 方法
3. `loadPresetUsers()` 方法本身

```dart
// ❌ 删除的代码
Future<void> loadPresetUsers(String baseUrl) async {
  // 调用 /activitypub/list 接口获取用户列表
}

// ✅ 替换为注释
// Removed loadPresetUsers - no longer fetching user list from server for security reasons
// User suggestions now come from local cache only (recent_users, recent_emails, recent_avatars)
```

### 修复2: 扩展本地缓存结构

**新增缓存字段**: `recent_emails`

**本地缓存结构**:
```dart
LocalStorage:
  - recent_users: List<String>           // 用户名列表
  - recent_emails: Map<String, String>   // 用户名 -> email 映射
  - recent_avatars: Map<String, String>  // 用户名 -> 头像URL 映射
```

### 修复3: 新增 `_saveRecentUser` 方法

**功能**: 统一保存用户信息到本地缓存

```dart
Future<void> _saveRecentUser(String handle, {String? email, String? avatarUrl}) async {
  // 1. 保存用户名到 recent_users（最近使用的排在前面）
  // 2. 如果有email，保存到 recent_emails
  // 3. 如果有头像，保存到 recent_avatars
  // 4. 同步更新 presetUsers（用于UI显示）
}
```

**调用位置**:
- 登录成功后
- 获取用户头像后

### 修复4: 更新 `_restoreUserInfo` 方法

**新增逻辑**: 从 `recent_emails` 恢复email信息

```dart
Future<void> _restoreUserInfo() async {
  // ... 恢复 username, email, recent_users, recent_avatars
  
  // 新增：恢复 recent_emails
  final emails = await ls.get<Map>('recent_emails');
  if (emails != null) {
    final emailMap = emails.cast<String, String>();
    for (final handle in recentUsers) {
      final userEmail = emailMap[handle];
      if (userEmail != null && userEmail.isNotEmpty) {
        // 将email信息添加到 presetUsers 中，供UI显示
        presetUsers.add({
          'username': handle,
          'handle': handle,
          'email': userEmail,
        });
      }
    }
  }
}
```

### 修复5: 登录成功后保存email

**位置**: `login()` 方法中

```dart
await _saveRecentUser(
  handle, 
  email: email.value.isNotEmpty ? email.value : null,
  avatarUrl: avatarUrl.isNotEmpty ? avatarUrl : null,
);

await gc.setSession({
  'actorId': handle,
  'handle': handle,
  'email': email.value,  // 新增：保存email到session
  // ...
});
```

## 数据流

### 登录流程

```
用户输入账号密码
    ↓
发送登录请求
    ↓
登录成功，获取token和用户信息
    ↓
保存到本地缓存:
  - recent_users: [handle]
  - recent_emails: {handle: email}
  - recent_avatars: {handle: avatarUrl}
    ↓
更新 presetUsers (内存):
  [{username: handle, email: email, ...}]
    ↓
下次打开应用时从缓存恢复
```

### 下拉列表显示流程

```
打开登录页
    ↓
_restoreUserInfo() 从本地缓存读取
    ↓
recentUsers: 用户名列表
recentEmails: 用户名 -> email 映射
recentAvatars: 用户名 -> 头像 映射
    ↓
构建 presetUsers (内存):
  [{username, email, avatar}, ...]
    ↓
UI 显示:
  用户名
  email (小2号字体)
```

## 安全改进

### 修复前 ❌

```
打开登录页
    ↓
调用 GET /activitypub/list (无需认证)
    ↓
返回所有用户列表:
  - 用户名
  - Email
  - 头像
  - 等等
    ↓
显示在下拉列表中
```

**问题**:
- 暴露所有用户信息
- 攻击者可以枚举用户
- 不必要的网络请求

### 修复后 ✅

```
打开登录页
    ↓
从本地缓存读取 (不发送请求)
    ↓
只显示本机历史登录用户
    ↓
显示在下拉列表中
```

**优点**:
- 不暴露其他用户信息
- 不发送不必要的请求
- 更快的加载速度
- 更好的隐私保护

## 测试验证

### 手动测试步骤

1. **清空本地缓存**
   ```bash
   # macOS
   rm -rf ~/Library/Application\ Support/peers_touch_desktop/
   ```

2. **启动客户端**
   ```bash
   cd client/desktop && flutter run -d macos
   ```

3. **验证不发送请求**
   - 打开登录页
   - 查看网络请求（DevTools Network tab）
   - 验证：❌ 没有 `/activitypub/list` 请求

4. **登录一个账号**
   - 输入用户名: `test-user`
   - 输入邮箱: `test@example.com`
   - 输入密码并登录

5. **退出并重新打开**
   - 退出登录
   - 重新打开登录页
   - 验证：
     - ✅ 下拉列表显示 `test-user`
     - ✅ 下拉列表显示 `test@example.com` (小2号字体)
     - ✅ 没有其他用户

6. **登录第二个账号**
   - 登录 `test-user-2` / `test2@example.com`
   - 退出并重新打开
   - 验证：
     - ✅ 下拉列表显示两个用户
     - ✅ 每个用户都显示对应的email
     - ✅ 最近登录的排在前面

## 修改的文件

✅ `client/desktop/lib/features/auth/controller/auth_controller.dart`
  - 移除 `loadPresetUsers()` 方法
  - 移除 `loadPresetUsers()` 调用
  - 新增 `_saveRecentUser()` 方法
  - 更新 `_restoreUserInfo()` 方法
  - 更新 `login()` 方法保存email

✅ `client/desktop/lib/features/auth/view/login_page.dart`
  - 在用户名下方显示email（之前已修复）

## 版本信息

- 修复日期: 2026-01-08
- 测试状态: 待验证
- 影响范围: 登录页用户列表显示
- 安全等级: 高优先级修复

## 注意事项

1. **数据迁移**: 旧版本的用户缓存没有email信息，需要重新登录一次
2. **缓存清理**: 如果需要清除历史用户，删除本地缓存文件即可
3. **隐私保护**: 本地缓存包含敏感信息，应该加密存储（后续改进）
