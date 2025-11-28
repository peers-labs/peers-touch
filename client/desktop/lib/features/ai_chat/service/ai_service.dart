import 'dart:async';

/// 抽象的取消句柄，避免在上层直接依赖 Dio。
abstract class CancelHandle {
  void cancel([String? reason]);
}

/// AI服务抽象接口
abstract class AIService {
  /// 检查服务是否已配置
  bool get isConfigured;

  /// 拉取可用模型列表
  Future<List<String>> fetchModels();

  /// 发送聊天消息（流式响应）
  /// 支持可选的富内容：
  /// - 对 OpenAI：传入 `openAIContent` 将作为 `messages[].content` 数组使用
  /// - 对 Ollama：传入 `imagesBase64` 将作为 `/api/generate` 的 `images` 字段使用
  /// 创建与当前服务实现匹配的取消句柄
  CancelHandle createCancelHandle();

  Stream<String> sendMessageStream({
    required String message,
    String? model,
    double? temperature,
    List<Map<String, dynamic>>? openAIContent,
    List<String>? imagesBase64,
    CancelHandle? cancel,
  });

  /// 发送聊天消息（非流式响应）
  /// 支持可选的富内容参数，含义与上面的流式方法一致。
  Future<String> sendMessage({
    required String message,
    String? model,
    double? temperature,
    List<Map<String, dynamic>>? openAIContent,
    List<String>? imagesBase64,
    CancelHandle? cancel,
  });

  /// 测试服务连接
  Future<bool> testConnection();
}
