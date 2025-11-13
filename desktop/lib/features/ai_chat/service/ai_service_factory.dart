import 'ai_service.dart';
import 'openai_service.dart';
import 'ollama_service.dart';
import 'package:peers_touch_desktop/features/ai_chat/model/provider.dart';

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

  /// 根据 Provider 实例创建对应服务（使用实例级配置覆盖）
  static AIService fromProvider(Provider provider) {
    switch (provider.sourceType.toLowerCase()) {
      case 'ollama':
        return OllamaService(baseUrlOverride: provider.baseUrl);
      case 'openai':
        return OpenAIService(
            apiKeyOverride: provider.apiKey,
            baseUrlOverride: provider.baseUrl,
            defaultModel: provider.models.isNotEmpty ? provider.models.first : 'gpt-3.5-turbo',
            endpoint: '/v1/chat/completions',
          );
      case 'bytedance-kimi2':
        return OpenAIService(
            apiKeyOverride: provider.apiKey,
            baseUrlOverride: provider.baseUrl,
            defaultModel: provider.models.isNotEmpty ? provider.models.first : 'ep-20251014145207-5xzgh',
            endpoint: '/chat/completions', // ByteDance-Kimi2的端点不包含/v1
          );
      default:
        return OpenAIService(
            apiKeyOverride: provider.apiKey,
            baseUrlOverride: provider.baseUrl,
            defaultModel: provider.models.isNotEmpty ? provider.models.first : 'ep-20251014145207-5xzgh',
            endpoint: '/v1/chat/completions',
          );
    }
  }

  /// 获取默认的AI服务（优先读取当前选择的提供商）
  static AIService get defaultService => fromName('OpenAI');
}