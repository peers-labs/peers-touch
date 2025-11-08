import 'dart:async';

/// AI服务抽象接口
abstract class AIService {
  /// 检查服务是否已配置
  bool get isConfigured;

  /// 拉取可用模型列表
  Future<List<String>> fetchModels();

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