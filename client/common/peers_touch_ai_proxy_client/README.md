# Peers Touch AI Proxy Client

统一的多 AI 提供商代理客户端，支持 OpenAI、Ollama 等协议。

## 功能特性

- ✅ OpenAI 协议兼容客户端
- ✅ Ollama 协议兼容客户端  
- ✅ 统一的 Provider 抽象层
- ✅ 配置管理和热切换
- ✅ 错误处理和重试机制

## 支持的提供商

### OpenAI 协议
- OpenAI API
- 任何兼容 OpenAI API 的服务

### Ollama 协议  
- Ollama 本地模型
- 兼容 OpenAI 格式的本地服务

## 快速开始

```dart
import 'package:peers_touch_ai_proxy_client/peers_touch_ai_proxy_client.dart';

// 创建 OpenAI 客户端
final openaiClient = OpenAIClient(
  baseUrl: 'https://api.openai.com',
  apiKey: 'your-api-key',
);

// 创建 Ollama 客户端
final ollamaClient = OllamaClient(
  baseUrl: 'http://localhost:11434',
);

// 使用统一的 Provider 管理器
final providerManager = AIProviderManager();
providerManager.registerProvider('openai', openaiClient);
providerManager.registerProvider('ollama', ollamaClient);
```