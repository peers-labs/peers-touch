import 'package:peers_touch_base/model/domain/ai_box/ai_models.pb.dart';
import 'package:peers_touch_base/model/domain/ai_box/chat.pb.dart';
import 'package:peers_touch_base/model/domain/ai_box/provider.pb.dart';

/// AI 提供商错误类型
enum AIProviderErrorType {
  connection,
  authentication,
  rateLimit,
  quotaExceeded,
  invalidRequest,
  serverError,
  timeout,
  unknown,
}

/// AI 提供商异常
class AIProviderException implements Exception {
  final AIProviderErrorType type;
  final String message;
  final int? statusCode;

  const AIProviderException({
    required this.type,
    required this.message,
    this.statusCode,
  });

  @override
  String toString() => 'AIProviderException(type: $type, message: $message, statusCode: $statusCode)';
}

/// AI 提供商接口
abstract class AIProvider {
  /// 获取提供商配置
  Provider get provider;

 
  Future<bool> checkConnection();

  /// 获取可用模型列表
  Future<List<AiModelInfo>> listModels();

  /// 聊天补全
  Future<ChatCompletionResponse> chatCompletion(ChatCompletionRequest request);

  /// 流式聊天补全
  Stream<ChatCompletionResponse> chatCompletionStream(ChatCompletionRequest request);

  /// 更新配置
  void updateConfig(Provider updateProvider);

  /// 关闭连接
  Future<void> close();
}

/// AI 提供商工厂接口
abstract class AIProviderFactory {
  /// 创建提供商
  AIProvider createProvider(Provider config);
}