export 'package:peers_touch_base/model/domain/ai_box/chat_models.pb.dart';
export 'package:peers_touch_base/model/domain/ai_box/chat.pb.dart';

// 角色枚举映射
enum ChatRole {
  system,
  user,
  assistant,
  tool,
}

// 工具调用类（protobuf 中没有对应的模型）
class ToolCall {
  final String id;
  final String type;
  final Map<String, dynamic> function;

  const ToolCall({
    required this.id,
    required this.type,
    required this.function,
  });

  Map<String, dynamic> toJson() {
    return {
      'id': id,
      'type': type,
      'function': function,
    };
  }

  factory ToolCall.fromJson(Map<String, dynamic> json) {
    return ToolCall(
      id: json['id'],
      type: json['type'],
      function: Map<String, dynamic>.from(json['function']),
    );
  }
}

// 聊天完成请求
class ChatCompletionRequest {
  final String model;
  final List<ChatMessage> messages;
  final double? temperature;
  final int? maxTokens;
  final double? topP;
  final int? n;
  final bool? stream;
  final List<String>? stop;
  final double? presencePenalty;
  final double? frequencyPenalty;
  final Map<String, dynamic>? logitBias;
  final String? user;

  const ChatCompletionRequest({
    required this.model,
    required this.messages,
    this.temperature,
    this.maxTokens,
    this.topP,
    this.n,
    this.stream,
    this.stop,
    this.presencePenalty,
    this.frequencyPenalty,
    this.logitBias,
    this.user,
  });

  Map<String, dynamic> toJson() {
    return {
      'model': model,
      'messages': messages.map((e) => e.writeToJson()).toList(),
      if (temperature != null) 'temperature': temperature,
      if (maxTokens != null) 'max_tokens': maxTokens,
      if (topP != null) 'top_p': topP,
      if (n != null) 'n': n,
      if (stream != null) 'stream': stream,
      if (stop != null) 'stop': stop,
      if (presencePenalty != null) 'presence_penalty': presencePenalty,
      if (frequencyPenalty != null) 'frequency_penalty': frequencyPenalty,
      if (logitBias != null) 'logit_bias': logitBias,
      if (user != null) 'user': user,
    };
  }
}

/// 聊天完成响应
class ChatCompletionResponse {
  final String id;
  final String object;
  final int created;
  final String model;
  final List<ChatChoice> choices;
  final Usage? usage;

  const ChatCompletionResponse({
    required this.id,
    required this.object,
    required this.created,
    required this.model,
    required this.choices,
    this.usage,
  });

  factory ChatCompletionResponse.fromJson(Map<String, dynamic> json) {
    return ChatCompletionResponse(
      id: json['id'],
      object: json['object'],
      created: json['created'],
      model: json['model'],
      choices: (json['choices'] as List)
          .map((e) => ChatChoice.fromJson(e))
          .toList(),
      usage: json['usage'] != null ? Usage.fromJson(json['usage']) : null,
    );
  }
}

/// 聊天选择
class ChatChoice {
  final int index;
  final ChatMessage message;
  final String? finishReason;
  final double? logprobs;

  const ChatChoice({
    required this.index,
    required this.message,
    this.finishReason,
    this.logprobs,
  });

  factory ChatChoice.fromJson(Map<String, dynamic> json) {
    return ChatChoice(
      index: json['index'],
      message: ChatMessage.fromJson(json['message']),
      finishReason: json['finish_reason'],
      logprobs: json['logprobs'],
    );
  }
}

/// 使用统计
class Usage {
  final int promptTokens;
  final int completionTokens;
  final int totalTokens;

  const Usage({
    required this.promptTokens,
    required this.completionTokens,
    required this.totalTokens,
  });

  factory Usage.fromJson(Map<String, dynamic> json) {
    return Usage(
      promptTokens: json['prompt_tokens'],
      completionTokens: json['completion_tokens'],
      totalTokens: json['total_tokens'],
    );
  }
}