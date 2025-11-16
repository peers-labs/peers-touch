import 'dart:async';

/// AI服务接口 - 简化版，供聊天代理使用
abstract class AIService {
  /// 发送消息（非流式）
  Future<String> sendMessage({
    required String message,
    String? model,
    double? temperature,
  });

  /// 发送消息（流式）
  Stream<String> sendMessageStream({
    required String message,
    String? model,
    double? temperature,
  });
}