# 雷达搜索功能 - 下一步建议

## 已完成
- ✅ 后端：新增本地 Actor 模糊搜索接口 `GET /activitypub/search?q=xxx`
- ✅ 前端：重构 RadarView UI，移除地图和 mock 数据
- ✅ 前端：实现搜索框和本地搜索逻辑
- ✅ 前端：更新 DiscoveryController 集成搜索功能
- ✅ 编译通过：前后端均无错误

## 待测试
1. **功能验证**
   - 启动 Station 和 Desktop 应用
   - 验证用户列表加载（调用 `/activitypub/list`）
   - 验证搜索功能（调用 `/activitypub/search?q=xxx`）
   - 验证空状态、错误状态展示

## 优化建议（可选）

### 1. 搜索体验优化
- **搜索防抖**：避免每次输入都发起请求
  ```dart
  // 在 DiscoveryController 中添加
  Timer? _searchDebounce;
  
  void searchFriends(String query) {
    _searchDebounce?.cancel();
    _searchDebounce = Timer(const Duration(milliseconds: 300), () {
      _performSearch(query);
    });
  }
  ```

- **搜索历史**：记录最近搜索的关键词
- **搜索建议**：根据输入提供自动补全

### 2. Follow 功能实现
- 实现 Follow 按钮点击逻辑
- 调用 `POST /:actor/follow` 接口
- 更新 UI 状态（Following/Follow）
- 支持 Unfollow 操作

### 3. 用户详情页
- 点击用户卡片跳转到详情页
- 显示用户完整信息（简介、头像、发帖数、关注数等）
- 支持查看用户的 Outbox（发帖列表）

### 4. 头像支持
- 后端：在 Actor 表中存储头像 URL（`icon` 字段）
- 前端：优先显示真实头像，降级到首字母头像
- 支持头像上传功能

### 5. 在线状态
- 集成现有的 `/activitypub/online` 接口
- 在用户列表中显示在线状态（绿点）
- 实时更新在线状态

## 联邦功能（未来）

### 1. WebFinger 精确查询
- 用户输入完整地址（如 `alice@example.com`）
- 调用 WebFinger 查询远程 Actor
- 缓存到本地数据库

### 2. Relay 集成
- 订阅公共 Relay 服务器
- 接收其他实例的公开活动
- 自动缓存远程 Actor

### 3. 实例推荐
- 提供推荐实例列表
- 用户可浏览其他实例的公开用户目录
- 类似 Mastodon 的"探索"功能

## 技术债务

### 1. 错误处理
- 统一错误提示格式
- 添加重试机制
- 记录错误日志

### 2. 性能优化
- 搜索结果分页（如果用户量大）
- 虚拟滚动（如果列表很长）
- 图片懒加载

### 3. 测试覆盖
- 单元测试：Controller 和 Repository
- 集成测试：搜索流程
- E2E 测试：完整用户流程

---

**创建时间**: 2026-01-03
**状态**: 待测试
