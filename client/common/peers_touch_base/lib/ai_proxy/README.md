# AI Proxy 模块

AI Proxy 模块是 Peers Touch 项目中的 AI 服务代理层，负责统一管理和调用各种 AI 服务提供商（如 OpenAI、Anthropic、Google 等），为上层应用提供标准化的 AI 聊天接口。

## 架构概述

### 核心组件

1. **服务层 (Service Layer)**
   - `AiBoxClientModeService`: 主要的 AI 聊天服务，负责处理聊天请求并返回流式响应
   - 提供统一的 `chat()` 方法，接收 `ChatCompletionRequest` 并返回 `Stream<ChatCompletionResponse>`

2. **客户端层 (Client Layer)**
   - `OpenAiChatClient`: OpenAI 服务客户端，处理 OpenAI 特定的请求格式和响应
   - 支持流式响应，模拟真实的 OpenAI API 行为
   - 其他 AI 提供商的客户端可以轻松扩展

3. **模型层 (Model Layer)**
   - 使用 Protocol Buffers 定义的标准化数据模型
   - `ChatCompletionRequest`: 聊天请求模型，包含消息、模型参数等
   - `ChatCompletionResponse`: 聊天响应模型，支持流式响应
   - `ChatMessage`: 消息模型，包含角色、内容等字段
   - `ChatChoice`: 响应选择模型，包含消息和完成原因

### 数据流

```
应用层
    ↓
AiBoxService.chat()
    ↓
适配器选择提供商
    ↓
OpenAiChatClient.chat()
    ↓
转换为提供商特定格式
    ↓
模拟/真实 API 调用
    ↓
转换回标准格式
    ↓
Stream<ChatCompletionResponse>
```

## 主要特性

- **统一接口**: 所有 AI 提供商都通过相同的接口暴露
- **流式响应**: 支持 Server-Sent Events 风格的流式响应
- **类型安全**: 使用 Protocol Buffers 确保数据类型安全
- **易于扩展**: 可以轻松添加新的 AI 提供商支持
- **错误处理**: 统一的错误处理和响应机制

## 使用示例

```dart
// 创建服务
final aiService = AiBoxClientModeService();

// 构建请求
final request = ChatCompletionRequest(
  model: 'gpt-3.5-turbo',
  messages: [
    ChatMessage(
      role: ChatRole.CHAT_ROLE_USER,
      content: '你好，请介绍一下你自己',
    ),
  ],
  temperature: 0.7,
  maxTokens: 100,
);

// 发送请求并接收流式响应
final stream = aiService.chat(request);

// 处理响应
await for (final response in stream) {
  if (response.choices.isNotEmpty) {
    final choice = response.choices.first;
    if (choice.hasMessage()) {
      print('AI 回复: ${choice.message.content}');
    }
  }
}
```

## 扩展支持

要添加新的 AI 提供商支持：

1. 在 `client` 目录下创建新的客户端类（如 `AnthropicChatClient`）
2. 实现 `chat()` 方法，遵循相同的接口签名
3. 在适配器中添加提供商选择逻辑
4. 更新相关文档和测试

## 错误处理

系统提供统一的错误处理机制：

- 网络错误会通过流式响应返回
- 提供商特定的错误会被捕获并转换为标准格式
- 可以通过检查 `response.choices.first.finishReason == 'error'` 来识别错误响应