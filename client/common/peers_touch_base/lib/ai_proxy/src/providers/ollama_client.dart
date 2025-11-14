import 'dart:convert';
import 'dart:async';
import 'package:http/http.dart' as http;

import '../interfaces/ai_provider_interface.dart';
import '../models/chat_models.dart';
import '../models/provider_config.dart';

/// Ollama 客户端实现
class OllamaClient implements AIProvider {
  late ProviderConfig _config;
  late final http.Client _client;
  late final Duration _timeout;

  OllamaClient(ProviderConfig config) {
    _config = config;
    _client = http.Client();
    _timeout = Duration(milliseconds: config.timeout);
  }

  @override
  ProviderConfig get config => _config;

  @override
  AIProviderType get type => AIProviderType.ollama;

  Map<String, String> _getHeaders() {
    final headers = <String, String>{
      'Content-Type': 'application/json',
    };
    if (_config.headers != null) {
      headers.addAll(Map<String, String>.from(_config.headers!));
    }
    return headers;
  }

  @override
  Future<bool> checkConnection() async {
    try {
      final response = await _client.get(
        Uri.parse('${_config.baseUrl}/api/tags'),
        headers: _getHeaders(),
      ).timeout(_timeout);
      
      return response.statusCode == 200;
    } catch (e) {
      return false;
    }
  }

  @override
  Future<List<ModelInfo>> listModels() async {
    final response = await _client.get(
      Uri.parse('${_config.baseUrl}/api/tags'),
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
    final models = (data['models'] as List).map((modelData) {
      return ModelInfo(
        id: modelData['name'],
        name: modelData['name'],
        provider: _config,
      );
    }).toList();

    return models;
  }

  @override
  Future<ChatCompletionResponse> chatCompletion(ChatCompletionRequest request) async {
    // 将 OpenAI 格式的请求转换为 Ollama 格式
    final ollamaRequest = {
      'model': request.model,
      'messages': request.messages.map((msg) => {
        'role': msg.role.name,
        'content': msg.content,
      }).toList(),
      'options': {
        if (request.temperature != null) 'temperature': request.temperature,
        if (request.topP != null) 'top_p': request.topP,
      },
      'stream': false,
    };

    final response = await _client.post(
      Uri.parse('${_config.baseUrl}/api/chat'),
      headers: _getHeaders(),
      body: json.encode(ollamaRequest),
    ).timeout(_timeout);

    if (response.statusCode != 200) {
      throw AIProviderException(
        type: AIProviderErrorType.serverError,
        message: 'Chat completion failed: ${response.statusCode}',
        statusCode: response.statusCode,
      );
    }

    final data = json.decode(response.body);
    
    // 将 Ollama 响应转换为 OpenAI 格式
    return ChatCompletionResponse(
      id: 'ollama-${DateTime.now().millisecondsSinceEpoch}',
      object: 'chat.completion',
      created: DateTime.now().millisecondsSinceEpoch ~/ 1000,
      model: request.model,
      choices: [
        ChatChoice(
          index: 0,
          message: ChatMessage(
            role: ChatRole.assistant,
            content: data['message']['content'] ?? '',
          ),
          finishReason: data['done'] == true ? 'stop' : null,
        ),
      ],
    );
  }

  @override
  Stream<ChatCompletionResponse> chatCompletionStream(ChatCompletionRequest request) {
    // 将 OpenAI 格式的请求转换为 Ollama 格式
    final ollamaRequest = {
      'model': request.model,
      'messages': request.messages.map((msg) => {
        'role': msg.role.name,
        'content': msg.content,
      }).toList(),
      'options': {
        if (request.temperature != null) 'temperature': request.temperature,
        if (request.topP != null) 'top_p': request.topP,
      },
      'stream': true,
    };

    final controller = StreamController<ChatCompletionResponse>();

    _client.post(
      Uri.parse('${_config.baseUrl}/api/chat'),
      headers: _getHeaders(),
      body: json.encode(ollamaRequest),
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
        if (line.trim().isNotEmpty) {
          try {
            final data = json.decode(line);
            if (data['message'] != null) {
              final chunk = ChatCompletionResponse(
                id: 'ollama-${DateTime.now().millisecondsSinceEpoch}',
                object: 'chat.completion.chunk',
                created: DateTime.now().millisecondsSinceEpoch ~/ 1000,
                model: request.model,
                choices: [
                  ChatChoice(
                    index: 0,
                    message: ChatMessage(
                      role: ChatRole.assistant,
                      content: data['message']['content'] ?? '',
                    ),
                    finishReason: data['done'] == true ? 'stop' : null,
                  ),
                ],
              );
              controller.add(chunk);
            }
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