import 'dart:async';

/// AI服务抽象接口
abstract class AIService {
  /// 检查服务是否已配置
  bool get isConfigured;
  
  /// 发送聊天消息（流式响应）
  Stream<String> sendMessageStream({
    required String message,
    String? model,
    double? temperature,
  });
  
  /// 发送聊天消息（非流式响应）
  Future<String> sendMessage({
    required String message,
    String? model,
    double? temperature,
  });
  
  /// 测试服务连接
  Future<bool> testConnection();
}

/// AI服务提供商类型
enum AIProviderType {
  openai,
  // 后续可以添加其他提供商
  // anthropic,
  // google,
  // azure,
}

/// AI服务工厂
class AIServiceFactory {
  /// 根据提供商类型创建对应的服务实例
  static AIService createService(AIProviderType providerType) {
    switch (providerType) {
      case AIProviderType.openai:
        return _createOpenAIService();
      // 后续可以添加其他提供商
      // case AIProviderType.anthropic:
      //   return AnthropicService();
      default:
        throw ArgumentError('不支持的AI提供商类型: $providerType');
    }
  }
  
  /// 获取默认的AI服务（当前为OpenAI）
  static AIService get defaultService => createService(AIProviderType.openai);
  
  /// 创建OpenAI服务实例（延迟导入以避免循环依赖）
  static AIService _createOpenAIService() {
    // 使用延迟导入来避免循环依赖
    return OpenAIService();
  }
}

// 需要在文件末尾导入OpenAIService以避免循环依赖
import 'openai_service.dart';