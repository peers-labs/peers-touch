# Profile 头像/背景图上传修复总结

## 问题描述

1. ❌ 点击"保存"按钮后，对话框不关闭
2. ❌ 没有成功/失败提示
3. ❌ 头像和背景图上传后不生效

## 根本原因

### 1. 字段映射错误
```dart
// ❌ 错误
final remoteUrl = result['remoteUrl']?.toString() ?? '';

// ✅ 正确
final remoteUrl = result['url']?.toString() ?? '';
```

**原因**: OSS返回的字段是 `url`，不是 `remoteUrl`

### 2. HTTP方法错误
```dart
// ❌ 错误
await client.patchResponse<dynamic>('/activitypub/$handle/profile', data: data);

// ✅ 正确
await client.postResponse<dynamic>('/activitypub/profile', data: data);
```

**原因**: 后端使用 `POST` 方法，且路由不包含 `handle` 参数（从JWT获取）

### 3. Dialog不关闭
```dart
// ❌ 错误
void _save() {
  _controller.updateProfile(updates);  // 没有await，没有关闭dialog
}

// ✅ 正确
Future<void> _save() async {
  await _controller.updateProfile(updates);
  Get.back();  // 关闭dialog
  Get.snackbar(...);  // 显示成功消息
}
```

### 4. 异常没有抛出
```dart
// ❌ 错误
catch (e) {
  LoggingService.error('Update profile failed: $e');
  // 没有rethrow，dialog无法捕获错误
}

// ✅ 正确
catch (e) {
  LoggingService.error('Update profile failed: $e');
  rethrow;  // 抛出异常给dialog处理
}
```

## 修复内容

### 文件1: profile_controller.dart

**位置1**: `uploadFile()` 方法 (第142行)
```dart
final remoteUrl = result['url']?.toString() ?? '';  // 修复字段名
```

**位置2**: `_sendProfileUpdate()` 方法 (第121-122行)
```dart
await client.postResponse<dynamic>(  // 修复HTTP方法
  '/activitypub/profile',  // 修复路由路径
  data: data,
);
```

**位置3**: `updateProfile()` 方法 (第223行)
```dart
catch (e) {
  LoggingService.error('Update profile failed: $e');
  rethrow;  // 添加异常抛出
}
```

### 文件2: edit_profile_dialog.dart

**位置1**: `_save()` 方法 (第105-147行)
```dart
Future<void> _save() async {  // 改为async
  if (!_formKey.currentState!.validate()) return;
  
  final updates = <String, dynamic>{...};
  
  try {
    await _controller.updateProfile(updates);  // 等待完成
    if (mounted) {
      Get.back();  // 关闭dialog
      Get.snackbar(  // 显示成功消息
        '成功',
        '个人资料已更新',
        snackPosition: SnackPosition.TOP,
        backgroundColor: Colors.green,
        colorText: Colors.white,
      );
    }
  } catch (e) {
    if (mounted) {
      Get.snackbar(  // 显示失败消息
        '失败',
        '更新失败: $e',
        snackPosition: SnackPosition.TOP,
        backgroundColor: Colors.red,
        colorText: Colors.white,
      );
    }
  }
}
```

## 后端配置验证

**路由定义** (activitypub_router.go:59):
```go
RouterURLActorProfile = "/profile"
```

**路由注册** (activitypub_handler.go:74-78):
```go
{
    RouterURL: RouterURLActorProfile,  // "/profile"
    Handler:   UpdateActorProfile,
    Method:    server.POST,            // POST方法
    Wrappers:  []server.Wrapper{actorWrapper, jwtWrapper},
}
```

**数据库字段** (actor.go:18-19):
```go
Icon  string `gorm:"size:512"`  // Avatar URL
Image string `gorm:"size:512"`  // Header Image URL
```

## 完整流程

```
用户编辑个人资料
    ↓
1. 上传头像/背景图（可选）
    ├─ uploadFile() → OssService.uploadFile()
    ├─ OSS返回: {url: '/storage/xxx.jpg', ...}
    ├─ 提取url字段
    └─ 设置本地状态 (_avatarUrl, _headerUrl)
    ↓
2. 修改其他字段（昵称、简介等）
    ↓
3. 点击"保存"按钮
    ├─ 收集所有更新数据
    ├─ 调用 updateProfile(updates)
    ├─ 发送 POST /activitypub/profile
    ├─ 后端从JWT获取actor_id
    ├─ 更新数据库
    ├─ 刷新profile缓存
    ├─ 关闭dialog
    └─ 显示成功toast
    ↓
✅ 完成
```

## 测试验证

### 单元测试
```bash
cd client/desktop
flutter test test/features/profile/controller/
```

结果: ✅ 9个测试全部通过

### 手动测试步骤

1. **启动后端**
   ```bash
   cd station && go run main.go
   ```

2. **启动客户端**
   ```bash
   cd client/desktop && flutter run -d macos
   ```

3. **测试流程**
   - 登录账号
   - 打开个人页 → 点击"编辑资料"
   - 上传头像（点击头像区域）
   - 上传背景图（点击Header区域）
   - 修改昵称
   - 点击"保存"按钮

4. **预期结果**
   - ✅ Dialog关闭
   - ✅ 显示绿色成功toast: "个人资料已更新"
   - ✅ 个人页立即显示新头像/背景图
   - ✅ 刷新页面后数据持久化

5. **控制台日志验证**
   ```
   [DEBUG] OSS upload result: {key: xxx, url: /storage/xxx.jpg, ...}
   [DEBUG] Extracted remoteUrl: /storage/xxx.jpg
   [INFO] Upload successful: /storage/xxx.jpg
   [INFO] Sending POST /activitypub/profile with data: {avatar: /storage/xxx.jpg, ...}
   [INFO] Profile update response: 200
   [INFO] Profile refreshed successfully
   ```

### 数据库验证
```sql
SELECT id, preferred_username, icon, image 
FROM touch_actor 
WHERE preferred_username = 'your-handle';
```

应该看到 `icon` 和 `image` 字段包含正确的URL。

## 修改的文件

1. ✅ `client/desktop/lib/features/profile/controller/profile_controller.dart`
   - 修复字段映射: `remoteUrl` → `url`
   - 修复HTTP方法: `patchResponse` → `postResponse`
   - 修复路由路径: 移除 `$handle` 参数
   - 添加异常抛出: `rethrow`
   - 添加详细日志

2. ✅ `client/desktop/lib/features/profile/view/edit_profile_dialog.dart`
   - 修复保存方法: 改为 `async/await`
   - 添加dialog关闭逻辑
   - 添加全局toast提示

3. ✅ `client/desktop/test/features/profile/controller/profile_controller_test.dart`
   - 单元测试覆盖

4. ✅ `client/desktop/test/features/profile/controller/profile_upload_integration_test.dart`
   - 集成测试和验证指南

## 注意事项

1. **OSS返回格式**: 必须使用 `url` 字段，不是 `remoteUrl`
2. **后端路由**: 是 `/activitypub/profile`，不包含handle参数
3. **认证方式**: 通过JWT token，后端自动获取actor_id
4. **保存流程**: 上传图片后需要点击"保存"按钮才会真正更新到服务器
5. **异常处理**: Controller必须抛出异常，Dialog才能捕获并显示错误

## 版本信息

- 修复日期: 2026-01-08
- 测试状态: ✅ 通过
- 影响范围: 个人资料编辑功能
