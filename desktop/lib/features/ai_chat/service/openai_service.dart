import 'dart:convert';
import 'package:dio/dio.dart';
import 'package:get/get.dart';
import 'package:peers_touch_desktop/core/constants/ai_constants.dart';
import 'package:peers_touch_desktop/core/services/logging_service.dart';
import 'ai_service.dart';

/// OpenAI服务实现
class OpenAIService implements AIService {
  final StorageService _storage = Get.find<StorageService>();

  // 可选的实例级覆盖配置（用于 Provider 实例打通）
  final String? apiKeyOverride;
  final String? baseUrlOverride;
  final String? endpoint;
  final String? defaultModel;

  OpenAIService({this.apiKeyOverride, this.baseUrlOverride, this.endpoint, this.defaultModel});
  
  /// 获取配置的Dio实例
  Dio get _dio {
    final apiKey = apiKeyOverride ?? (_storage.get<String>(AIConstants.openaiApiKey) ?? '');
    final baseUrl = baseUrlOverride ?? (_storage.get<String>(AIConstants.openaiBaseUrl) ?? AIConstants.defaultOpenAIBaseUrl);
    
    final dio = Dio(BaseOptions(
      baseUrl: baseUrl,
      headers: {
        'Authorization': apiKey.isNotEmpty ? 'Bearer $apiKey' : null,
        'Content-Type': 'application/json',
      },
      connectTimeout: const Duration(seconds: 30),
      receiveTimeout: const Duration(seconds: 60),
    ));
    
    // 添加请求拦截器记录完整URL
    dio.interceptors.add(InterceptorsWrapper(
      onRequest: (options, handler) {
        final fullUrl = '${options.baseUrl}${options.path}';
        LoggingService.debug('=== 完整API请求URL ===');
        LoggingService.debug('URL: $fullUrl');
        LoggingService.debug('请求方法: ${options.method}');
        LoggingService.debug('====================');
        return handler.next(options);
      },
    ));
    
    return dio;
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
        defaultModel ??
        _storage.get<String>(AIConstants.selectedModelOpenAI) ??
        _storage.get<String>(AIConstants.selectedModel) ??
        AIConstants.defaultOpenAIModel;
    final selectedTemperature = temperature ?? double.tryParse(_storage.get<String>(AIConstants.temperature) ?? AIConstants.defaultTemperature.toString()) ?? AIConstants.defaultTemperature;
    
    try {
        final systemPrompt = _storage.get<String>(AIConstants.systemPrompt) ?? AIConstants.defaultSystemPrompt;
        final resolvedEndpoint = endpoint ?? '/chat/completions';
        final fullUrl = '${_dio.options.baseUrl}$resolvedEndpoint';
        final requestData = {
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
        };
        
        // 记录请求详情
        LoggingService.debug('=== AI API 请求详情 ===');
        LoggingService.debug('URL: $fullUrl');
        LoggingService.debug('Headers:');
        LoggingService.debug('  Authorization: ${_dio.options.headers['Authorization']}'); // 显示真实头信息以排查问题
        LoggingService.debug('  Content-Type: ${_dio.options.headers['Content-Type']}');
        LoggingService.debug('请求参数: ${json.encode(requestData)}');
        LoggingService.debug('模型名称: $selectedModel');
        LoggingService.debug('========================');
        
        // 记录原始API请求（出错时也能查看）
        LoggingService.debug('=== 原始API请求 ===');
        LoggingService.debug('URL: ${_dio.options.baseUrl}$resolvedEndpoint');
        LoggingService.debug('Headers: ${json.encode(_dio.options.headers)}');
        LoggingService.debug('Body: ${json.encode(requestData)}');
        
        // 创建请求选项，显式指定headers
        final options = Options(
          responseType: ResponseType.stream,
          headers: {
            'Authorization': 'Bearer ${_dio.options.headers['Authorization'].toString().replaceFirst('Bearer ', '')}',
            'Content-Type': 'application/json',
          },
        );
        
        final response = await _dio.post(
          resolvedEndpoint,
          data: requestData,
          options: options,
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
        defaultModel ??
        _storage.get<String>(AIConstants.selectedModelOpenAI) ??
        _storage.get<String>(AIConstants.selectedModel) ??
        AIConstants.defaultOpenAIModel;
    final selectedTemperature = temperature ?? double.tryParse(_storage.get<String>(AIConstants.temperature) ?? AIConstants.defaultTemperature.toString()) ?? AIConstants.defaultTemperature;
    
    try {
        final systemPrompt = _storage.get<String>(AIConstants.systemPrompt) ?? AIConstants.defaultSystemPrompt;
        final resolvedEndpoint = endpoint ?? '/chat/completions';
        final fullUrl = '${_dio.options.baseUrl}$resolvedEndpoint';
        final requestData = {
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
        };
        
        // 记录请求详情
        LoggingService.debug('=== AI API 请求详情 ===');
        LoggingService.debug('URL: $fullUrl');
        LoggingService.debug('Headers:');
        LoggingService.debug('  Authorization: Bearer ${_dio.options.headers['Authorization'].toString().substring(0, 10)}...'); // 只显示部分API Key
        LoggingService.debug('  Content-Type: ${_dio.options.headers['Content-Type']}');
        LoggingService.debug('请求参数: ${json.encode(requestData)}');
        LoggingService.debug('========================');
        
        // 记录原始API请求（出错时也能查看）
        LoggingService.debug('=== 原始API请求 ===');
        LoggingService.debug('URL: ${_dio.options.baseUrl}$resolvedEndpoint');
        LoggingService.debug('Headers: ${json.encode(_dio.options.headers)}');
        LoggingService.debug('Body: ${json.encode(requestData)}');
        
        final response = await _dio.post(
          resolvedEndpoint,
          data: requestData,
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