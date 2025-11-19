# OpenAI Chat Client

OpenAI聊天客户端实现，支持OpenAI API调用和流式响应处理。

## 功能特性

- ✅ 支持OpenAI API调用
- ✅ ChatCompletionRequest与OpenAI格式转换
- ✅ 流式响应处理
- ✅ 错误处理机制
- ✅ 客户端工厂类
- ✅ 完整的类型安全

## 快速开始

### 1. 基本使用

```dart
import 'package:peers_touch_base/ai_proxy/client/openai/openai.dart';

// 创建OpenAI客户端
final client = OpenAiChatClient(
  apiKey: 'your-openai-api-key',
  baseUrl: 'https://api.openai.com/v1', // 可选，默认为官方API
);

// 创建聊天请求
final request = ChatCompletionRequest()
  ..model = 'gpt-3.5-turbo'
  ..messages.add(ChatCompletionMessage()
    ..role = ChatRole.CHAT_ROLE_USER
    ..content = '你好，请介绍一下你自己');

// 发送消息并处理流式响应
final stream = client.chat(request);

await for (final response in stream) {
  print('收到响应: ${response.choices[0].message.content}');
  
  // 处理错误
  if (response.choices[0].finishReason == 'error') {
    print('发生错误');
  }
}

// 关闭客户端
client.close();
```

### 2. 使用工厂类

```dart
import 'package:peers_touch_base/ai_proxy/client/openai/openai.dart';

// 使用工厂类创建客户端
final client = OpenAiClientFactory.createChatClient(
  apiKey: 'your-openai-api-key',
);

// 或者使用自定义配置
final customClient = OpenAiClientFactory.createChatClientWithConfig(
  apiKey: 'your-openai-api-key',
  baseUrl: 'https://custom.openai.com/v1',
  timeout: 60,
  maxRetries: 3,
);
```

### 3. 支持的消息类型

OpenAiChatClient支持以下消息角色：

- `CHAT_ROLE_SYSTEM` → `system`
- `CHAT_ROLE_USER` → `user` 
- `CHAT_ROLE_ASSISTANT` → `assistant`
- `CHAT_ROLE_TOOL` → `tool`

## API 参考

### OpenAiChatClient

#### 构造函数

```dart
OpenAiChatClient({
  required String apiKey,
  String baseUrl = 'https://api.openai.com/v1',
  IHttpService? httpService,
})
```

#### 方法

- `Stream<ChatCompletionResponse> chat(ChatCompletionRequest request)` - 发送聊天消息
- `Stream<ChatSession> getSessions()` - 获取会话列表（预留扩展）
- `void close()` - 关闭HTTP服务（预留方法）

### OpenAiClientFactory

- `static OpenAiChatClient createChatClient({...})` - 创建基础客户端
- `static OpenAiChatClient createChatClientWithConfig({...})` - 创建自定义配置客户端

## 错误处理

客户端会自动处理以下错误：

- HTTP请求错误（非200状态码）
- JSON解析错误
- 网络连接错误

错误信息会通过`finishReason`字段返回：

```dart
if (response.choices[0].finishReason == 'error') {
  print('错误详情: ${response.choices[0].message.content}');
}
```

## 扩展功能

### 多模态支持

当前版本支持基础文本消息，后续版本将支持：

- 图片消息处理
- 文件附件支持
- 工具调用集成
- 插件系统扩展

### 自定义配置

可以通过自定义HTTP客户端实现：

- 请求重试机制
- 超时配置
- 代理设置
- 认证扩展

## 依赖要求

- Dart 2.12+ (支持空安全)
- 项目内部Dio网络库 (用于HTTP请求)
- fixnum包 (用于时间戳处理)
- protobuf包 (用于消息序列化)

## 测试

运行测试：

```bash
cd common/peers_touch_base
dart test lib/ai_proxy/client/openai/openai_chat_client_test.dart
```

## 许可证

MIT License