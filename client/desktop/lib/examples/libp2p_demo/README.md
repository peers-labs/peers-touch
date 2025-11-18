# Dart libp2p Relay Demo

这是一个 Dart 演示程序，用于连接和测试 Go 实现的 libp2p relay 服务器。这个演示展示了如何在 Dart 中使用 libp2p 进行点对点通信。

## 功能特性

- 🔗 创建和配置 libp2p 节点
- 🌐 连接到 Go relay 服务器
- 💬 发送和接收消息
- 🔄 自动重连和错误处理
- 📊 连接状态监控
- 🖥️ 交互式 CLI 界面

## 安装依赖

```bash
cd E:\Projects\peers-touch\peers-touch\client\desktop\lib\examples\libp2p_demo
flutter pub get
```

## 使用方法

### 1. 基本使用

```dart
import 'libp2p_relay_demo.dart';

void main() async {
  final demo = Libp2pRelayDemo();
  
  // 初始化节点
  await demo.initialize();
  
  // 连接到 relay 服务器
  final relayAddr = '/ip4/127.0.0.1/tcp/4001/p2p/12D3KooWLQzUh...';
  await demo.connectToRelay(relayAddr);
  
  // 发送消息
  final peerId = PeerId.fromString('目标节点ID');
  await demo.sendMessageToPeer(peerId, 'Hello from Dart!');
  
  // 监听消息
  demo.receivedMessages.listen((message) {
    print('收到消息: $message');
  });
}
```

### 2. 交互式 CLI

运行交互式命令行界面：

```bash
dart run libp2p_relay_cli.dart
```

可用命令：
- `connect <multiaddr>` - 连接到 relay 服务器
- `send <peer_id> <message>` - 发送消息给指定节点
- `peers` - 列出已连接的节点
- `info` - 显示本地节点信息
- `help` - 显示帮助信息
- `exit` - 退出程序

### 3. 命令行模式

```bash
# 连接到 relay 服务器
dart run libp2p_relay_cli.dart connect /ip4/127.0.0.1/tcp/4001/p2p/12D3KooWLQzUh...

# 显示节点信息
dart run libp2p_relay_cli.dart info

# 测试连接并发送消息
dart run libp2p_relay_cli.dart test /ip4/127.0.0.1/tcp/4001/p2p/12D3KooWLQzUh...
```

## 协议说明

### 消息格式

消息采用 JSON 格式，包含以下字段：

```json
{
  "type": "message_type",
  "message": "content",
  "timestamp": "2024-01-01T12:00:00.000Z",
  "peer_id": "QmPeerId...",
  "client": "dart_demo",
  "version": "1.0.0"
}
```

### 支持的消息类型

- `connection_test` - 连接测试
- `message` - 普通消息
- `ping` - 心跳检测
- `echo` - 回声测试
- `error` - 错误响应

### 传输协议

使用 `/peers-touch/transport/1.0.0` 协议进行通信，消息格式为：

```
[4 bytes: message length][message data]
```

## 与 Go Relay 服务器集成

### Go Relay 服务器配置

确保 Go relay 服务器使用以下配置：

```go
// 启用 relay 支持
libp2pOpts = append(libp2pOpts, libp2p.EnableAutoRelay(
    autorelay.WithStaticRelays(nil),
))

// 设置协议 ID
protocolID := protocol.ID("/peers-touch/transport/1.0.0")
```

### 连接示例

1. 启动 Go relay 服务器：
```bash
go run main.go
```

2. 获取 relay 服务器的 multiaddr：
```
Relay server listening on:
- /ip4/127.0.0.1/tcp/4001/p2p/12D3KooWLQzUh...
- /ip6/::1/tcp/4001/p2p/12D3KooWLQzUh...
```

3. 使用 Dart 客户端连接：
```bash
dart run libp2p_relay_cli.dart connect /ip4/127.0.0.1/tcp/4001/p2p/12D3KooWLQzUh...
```

## 错误处理

演示程序包含完整的错误处理机制：

- 🔁 自动重连（最多3次）
- ⏱️ 连接超时处理
- 📏 消息大小限制（1MB）
- 🛡️ 异常捕获和恢复
- 📝 详细的错误日志

## 调试和故障排除

### 常见问题

1. **连接失败**
   - 检查 relay 服务器地址是否正确
   - 确保网络连接正常
   - 检查防火墙设置

2. **消息发送失败**
   - 验证目标节点 ID 是否正确
   - 检查连接状态
   - 查看错误日志

3. **协议不匹配**
   - 确保 Dart 和 Go 使用相同的协议 ID
   - 检查消息格式是否一致

### 调试模式

启用详细日志输出：

```dart
// 在初始化前设置日志级别
Logger.level = LogLevel.debug;
```

## 扩展功能

你可以基于这个演示扩展以下功能：

- 📁 文件传输支持
- 🔐 加密消息传输
- 🌐 WebRTC 数据通道
- 📊 网络拓扑发现
- 🔄 自动节点发现
- 📈 性能监控

## 依赖说明

- `libp2p` - libp2p 核心库
- `multiaddr` - 多地址格式支持
- `peerid` - Peer ID 处理
- `protobuf` - 协议缓冲区支持

## 许可证

MIT License