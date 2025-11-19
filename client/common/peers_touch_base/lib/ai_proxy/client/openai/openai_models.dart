import 'package:flutter/foundation.dart';

// --- Request Models ---

@immutable
class OpenAiChatRequest {
  final String model;
  final List<OpenAiMessage> messages;
  final bool stream;

  const OpenAiChatRequest({
    required this.model,
    required this.messages,
    this.stream = true,
  });

  Map<String, dynamic> toJson() => {
        'model': model,
        'messages': messages.map((m) => m.toJson()).toList(),
        'stream': stream,
      };
}

@immutable
class OpenAiMessage {
  final String role;
  final String content;

  const OpenAiMessage({required this.role, required this.content});

  Map<String, dynamic> toJson() => {
        'role': role,
        'content': content,
      };
}

// --- Response Models (for streaming) ---

@immutable
class OpenAiStreamChunk {
  final List<OpenAiStreamChoice> choices;

  const OpenAiStreamChunk({
    required this.choices,
  });

  factory OpenAiStreamChunk.fromJson(Map<String, dynamic> json) {
    return OpenAiStreamChunk(
      choices: (json['choices'] as List)
          .map((c) => OpenAiStreamChoice.fromJson(c))
          .toList(),
    );
  }
}

@immutable
class OpenAiStreamChoice {
  final OpenAiStreamDelta delta;
  final String? finishReason;

  const OpenAiStreamChoice({
    required this.delta,
    this.finishReason,
  });

  factory OpenAiStreamChoice.fromJson(Map<String, dynamic> json) {
    return OpenAiStreamChoice(
      delta: OpenAiStreamDelta.fromJson(json['delta']),
      finishReason: json['finish_reason'],
    );
  }
}

@immutable
class OpenAiStreamDelta {
  final String? content;

  const OpenAiStreamDelta({this.content});

  factory OpenAiStreamDelta.fromJson(Map<String, dynamic> json) {
    return OpenAiStreamDelta(
      content: json['content'],
    );
  }
}