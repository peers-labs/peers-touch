# Peers-touch Dart 客户端库 MVP 方案

## 项目概述

本项目旨在开发一个 Dart 客户端库，用于连接到 Peers-touch 网络并作为节点加入。该库将提供与现有 Go 实现的 Peers-touch 网络进行通信的能力，支持节点发现、连接建立和基本的 ActivityPub 协议交互。

## 1. 架构设计

### 1.1 核心模块

#### 网络连接层 (Network Layer)
- **PeerDiscovery**：负责发现网络中的其他节点
- **ConnectionManager**：管理节点间的连接和会话
- **TransportAdapter**：支持多种传输协议（HTTP/WebSocket/STUN/TURN）

#### 协议层 (Protocol Layer)  
- **ActivityPubClient**：实现 ActivityPub 协议的核心功能
- **MessageHandler**：处理节点间的消息通信
- **StreamManager**：管理实时数据流

#### 存储层 (Storage Layer)
- **LocalStorage**：本地数据持久化
- **CacheManager**：缓存网络发现结果和会话信息

#### 配置层 (Configuration Layer)
- **ConfigManager**：管理节点配置
- **SecurityManager**：处理认证和加密

### 1.2 技术栈

#### 核心依赖
- **Dart SDK**：≥ 3.0.0
- **http**：HTTP 客户端库
- **web_socket_channel**：WebSocket 支持
- **crypto**：加密和哈希计算
- **shared_preferences**：本地存储

#### 序列化
- **json_annotation**：JSON 序列化/反序列化
- **dart:convert**：基础编解码

## 2. MVP 功能规划

### 第一阶段：基础连接能力（第1-2周）
1. **节点发现**：通过注册表服务发现网络中的其他节点
2. **连接建立**：支持与目标节点建立基础连接
3. **心跳检测**：维持节点在线状态

### 第二阶段：协议支持（第3-4周）
1. **ActivityPub 基础**：支持 Follow/Unfollow/Like 等基础操作
2. **消息传递**：节点间的简单消息通信
3. **数据同步**：基础的数据同步机制

### 第三阶段：高级功能（第5-6周）
1. **流媒体支持**：实时音视频流传输
2. **群组功能**：多节点协作
3. **插件系统**：可扩展的功能模块

## 3. API 设计草案

### 3.1 核心类结构

```dart
class PeersTouchClient {
  final PeersTouchConfig config;
  final PeerDiscovery discovery;
  final ConnectionManager connection;
  final ActivityPubClient activityPub;
  
  Future<void> connect();
  Future<void> disconnect();
  Future<List<PeerInfo>> discoverPeers();
}
```

### 3.2 节点管理

```dart
class PeerManager {
  Future<PeerSession> connectToPeer(String peerAddress);
  Future<void> sendMessage(PeerSession session, String message);
  Stream<PeerEvent> get peerEvents;
}
```

### 3.3 ActivityPub 接口

```dart
class ActivityPubClient {
  Future<void> follow(String targetActor);
  Future<void> unfollow(String targetActor);
  Future<void> like(String activityId);
  Future<List<Activity>> getOutboxActivities();
}
```

## 4. 数据模型

### 4.1 节点信息

```dart
class PeerInfo {
  final String peerId;
  final List<String> addresses;
  final Map<String, dynamic> metadata;
  final DateTime lastSeen;
}
```

### 4.2 会话信息

```dart
class PeerSession {
  final String sessionId;
  final String peerId;
  final String remoteAddress;
  final SessionStatus status;
  final DateTime createdAt;
  final DateTime lastActive;
}
```

### 4.3 ActivityPub 活动

```dart
class Activity {
  final String id;
  final String type;
  final Actor actor;
  final dynamic object;
  final DateTime published;
}
```

## 5. 实现路线图

### 第1周：基础设施搭建
- [ ] 项目结构初始化
- [ ] 基础配置管理实现
- [ ] HTTP 客户端封装
- [ ] 基础数据模型定义

### 第2周：节点发现机制
- [ ] 注册表服务集成
- [ ] 节点发现算法实现
- [ ] 连接池基础框架
- [ ] 单元测试框架搭建

### 第3周：连接管理  
- [ ] 会话管理实现
- [ ] 连接状态机
- [ ] 错误处理和重试机制
- [ ] 连接稳定性测试

### 第4周：协议支持
- [ ] ActivityPub 消息格式解析
- [ ] 基础操作实现（Follow/Unfollow）
- [ ] 消息序列化/反序列化
- [ ] 协议兼容性测试

### 第5周：高级功能
- [ ] 流媒体传输支持
- [ ] 实时消息传递
- [ ] 性能优化
- [ ] 集成测试

### 第6周：完善和发布
- [ ] 文档编写
- [ ] 示例代码
- [ ] 性能基准测试
- [ ] 发布到 pub.dev

## 6. 关键挑战和解决方案

### 6.1 协议兼容性
- **挑战**：确保与 Go 实现的协议兼容
- **方案**：基于现有 Go 代码的模型定义，保持字段和格式一致

### 6.2 网络稳定性
- **挑战**：P2P 网络连接的不稳定性
- **方案**：实现自动重连和连接池管理

### 6.3 性能优化
- **挑战**：移动设备资源限制
- **方案**：轻量级实现，异步操作，内存优化

### 6.4 安全性
- **挑战**：P2P 网络的安全风险
- **方案**：实现端到端加密和认证机制

## 7. 测试策略

### 7.1 单元测试
- 核心逻辑模块测试
- 模型序列化测试
- 错误处理测试

### 7.2 集成测试  
- 与测试网络节点交互
- 端到端功能验证
- 协议兼容性测试

### 7.3 性能测试
- 连接建立时间
- 内存使用情况
- 网络带宽消耗
- 并发连接数测试

## 8. 部署和发布

### 8.1 包管理
- 发布到 pub.dev
- 版本管理策略（语义化版本）
- 依赖关系管理

### 8.2 平台支持
- **Flutter 移动端**：完整支持
- **Dart 服务端**：完整支持  
- **Web 平台**：有限支持（受浏览器限制）

### 8.3 文档和示例
- API 文档自动生成
- 使用示例和教程
- 故障排除指南

## 9. 成功指标

### 9.1 功能指标
- [ ] 能够成功发现网络中的其他节点
- [ ] 建立稳定的 P2P 连接
- [ ] 实现基本的 ActivityPub 协议操作
- [ ] 支持实时消息传递

### 9.2 性能指标
- [ ] 连接建立时间 < 3秒
- [ ] 内存占用 < 50MB
- [ ] 消息延迟 < 500ms
- [ ] 支持并发连接数 ≥ 10

### 9.3 质量指标
- [ ] 测试覆盖率 ≥ 80%
- [ ] 代码审查通过率 100%
- [ ] 文档完整性 100%

## 10. 风险评估和缓解措施

### 10.1 技术风险
- **风险**：协议复杂性导致开发延期
- **缓解**：分阶段实现，优先核心功能

### 10.2 兼容性风险
- **风险**：与现有网络不兼容
- **缓解**：早期集成测试，持续验证

### 10.3 性能风险
- **风险**：移动设备性能不足
- **缓解**：性能优化，资源管理

## 11. 后续发展计划

### 11.1 短期目标（3个月内）
- 完善基础功能
- 优化性能
- 扩大测试覆盖

### 11.2 中期目标（6个月内）
- 支持更多传输协议
- 实现高级功能
- 社区生态建设

### 11.3 长期目标（1年内）
- 成为 Dart 生态中领先的 P2P 库
- 支持大规模部署
- 建立完善的开发者社区

---

*最后更新：2024年12月*  
*版本：v1.0.0*