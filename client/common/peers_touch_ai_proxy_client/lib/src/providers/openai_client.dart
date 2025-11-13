import 'dart:convert';
import 'dart:async';
import 'package:http/http.dart' as http;

import '../interfaces/ai_provider_interface.dart';
import '../models/chat_models.dart';
import '../models/provider_config.dart';

/// OpenAI 客户端实现
class OpenAIClient implements AIProvider {
  late ProviderConfig _config;
  late final http.Client _client;
  late final Duration _timeout;

  OpenAIClient(ProviderConfig config) {
    _config = config;
    _client = http.Client();
    _timeout = Duration(milliseconds: config.timeout);
  }

  @override
  ProviderConfig get config => _config;

  @override
  AIProviderType get type => AIProviderType.openai;

  Map<String, String> _getHeaders() {
    final headers = <String, String>{
      'Content-Type': 'application/json',
    };
    if (_config.apiKey != null) {
      headers['Authorization'] = 'Bearer ${_config.apiKey}';
    }
    if (_config.headers != null) {
      headers.addAll(Map<String, String>.from(_config.headers!));
    }
    return headers;
  }

  @override
  Future<bool> checkConnection() async {
    try {
      final response = await _client.get(
        Uri.parse('${_config.baseUrl}/models'),
        headers: _getHeaders(),
      ).timeout(_timeout);
      
      return response.statusCode == 200;
    } catch (e) {
      return false;
    }
  }

  @override
  Future<List<ModelInfo>> listModels() async {
    try {
      final response = await _client.get(
        Uri.parse('${_config.baseUrl}/models'),
        headers: _getHeaders(),
      ).timeout(_timeout);

      if (response.statusCode != 200) {
        throw AIProviderException(
          type: AIProviderErrorType.connection,
          message: 'Failed to fetch models: ${response.statusCode}',
          statusCode: response.statusCode,
        );
      }

      final data = json.decode(response.body);
      final models = (data['data'] as List).map((modelData) {
        return ModelInfo(
          id: modelData['id'],
          name: modelData['id'],
          provider: _config,
        );
      }).toList();

      return models;
    } catch (e) {
      throw AIProviderException(
        type: AIProviderErrorType.connection,
        message: 'Failed to list models: $e',
      );
    }
  }

  @override
  Future<ChatCompletionResponse> chatCompletion(ChatCompletionRequest request) async {
    try {
      final response = await _client.post(
        Uri.parse('${_config.baseUrl}/chat/completions'),
        headers: _getHeaders(),
        body: json.encode(request.toJson()),
      ).timeout(_timeout);

      if (response.statusCode != 200) {
        throw AIProviderException(
          type: AIProviderErrorType.serverError,
          message: 'Chat completion failed: ${response.statusCode}',
          statusCode: response.statusCode,
        );
      }

      final data = json.decode(response.body);
      return ChatCompletionResponse.fromJson(data);
    } catch (e) {
      throw AIProviderException(
        type: AIProviderErrorType.serverError,
        message: 'Chat completion failed: $e',
      );
    }
  }

  @override
  Stream<ChatCompletionResponse> chatCompletionStream(ChatCompletionRequest request) {
    final controller = StreamController<ChatCompletionResponse>();

    // 创建流式请求
    final streamRequest = {
      'model': request.model,
      'messages': request.messages.map((e) => e.toJson()).toList(),
      'temperature': request.temperature,
      'max_tokens': request.maxTokens,
      'top_p': request.topP,
      'stream': true,
    };

    _client.post(
      Uri.parse('${_config.baseUrl}/chat/completions'),
      headers: _getHeaders(),
      body: json.encode(streamRequest),
    ).timeout(_timeout).then((response) {
      if (response.statusCode != 200) {
        controller.addError(AIProviderException(
          type: AIProviderErrorType.serverError,
          message: 'Stream chat completion failed: ${response.statusCode}',
          statusCode: response.statusCode,
        ));
        return;
      }

      final lines = response.body.split('\n');
      for (final line in lines) {
        if (line.startsWith('data: ') && line != 'data: [DONE]') {
          try {
            final jsonData = line.substring(6);
            final data = json.decode(jsonData);
            final chunk = ChatCompletionResponse.fromJson(data);
            controller.add(chunk);
          } catch (e) {
            // 忽略解析错误，继续处理下一行
          }
        }
      }
      controller.close();
    }).catchError((error) {
      controller.addError(error);
    });

    return controller.stream;
  }

  @override
  void updateConfig(ProviderConfig newConfig) {
    _config = newConfig;
    _timeout = Duration(milliseconds: newConfig.timeout);
  }

  @override
  Future<void> close() async {
    _client.close();
  }
}