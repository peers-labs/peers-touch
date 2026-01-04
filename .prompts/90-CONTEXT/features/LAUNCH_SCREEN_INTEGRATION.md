# Launch Screen 集成指南

本文档说明如何将 Launch Screen 功能集成到 Peers-Touch 项目中。

## 📦 已完成的组件

### 客户端 (Flutter Desktop)
- ✅ UI 组件：`client/desktop/lib/features/launch/`
- ✅ 路由配置：已添加到 `AppRoutes`
- ✅ 服务层：`LauncherService` API 调用
- ✅ 编译通过

### 服务端 (Go Station)
- ✅ SubServer 实现：`station/app/subserver/launcher/`
- ✅ API 端点：
  - `GET /api/launcher/feed`
  - `GET /api/launcher/search`
- ✅ 编译通过
- ✅ 符合项目规范

---

## 🔧 集成步骤

### 步骤 1: 启用 Launcher SubServer

#### 1.1 添加配置

在 `station/config/config.yaml` 中添加：

```yaml
peers:
  node:
    server:
      subserver:
        launcher:
          enabled: true           # 启用 launcher subserver
          rds-name: "station.db"  # 可选：数据库名称
```

#### 1.2 在主程序中注册

编辑 `station/app/main.go`，添加 launcher 导入和注册：

```go
package main

import (
    // ... 其他导入 ...
    
    "github.com/peers-labs/peers-touch/station/app/subserver/chat"
    "github.com/peers-labs/peers-touch/station/app/subserver/launcher"  // 新增
    "github.com/peers-labs/peers-touch/station/app/subserver/oauth"
    "github.com/peers-labs/peers-touch/station/app/subserver/oss"
)

func main() {
    // ... 初始化代码 ...
    
    err := p.Init(
        ctx,
        node.WithPrivateKey("private.pem"),
        node.Name("peers-touch-station"),
        server.WithSubServer("debug", actuator.NewDebugSubServer, actuator.WithDebugServerPath("/debug")),
        server.WithSubServer("chat", chat.NewChatSubServer),
        server.WithSubServer("launcher", launcher.New),  // 新增
        server.WithSubServer("oauth", oauth.NewOAuthSubServer),
        server.WithSubServer("oss", oss.NewOSSSubServer, oss.WithAuthProvider(jwtProvider)),
    )
    
    // ... 其余代码 ...
}
```

### 步骤 2: 启动服务

```bash
cd station
go run app/main.go
```

查看日志确认启动成功：
```
[INFO] begin to initiate new launcher subserver
[INFO] end to initiate new launcher subserver
[INFO] launcher subserver started
```

### 步骤 3: 测试 API

#### 3.1 测试信息流端点

```bash
curl "http://localhost:8080/api/launcher/feed?user_id=test&limit=20"
```

预期响应：
```json
{
  "items": [
    {
      "id": "feed_1",
      "type": "recommendation",
      "title": "Welcome to Peers-Touch",
      "subtitle": "Get started with your decentralized social network",
      "timestamp": "2024-01-04T10:00:00Z",
      "source": "station_feed"
    }
  ]
}
```

#### 3.2 测试搜索端点

```bash
curl "http://localhost:8080/api/launcher/search?q=alice&limit=10"
```

预期响应：
```json
{
  "results": [
    {
      "id": "user_1",
      "type": "friend",
      "title": "Alice",
      "subtitle": "@alice@peers.com"
    }
  ],
  "total": 1
}
```

### 步骤 4: 客户端配置

#### 4.1 配置 API 基础 URL

编辑 `client/desktop/lib/core/config/app_config.dart`：

```dart
class AppConfig {
  static const String apiBaseUrl = 'http://localhost:8080';
  // 或者使用环境变量
  // static String get apiBaseUrl => 
  //   const String.fromEnvironment('API_BASE_URL', defaultValue: 'http://localhost:8080');
}
```

#### 4.2 启动客户端

```bash
cd client/desktop
flutter run -d macos
```

#### 4.3 导航到 Launch Screen

在应用中调用：
```dart
Get.toNamed(AppRoutes.launch);
```

或者添加快捷键（推荐 Cmd+K）：
```dart
// 在主界面添加
RawKeyboardListener(
  focusNode: FocusNode(),
  onKey: (event) {
    if (event.isMetaPressed && event.logicalKey == LogicalKeyboardKey.keyK) {
      Get.toNamed(AppRoutes.launch);
    }
  },
  child: YourMainWidget(),
)
```

---

## ✅ 验证清单

完成集成后，请验证以下功能：

### 服务端
- [ ] Launcher SubServer 成功启动（查看日志）
- [ ] `/api/launcher/feed` 端点返回正确数据
- [ ] `/api/launcher/search` 端点返回正确数据
- [ ] 日志使用正确的 logger 包

### 客户端
- [ ] Launch Screen 可以正常打开
- [ ] 搜索框可以输入和搜索
- [ ] 快捷操作网格正常显示
- [ ] 信息流正常显示
- [ ] 键盘导航正常工作（上下箭头、Enter）
- [ ] 可以通过 ESC 关闭

---

## 🔍 故障排查

### 问题 1: SubServer 未启动

**症状**: 日志中没有 launcher 相关信息

**解决方案**:
1. 检查 `config.yaml` 中 `enabled: true`
2. 确认 `main.go` 中已添加导入和注册
3. 重新编译：`go build app/main.go`

### 问题 2: API 返回 404

**症状**: 访问 `/api/launcher/feed` 返回 404

**解决方案**:
1. 确认 SubServer 已成功启动
2. 检查路由注册是否正确
3. 查看服务器日志是否有错误

### 问题 3: 客户端无法连接

**症状**: Flutter 应用显示网络错误

**解决方案**:
1. 确认服务端正在运行
2. 检查 `apiBaseUrl` 配置是否正确
3. 检查防火墙设置
4. 使用 curl 测试 API 是否可访问

### 问题 4: 搜索无结果

**症状**: 搜索框输入后没有结果

**解决方案**:
1. 打开浏览器开发者工具查看网络请求
2. 检查 API 响应是否正确
3. 查看客户端日志是否有解析错误

---

## 🚀 下一步优化

### 短期（1-2 周）
- [ ] 替换 Mock 数据为真实数据源
- [ ] 添加用户偏好存储
- [ ] 实现搜索历史记录
- [ ] 添加更多快捷操作

### 中期（1 个月）
- [ ] 集成机器学习推荐算法
- [ ] 添加缓存策略（Redis）
- [ ] 实现分页加载
- [ ] 添加性能监控

### 长期（3 个月）
- [ ] 支持多语言搜索
- [ ] 添加语音搜索
- [ ] 实现高级搜索过滤器
- [ ] 添加搜索热词统计

---

## 📚 相关文档

- [Launcher SubServer README](station/app/subserver/launcher/README.md)
- [Launcher SubServer 集成指南](station/app/subserver/launcher/INTEGRATION.md)
- [SubServer 开发标准](.prompts/30-STATION/34-subserver-standard.md)
- [库使用规范](.prompts/30-STATION/35-lib-usage.md)

---

## 📞 获取帮助

如果遇到问题：
1. 查看本文档的故障排查章节
2. 查看服务端和客户端日志
3. 参考相关文档
4. 提交 Issue 并附上详细的错误信息和日志

---

**集成完成后，Launch Screen 功能即可投入使用！** 🎉
