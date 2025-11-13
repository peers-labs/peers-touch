/// Peers Touch AI Proxy Client
/// 
/// 统一的多 AI 提供商代理客户端，支持 OpenAI、Ollama 等协议。

library peers_touch_ai_proxy_client;

// Core interfaces and models
export 'src/interfaces/ai_provider_interface.dart';
export 'src/models/chat_models.dart';
export 'src/models/provider_config.dart';

// Provider implementations
export 'src/providers/openai_client.dart';
export 'src/providers/ollama_client.dart';

// Manager and utilities
export 'src/managers/ai_provider_manager.dart';
export 'src/utils/config_loader.dart';