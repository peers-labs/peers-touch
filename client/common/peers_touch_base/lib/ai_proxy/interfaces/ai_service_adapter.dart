import 'dart:async';
import 'ai_service.dart';
import 'ai_provider_interface.dart';
import '../models/chat_models.dart';

/// AI服务适配器 - 将AIProvider适配为AIService接口
class AIServiceAdapter implements AIService {
  final AIProvider _provider;

  AIServiceAdapter(this._provider);

  @override
  Future<String> sendMessage({
    required String message,
    String? model,
    double? temperature,
  }) async {
    final request = ChatCompletionRequest(
      messages: [
        ChatMessage(role: ChatRole.user, content: message),
      ],
      model: model ?? 'gpt-3.5-turbo',
      temperature: temperature ?? 0.7,
      stream: false,
    );

    final response = await _provider.chatCompletion(request);
    return response.choices.first.message.content;
  }

  @override
  Stream<String> sendMessageStream({
    required String message,
    String? model,
    double? temperature,
  }) async* {
    final request = ChatCompletionRequest(
      messages: [
        ChatMessage(role: ChatRole.user, content: message),
      ],
      model: model ?? 'gpt-3.5-turbo',
      temperature: temperature ?? 0.7,
      stream: true,
    );

    await for (final chunk in _provider.chatCompletionStream(request)) {
      if (chunk.choices.isNotEmpty) {
        yield chunk.choices.first.message.content;
      }
    }
  }
}