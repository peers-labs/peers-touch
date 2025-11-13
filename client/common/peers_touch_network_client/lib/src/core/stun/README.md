# STUN/TUN穿透功能

本模块提供了完整的STUN/TUN穿透功能实现，支持P2P网络中的NAT穿透和直接连接建立。

## 功能特性

- **STUN客户端**: 支持标准STUN协议，获取公网地址
- **NAT类型发现**: 自动检测NAT类型和特性
- **打洞协调**: 智能协调P2P打洞过程
- **TUN管理**: 管理虚拟网络接口
- **多STUN服务器**: 支持多个STUN服务器冗余
- **错误处理**: 完善的异常处理机制
- **配置灵活**: 可配置的超时、重试等参数

## 架构设计

```
peers_touch_network_client/lib/src/core/stun/
├── stun_config.dart          # 配置类
├── stun_types.dart           # 类型定义
├── stun_client.dart          # STUN客户端核心
├── tun_manager.dart          # TUN管理器
├── hole_punching.dart        # 打洞逻辑
├── stun_manager.dart         # 统一管理器
├── stun_exceptions.dart      # 异常定义
└── examples/                 # 使用示例
    └── stun_usage_example.dart
```

## 快速开始

### 基本使用

```dart
import 'package:peers_touch_network_client/peers_touch_client.dart';

void main() async {
  // 创建配置
  final config = StunConfig(
    stunServers: ['stun.l.google.com', 'stun1.l.google.com'],
    holePunchTimeout: 5000,
    keepAliveInterval: 30000,
  );
  
  // 创建STUN管理器
  final stunManager = StunManager(config: config);
  
  // 初始化
  await stunManager.initialize();
  
  // 获取公网地址
  final response = await stunManager.getPublicAddress();
  if (response.success) {
    print('公网地址: ${response.publicAddress}:${response.publicPort}');
  }
  
  // 发现NAT类型
  final natResult = await stunManager.discoverNatType();
  print('NAT类型: ${natResult.natType}');
  
  // 关闭
  await stunManager.shutdown();
}
```

### P2P连接

```dart
// 创建对等节点信息
final peer = PeerInfo(
  id: 'peer-123',
  address: '192.168.1.100',
  port: 8080,
  publicKey: 'peer-public-key',
  capabilities: ['p2p', 'file-sharing'],
);

// 建立P2P连接
final connection = await stunManager.establishP2PConnection(peer);

// 监听数据
connection.packets.listen((data) {
  print('收到数据: ${String.fromCharCodes(data)}');
});

// 发送数据
await connection.send(Uint8List.fromList('Hello P2P!'.codeUnits));

// 关闭连接
await connection.close();
```

## 配置选项

### StunConfig

| 参数 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| stunServers | List<String> | Google STUN服务器列表 | STUN服务器地址 |
| stunPort | int | 3478 | STUN服务器端口 |
| holePunchTimeout | int | 5000 | 打洞超时时间(毫秒) |
| keepAliveInterval | int | 30000 | 保持活跃间隔(毫秒) |
| maxRetryAttempts | int | 3 | 最大重试次数 |
| enableTunMode | bool | false | 是否启用TUN模式 |

## NAT类型支持

支持以下NAT类型的检测和处理：

- **Open Internet**: 公网IP，无NAT
- **Full Cone NAT**: 完全锥形NAT
- **Restricted Cone NAT**: 受限锥形NAT  
- **Port Restricted Cone NAT**: 端口受限锥形NAT
- **Symmetric NAT**: 对称NAT

## 错误处理

使用专门的异常类处理不同类型的错误：

```dart
try {
  await stunManager.establishP2PConnection(peer);
} on StunTimeoutException catch (e) {
  print('连接超时: ${e.operation}');
} on HolePunchingException catch (e) {
  print('打洞失败: ${e.peerId}, 尝试次数: ${e.attemptCount}');
} on P2PConnectionException catch (e) {
  print('P2P连接失败: ${e.peerId}');
} on StunException catch (e) {
  print('STUN错误: ${e.message}');
}
```

## 高级功能

### 多STUN服务器

```dart
final config = StunConfig(
  stunServers: [
    'stun.l.google.com',
    'stun1.l.google.com',
    'stun.services.mozilla.com',
    'stunserver.stunprotocol.org',
  ],
  maxRetryAttempts: 5,
);
```

### 自定义超时

```dart
final config = StunConfig(
  holePunchTimeout: 10000,  // 10秒
  keepAliveInterval: 15000,  // 15秒
);
```

### NAT友好度评分

```dart
final natDiscovery = stunManager.natDiscovery;
final friendliness = natDiscovery.getNatFriendliness(natType);
print('NAT友好度: $friendliness/100');
```

## 性能优化

1. **连接池**: 复用已建立的P2P连接
2. **保持活跃**: 定期发送保持活跃数据包
3. **超时控制**: 合理的超时设置避免阻塞
4. **错误重试**: 智能重试机制提高成功率
5. **多服务器**: 多个STUN服务器提供冗余

## 安全考虑

1. **数据加密**: 建议在应用层对数据进行加密
2. **身份验证**: 使用公钥进行节点身份验证
3. **访问控制**: 限制哪些节点可以建立连接
4. **速率限制**: 防止恶意节点频繁请求

## 调试和监控

```dart
// 获取连接状态
final status = stunManager.getConnectionStatus();
print('连接状态: $status');

// 获取活跃连接
final connections = stunManager.tunManager.activeConnections;
print('活跃连接数: ${connections.length}');
```

## 平台支持

- ✅ Linux
- ✅ macOS  
- ✅ Windows
- ✅ Android
- ✅ iOS
- ⚠️ Web (受浏览器限制)

## 依赖要求

- Dart SDK >= 3.0.0
- 网络访问权限
- UDP端口访问权限

## 使用限制

1. **防火墙**: 某些严格防火墙可能阻止UDP通信
2. **对称NAT**: 需要更复杂的协调策略
3. **企业网络**: 可能需要特殊配置
4. **移动网络**: 运营商可能限制P2P连接

## 故障排除

### 常见问题

1. **无法获取公网地址**
   - 检查STUN服务器是否可用
   - 验证网络连接
   - 检查防火墙设置

2. **打洞失败**
   - 确认NAT类型
   - 检查目标节点地址
   - 增加重试次数和超时时间

3. **连接不稳定**
   - 调整保持活跃间隔
   - 检查网络质量
   - 使用多个STUN服务器

### 调试模式

```dart
// 启用详细日志
final config = StunConfig(
  // ... 其他配置
);

// 监听详细日志
void enableDebugLogging() {
  // 在代码中添加日志输出
}
```