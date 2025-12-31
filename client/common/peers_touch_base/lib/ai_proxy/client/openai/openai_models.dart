import 'package:peers_touch_base/foundation.dart' if (dart.library.ui) 'package:flutter/foundation.dart';

// --- Request Models ---

@immutable
class OpenAiChatRequest {

  const OpenAiChatRequest({
    required this.model,
    required this.messages,
    this.stream = true,
  });
  final String model;
  final List<OpenAiMessage> messages;
  final bool stream;

  Map<String, dynamic> toJson() => {
        'model': model,
        'messages': messages.map((m) => m.toJson()).toList(),
        'stream': stream,
      };
}

@immutable
class OpenAiMessage {

  const OpenAiMessage({required this.role, required this.content});
  final String role;
  final String content;

  Map<String, dynamic> toJson() => {
        'role': role,
        'content': content,
      };
}

// --- Response Models (for streaming) ---

@immutable
class OpenAiStreamChunk {

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
  final List<OpenAiStreamChoice> choices;
}

@immutable
class OpenAiStreamChoice {

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
  final OpenAiStreamDelta delta;
  final String? finishReason;
}

@immutable
class OpenAiStreamDelta {

  const OpenAiStreamDelta({this.content});

  factory OpenAiStreamDelta.fromJson(Map<String, dynamic> json) {
    return OpenAiStreamDelta(
      content: json['content'],
    );
  }
  final String? content;
}