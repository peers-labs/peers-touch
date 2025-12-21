import 'dart:convert';
import 'package:dio/dio.dart';
import 'package:get/get.dart';
import 'package:peers_touch_desktop/core/constants/ai_constants.dart';
import 'package:peers_touch_base/storage/local_storage.dart';
import 'package:peers_touch_desktop/core/services/logging_service.dart';
import 'ai_service.dart';

/// OpenAI服务实现
class OpenAIService implements AIService {
  final LocalStorage _storage = Get.find<LocalStorage>();
  final String? _apiKey;
  final String? _baseUrl;

  OpenAIService({String? apiKey, String? baseUrl})
      : _apiKey = apiKey,
        _baseUrl = baseUrl;
  
  /// 获取配置的Dio实例
  Future<Dio> _getDio() async {
    final apiKey = _apiKey ?? await _storage.get<String>(AIConstants.openaiApiKey) ?? '';
    final baseUrl = _baseUrl ?? await _storage.get<String>(AIConstants.openaiBaseUrl) ?? AIConstants.defaultOpenAIBaseUrl;
    
    return Dio(BaseOptions(
      baseUrl: baseUrl,
      headers: {
        'Authorization': 'Bearer $apiKey',
        'Content-Type': 'application/json',
      },
      connectTimeout: const Duration(seconds: 30),
      receiveTimeout: const Duration(seconds: 60),
    ));
  }
  
  /// 检查配置是否有效
  @override
  Future<bool> checkConfigured() async {
    final apiKey = _apiKey ?? await _storage.get<String>(AIConstants.openaiApiKey) ?? '';
    return apiKey.isNotEmpty;
  }
  
  /// 拉取可用模型列表
  @override
  Future<List<String>> fetchModels() async {
    if (!await checkConfigured()) {
      throw Exception('OpenAI API密钥未配置');
    }

    try {
      final dio = await _getDio();
      final response = await dio.get('/models');
      final data = response.data;
      if (data is Map<String, dynamic> && data['data'] is List) {
        final list = (data['data'] as List)
            .map((e) => (e as Map<String, dynamic>)['id']?.toString() ?? '')
            .where((id) => id.isNotEmpty)
            .toList();
        return list;
      }
      return [];
    } catch (e) {
      LoggingService.error('OpenAI 模型拉取失败', e);
      rethrow;
    }
  }

  /// 发送聊天消息（流式响应）
  @override
  CancelHandle createCancelHandle() => _DioCancelHandle();

  /// 内部实现：Dio 取消令牌包装
  static CancelToken? _extractToken(CancelHandle? h) =>
      (h is _DioCancelHandle) ? h.token : null;

  @override
  Stream<String> sendMessageStream({
    required String message,
    String? model,
    double? temperature,
    List<Map<String, dynamic>>? openAIContent,
    List<String>? imagesBase64,
    CancelHandle? cancel,
  }) async* {
    if (!await checkConfigured()) {
      throw Exception('OpenAI API密钥未配置');
    }
    
    final selectedModel = model ??
        await _storage.get<String>(AIConstants.selectedModelOpenAI) ??
        await _storage.get<String>(AIConstants.selectedModel) ??
        AIConstants.defaultOpenAIModel;
    final tempStr = await _storage.get<String>(AIConstants.temperature) ?? AIConstants.defaultTemperature.toString();
    final selectedTemperature = temperature ?? double.tryParse(tempStr) ?? AIConstants.defaultTemperature;
    
    try {
      final dio = await _getDio();
      final systemPrompt = await _storage.get<String>(AIConstants.systemPrompt) ?? AIConstants.defaultSystemPrompt;
      final response = await dio.post(
        '/chat/completions',
        data: {
          'model': selectedModel,
          'messages': [
            {'role': 'system', 'content': systemPrompt},
            {
              'role': 'user',
              'content': openAIContent ?? message,
            }
          ],
          'temperature': selectedTemperature,
          'max_tokens': AIConstants.defaultMaxTokens,
          'stream': true,
          'stream_options': {'include_usage': true},
        },
        options: Options(
          responseType: ResponseType.stream,
        ),
        cancelToken: _extractToken(cancel),
      );
      
      final stream = response.data as ResponseBody;
      
      await for (final chunk in stream.stream) {
        final decodedChunk = utf8.decode(chunk);
        final lines = decodedChunk.split('\n');
        
        for (final line in lines) {
          if (line.startsWith('data: ') && line != 'data: [DONE]') {
            try {
              final jsonData = json.decode(line.substring(6));
              final content = jsonData['choices'][0]['delta']['content'];
              if (content != null) {
                yield content;
              }
            } catch (e) {
              // 忽略解析错误，继续处理下一个数据块
              LoggingService.debug('OpenAI流式响应解析错误: $e');
            }
          }
        }
      }
    } catch (e) {
      // 取消请求时静默结束，避免未捕获异常导致界面卡死
      if (e is DioException && e.type == DioExceptionType.cancel) {
        return;
      }
      LoggingService.error('OpenAI API调用失败', e);
      // 非取消错误不抛出，交由控制器通过完成回调复位状态
      return;
    }
  }
  
  /// 发送聊天消息（非流式响应）
  @override
  Future<String> sendMessage({
    required String message,
    String? model,
    double? temperature,
    List<Map<String, dynamic>>? openAIContent,
    List<String>? imagesBase64,
    CancelHandle? cancel,
  }) async {
    if (!await checkConfigured()) {
      throw Exception('OpenAI API密钥未配置');
    }
    
    final selectedModel = model ??
        await _storage.get<String>(AIConstants.selectedModelOpenAI) ??
        await _storage.get<String>(AIConstants.selectedModel) ??
        AIConstants.defaultOpenAIModel;
    final tempStr = await _storage.get<String>(AIConstants.temperature) ?? AIConstants.defaultTemperature.toString();
    final selectedTemperature = temperature ?? double.tryParse(tempStr) ?? AIConstants.defaultTemperature;
    
    try {
      final dio = await _getDio();
      final systemPrompt = await _storage.get<String>(AIConstants.systemPrompt) ?? AIConstants.defaultSystemPrompt;
      final response = await dio.post(
        '/chat/completions',
        data: {
          'model': selectedModel,
          'messages': [
            {'role': 'system', 'content': systemPrompt},
            {
              'role': 'user',
              'content': openAIContent ?? message,
            }
          ],
          'temperature': selectedTemperature,
          'max_tokens': AIConstants.defaultMaxTokens,
          'stream': false,
        },
        options: Options(),
        cancelToken: _extractToken(cancel),
      );
      
      final content = response.data['choices'][0]['message']['content'];
      return content ?? '';
    } catch (e) {
      LoggingService.error('OpenAI API调用失败', e);
      rethrow;
    }
  }
  
  /// 测试API连接
  @override
  Future<bool> testConnection() async {
    if (!await checkConfigured()) {
      return false;
    }
    
    try {
      final dio = await _getDio();
      await dio.get('/models');
      return true;
    } catch (e) {
      LoggingService.warning('OpenAI连接测试失败', e);
      return false;
    }
  }

}

/// 私有类：Dio CancelToken 适配到通用 CancelHandle
class _DioCancelHandle implements CancelHandle {
  final CancelToken token = CancelToken();
  @override
  void cancel([String? reason]) => token.cancel(reason);
}
