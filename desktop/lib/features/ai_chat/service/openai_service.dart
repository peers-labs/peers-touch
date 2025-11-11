import 'dart:convert';
import 'package:dio/dio.dart';
import 'package:get/get.dart';
import 'package:peers_touch_desktop/core/constants/ai_constants.dart';
import 'package:peers_touch_storage/peers_touch_storage.dart';
import 'package:peers_touch_desktop/core/services/logging_service.dart';
import 'ai_service.dart';

/// OpenAI服务实现
class OpenAIService implements AIService {
  final LocalStorage _storage = Get.find<LocalStorage>();

  // 可选的实例级覆盖配置（用于 Provider 实例打通）
  final String? apiKeyOverride;
  final String? baseUrlOverride;

  OpenAIService({this.apiKeyOverride, this.baseUrlOverride});
  
  /// 获取配置的Dio实例
  Dio get _dio {
    final apiKey = apiKeyOverride ?? (_storage.get<String>(AIConstants.openaiApiKey) ?? '');
    final baseUrl = baseUrlOverride ?? (_storage.get<String>(AIConstants.openaiBaseUrl) ?? AIConstants.defaultOpenAIBaseUrl);
    
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
  bool get isConfigured {
    final apiKey = apiKeyOverride ?? (_storage.get<String>(AIConstants.openaiApiKey) ?? '');
    return apiKey.isNotEmpty;
  }
  
  /// 拉取可用模型列表
  @override
  Future<List<String>> fetchModels() async {
    if (!isConfigured) {
      throw Exception('OpenAI API密钥未配置');
    }

    try {
      final response = await _dio.get('/v1/models');
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
  Stream<String> sendMessageStream({
    required String message,
    String? model,
    double? temperature,
    List<Map<String, dynamic>>? openAIContent,
    List<String>? imagesBase64,
  }) async* {
    if (!isConfigured) {
      throw Exception('OpenAI API密钥未配置');
    }
    
    final selectedModel = model ??
        _storage.get<String>(AIConstants.selectedModelOpenAI) ??
        _storage.get<String>(AIConstants.selectedModel) ??
        AIConstants.defaultOpenAIModel;
    final selectedTemperature = temperature ?? double.tryParse(_storage.get<String>(AIConstants.temperature) ?? AIConstants.defaultTemperature.toString()) ?? AIConstants.defaultTemperature;
    
    try {
      final systemPrompt = _storage.get<String>(AIConstants.systemPrompt) ?? AIConstants.defaultSystemPrompt;
      final response = await _dio.post(
        '/v1/chat/completions',
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
        },
        options: Options(
          responseType: ResponseType.stream,
        ),
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
      LoggingService.error('OpenAI API调用失败', e);
      rethrow;
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
  }) async {
    if (!isConfigured) {
      throw Exception('OpenAI API密钥未配置');
    }
    
    final selectedModel = model ??
        _storage.get<String>(AIConstants.selectedModelOpenAI) ??
        _storage.get<String>(AIConstants.selectedModel) ??
        AIConstants.defaultOpenAIModel;
    final selectedTemperature = temperature ?? double.tryParse(_storage.get<String>(AIConstants.temperature) ?? AIConstants.defaultTemperature.toString()) ?? AIConstants.defaultTemperature;
    
    try {
      final systemPrompt = _storage.get<String>(AIConstants.systemPrompt) ?? AIConstants.defaultSystemPrompt;
      final response = await _dio.post(
        '/v1/chat/completions',
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
        },
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
    if (!isConfigured) {
      return false;
    }
    
    try {
      await _dio.get('/v1/models');
      return true;
    } catch (e) {
      LoggingService.warning('OpenAI连接测试失败', e);
      return false;
    }
  }
}