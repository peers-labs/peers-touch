import 'package:peers_touch_base/network/dio/http_service.dart';
import 'package:peers_touch_base/network/dio/http_service_impl.dart';

import 'openai_chat_client.dart';

/// OpenAI客户端工厂类
/// 提供便捷的方法创建OpenAiChatClient实例
class OpenAiClientFactory {
  /// 创建OpenAI聊天客户端
  /// 
  /// [apiKey]: OpenAI API密钥
  /// [baseUrl]: OpenAI API基础URL，默认为官方API地址
  static OpenAiChatClient createChatClient({
    required String apiKey,
    String baseUrl = 'https://api.openai.com/v1',
  }) {
    return OpenAiChatClient(
      apiKey: apiKey,
      baseUrl: baseUrl,
    );
  }

  /// 创建支持自定义配置的OpenAI聊天客户端
  /// 
  /// [apiKey]: OpenAI API密钥
  /// [baseUrl]: OpenAI API基础URL
  /// [timeout]: 请求超时时间（秒）
  /// [maxRetries]: 最大重试次数
  static OpenAiChatClient createChatClientWithConfig({
    required String apiKey,
    String baseUrl = 'https://api.openai.com/v1',
    int timeout = 30,
    int maxRetries = 3,
  }) {
    // 创建自定义HTTP服务
    final httpService = _createHttpService(
      baseUrl: baseUrl,
      timeout: timeout,
      maxRetries: maxRetries,
    );
    
    return OpenAiChatClient(
      apiKey: apiKey,
      baseUrl: baseUrl,
      httpService: httpService,
    );
  }

  /// 创建HTTP服务
  static IHttpService _createHttpService({
    required String baseUrl,
    int timeout = 30,
    int maxRetries = 3,
  }) {
    return HttpServiceImpl(
      baseUrl: baseUrl,
    );
  }
}