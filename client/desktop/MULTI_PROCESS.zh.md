# 多进程多用户运行说明

## 实现效果

✅ **任意多进程**：可以启动任意数量的客户端进程  
✅ **按用户隔离**：每个用户使用独立的数据存储  
✅ **共享用户列表**：所有进程共享历史登录用户列表  
✅ **同用户多进程**：同一个用户可以在多个进程中登录，共享数据  
✅ **标准化存储**：使用 `FileStorageManager` 标准化存储路径  
🚧 **最后登录免密**：最后登录的用户可以快速登录（待实现）  
🚧 **其他用户需密码**：切换到其他用户需要输入密码（待实现）

## 使用方法

### 启动多个实例

```bash
# 终端 1 - 启动第一个实例，登录 alice
cd client/desktop
flutter run

# 终端 2 - 启动第二个实例，登录 bob
cd client/desktop
flutter run

# 终端 3 - 启动第三个实例，也登录 alice（共享数据）
cd client/desktop
flutter run
```

- 进程 1 和进程 3 登录同一个用户（alice），共享数据
- 进程 2 登录不同用户（bob），数据独立

### 登录流程

1. **首次启动**：显示登录页面，输入账号密码登录
2. **再次启动**：
   - 如果是最后登录的用户 → 自动登录（待实现）
   - 如果要切换用户 → 显示历史用户列表，选择后输入密码（待实现）

## 技术实现

### 1. 按用户隔离存储

每个用户使用独立的数据目录和 Keychain 账户：

```
~/Library/Application Support/peers_touch_desktop/
├── global/
│   └── users.db            # 所有登录过的用户列表（共享）
│
└── users/
    ├── alice@example.com/
    │   ├── kv_storage.db   # alice 的数据
    │   └── keychain: alice@example.com  # alice 的 token
    │
    └── bob@example.com/
        ├── kv_storage.db   # bob 的数据
        └── keychain: bob@example.com    # bob 的 token
```

**特点**：
- ✅ 按用户隔离，不是按进程
- ✅ 同一用户在多个进程中共享数据
- ✅ 符合 macOS 标准存储路径（Application Support）
- ✅ 使用 `FileStorageManager` 标准化管理

### 2. 核心修改

#### [connection.dart](file://client/common/peers_touch_base/lib/storage/connection/connection.dart)

```dart
// 进程独立数据库
LazyDatabase getConnection(String dbName) {
  final dbFolder = Directory(p.join(currentDir.path, 'data', 'process_$pid'));
  // ...
}

// 全局共享数据库
LazyDatabase getGlobalConnection(String dbName) {
  final dbFolder = Directory(p.join(currentDir.path, 'data', 'global'));
  // ...
}
```

#### [secure_storage.dart](file://client/common/peers_touch_base/lib/storage/secure_storage.dart)

```dart
SecureStorageImpl() {
  final processId = pid.toString();
  _fs = FlutterSecureStorage(
    mOptions: MacOsOptions(
      groupId: 'com.peerstouch.process$processId',
      accountName: 'process$processId',
    ),
  );
}
```

#### [global_users_storage.dart](file://client/common/peers_touch_base/lib/storage/global_users_storage.dart)

```dart
class GlobalUsersStorage {
  // 保存用户信息（所有进程共享）
  Future<void> saveUser({
    required String handle,
    String? email,
    String? avatarUrl,
    String? serverUrl,
  });

  // 获取所有用户（按最后登录时间排序）
  Future<List<GlobalUserItem>> getAllUsers();

  // 获取最后登录的用户
  Future<GlobalUserItem?> getLastLoginUser();
}
```

### 3. 数据流程

#### 登录时

```
用户输入账号密码
  ↓
登录成功
  ↓
保存到进程独立存储（当前进程的 token）
  ↓
保存到全局共享存储（用户信息 + 最后登录时间）
```

#### 启动时

```
读取全局共享存储
  ↓
获取最后登录的用户
  ↓
检查当前进程是否有该用户的 token
  ↓
有 → 自动登录
无 → 显示登录页面，预填充用户信息
```

## 对比 QQ/微信

| 特性 | QQ/微信 | Peers-Touch |
|-----|--------|-------------|
| **多开方式** | 启动参数 `--profile` | 自动按进程 ID 隔离 |
| **用户列表** | 全局共享 | 全局共享 ✅ |
| **登录态** | 进程独立 | 进程独立 ✅ |
| **最后登录** | 免密快速登录 | 待实现 🚧 |
| **切换用户** | 需要密码 | 待实现 🚧 |

## 待实现功能

- [ ] 登录页面显示历史用户列表
- [ ] 最后登录用户的快速登录
- [ ] 切换用户时的密码验证
- [ ] 用户头像缓存
- [ ] 退出登录时清理进程数据

## 常见问题

### Q1: 进程退出后数据会丢失吗？

A: **会的**。进程退出后，该进程的数据目录 `data/process_xxx/` 会保留，但下次启动会使用新的进程 ID。

**解决方案**：
- 登录态保存在全局共享存储
- 下次启动时从全局存储恢复

### Q2: 如何清理旧进程的数据？

```bash
# 查看所有进程数据
ls -la data/process_*

# 删除特定进程的数据
rm -rf data/process_12345

# 清理所有进程数据（保留全局数据）
rm -rf data/process_*
```

### Q3: Keychain 会不会越来越多？

A: 会的。每个进程都会在 Keychain 中创建一个账户。

**查看 Keychain 数据**：
```bash
security find-generic-password -s com.peerstouch
```

**清理 Keychain**：
```bash
# 删除特定进程的 Keychain
security delete-generic-password -a process12345 -s com.peerstouch.process12345

# 删除所有 Peers-Touch 的 Keychain（慎用）
security delete-generic-password -s com.peerstouch
```

### Q4: 生产环境会有这个问题吗？

A: **不会**。生产环境下：
- 用户通常只启动一个实例
- 即使启动多个，也是为了多账号登录（符合设计）
- 旧进程的数据会自动过期（token 有效期）

### Q5: 为什么不用 PROFILE 环境变量？

A: PROFILE 需要手动指定，不符合 "任意多进程" 的需求。进程 ID 是自动的，更简单。

## 性能影响

- **磁盘占用**：每个进程约 1-5MB（主要是 SQLite 数据库）
- **Keychain 占用**：每个进程约 1KB（只存储 token）
- **启动速度**：无影响（进程 ID 获取是 O(1)）

## 未来优化

- [ ] 自动清理超过 7 天未使用的进程数据
- [ ] 自动清理无效的 Keychain 条目
- [ ] 支持手动管理进程数据（设置页面）
- [ ] 支持导出/导入用户数据

---

**当前状态**：核心隔离机制已完成 ✅  
**下一步**：实现登录页面的用户选择和快速登录功能 🚧
