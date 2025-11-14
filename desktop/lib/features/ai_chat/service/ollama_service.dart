import 'dart:async';
import 'dart:convert';
import 'dart:typed_data';
import 'package:dio/dio.dart';
import 'package:get/get.dart';
import 'package:peers_touch_desktop/core/constants/ai_constants.dart';
import 'package:peers_touch_desktop/core/services/logging_service.dart';
import 'ai_service.dart';

/// Ollama 服务实现
class OllamaService implements AIService {
  final StorageService _storage = Get.find<StorageService>();

  // 实例级覆盖：用于 Provider 实例打通
  final String? baseUrlOverride;

  OllamaService({this.baseUrlOverride});

  Dio get _dio {
    final baseUrl = baseUrlOverride ?? (_storage.get<String>(AIConstants.ollamaBaseUrl) ?? 'http://localhost:11434');
    return Dio(BaseOptions(
      baseUrl: baseUrl,
      headers: {
        'Content-Type': 'application/json',
      },
      connectTimeout: const Duration(seconds: 15),
      receiveTimeout: const Duration(seconds: 60),
    ));
  }

  @override
  bool get isConfigured {
    final baseUrl = baseUrlOverride ?? (_storage.get<String>(AIConstants.ollamaBaseUrl) ?? '');
    return baseUrl.isNotEmpty;
  }

  /// GET /api/tags 返回所有模型标签
  @override
  Future<List<String>> fetchModels() async {
    try {
      final response = await _dio.get('/api/tags');
      final data = response.data;
      if (data is Map<String, dynamic> && data['models'] is List) {
        final list = (data['models'] as List)
            .map((e) => (e as Map<String, dynamic>)['name']?.toString() ?? '')
            .where((name) => name.isNotEmpty)
            .toList();
        return list;
      }
      return [];
    } catch (e) {
      LoggingService.error('Ollama 模型拉取失败', e);
      rethrow;
    }
  }

  /// 发送聊天消息（流式）使用 /api/generate
  @override
  Stream<String> sendMessageStream({
    required String message,
    String? model,
    double? temperature,
    List<Map<String, dynamic>>? openAIContent,
    List<String>? imagesBase64,
  }) async* {
    final m = model ??
        _storage.get<String>(AIConstants.selectedModelOllama) ??
        _storage.get<String>(AIConstants.selectedModel) ??
        '';
    if (m.isEmpty) {
      yield '模型未选择';
      return;
    }
    try {
      final systemPrompt = _storage.get<String>(AIConstants.systemPrompt) ?? AIConstants.defaultSystemPrompt;
      final response = await _dio.post(
        '/api/generate',
        data: {
          'model': m,
          'prompt': message,
          'system': systemPrompt,
          'stream': true,
          if (temperature != null) 'temperature': temperature,
          if (imagesBase64 != null && imagesBase64.isNotEmpty) 'images': imagesBase64,
        },
        options: Options(responseType: ResponseType.stream),
      );
      final body = response.data as ResponseBody;
      // 将字节流按行解码（NDJSON）
      final lineStream = body.stream
          .map((Uint8List chunk) => utf8.decode(chunk))
          .transform(const LineSplitter());
      await for (final line in lineStream) {
        final trimmed = line.trim();
        if (trimmed.isEmpty) continue;
        try {
          final jsonObj = json.decode(trimmed) as Map<String, dynamic>;
          final text = jsonObj['response'];
          if (text is String) {
            yield text;
          }
        } catch (_) {
          // 忽略解析错误，继续下一行
        }
      }
    } catch (e) {
      LoggingService.error('Ollama 发送消息失败', e);
      yield '请求失败：$e';
    }
  }

  /// 非流式：stream=false 聚合返回
  @override
  Future<String> sendMessage({
    required String message,
    String? model,
    double? temperature,
    List<Map<String, dynamic>>? openAIContent,
    List<String>? imagesBase64,
  }) async {
    final m = model ??
        _storage.get<String>(AIConstants.selectedModelOllama) ??
        _storage.get<String>(AIConstants.selectedModel) ??
        '';
    if (m.isEmpty) {
      return '模型未选择';
    }
    try {
      final systemPrompt = _storage.get<String>(AIConstants.systemPrompt) ?? AIConstants.defaultSystemPrompt;
      final resp = await _dio.post(
        '/api/generate',
        data: {
          'model': m,
          'prompt': message,
          'system': systemPrompt,
          'stream': false,
          if (temperature != null) 'temperature': temperature,
          if (imagesBase64 != null && imagesBase64.isNotEmpty) 'images': imagesBase64,
        },
      );
      final data = resp.data;
      if (data is Map<String, dynamic> && data['response'] is String) {
        return data['response'] as String;
      }
      return data.toString();
    } catch (e) {
      LoggingService.error('Ollama 非流式消息失败', e);
      rethrow;
    }
  }

  @override
  Future<bool> testConnection() async {
    try {
      final r = await _dio.get('/api/tags');
      return r.statusCode == 200;
    } catch (_) {
      return false;
    }
  }
}