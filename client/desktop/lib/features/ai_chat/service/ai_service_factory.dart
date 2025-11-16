import 'ai_service.dart';
import 'openai_service.dart';
import 'ollama_service.dart';

/// AI服务提供商类型
enum AIProviderType {
  openai,
  ollama,
  // 未来可扩展更多提供商
}

/// AI服务工厂
class AIServiceFactory {
  /// 根据提供商类型创建对应的服务实例
  static AIService createService(AIProviderType providerType) {
    switch (providerType) {
      case AIProviderType.openai:
        return OpenAIService();
      case AIProviderType.ollama:
        return OllamaService();
    }
  }

  /// 根据字符串名称创建服务
  static AIService fromName(String name) {
    switch (name.toLowerCase()) {
      case 'ollama':
        return createService(AIProviderType.ollama);
      case 'openai':
      default:
        return createService(AIProviderType.openai);
    }
  }

  /// 获取默认的AI服务（优先读取当前选择的提供商）
  static AIService get defaultService => fromName('OpenAI');
}