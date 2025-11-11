import 'package:flutter/material.dart';

enum RequestFormatType {
  openai,
  ollama,
  azure,
  anthropic,
  google,
  qwen,
  cloudflare,
  volcengine
}

class RequestFormat {
  final RequestFormatType type;
  final String name;
  final Widget icon;

  RequestFormat({required this.type, required this.name, required this.icon});

  static List<RequestFormat> get supportedFormats => [
        RequestFormat(type: RequestFormatType.openai, name: 'OpenAI', icon: const Icon(Icons.smart_toy_outlined)),
        RequestFormat(type: RequestFormatType.ollama, name: 'Ollama', icon: const Icon(Icons.computer_outlined)),
        RequestFormat(type: RequestFormatType.azure, name: 'Azure OpenAI', icon: const Icon(Icons.cloud_queue_outlined)),
        RequestFormat(type: RequestFormatType.anthropic, name: 'Anthropic', icon: const Icon(Icons.psychology_outlined)),
        RequestFormat(type: RequestFormatType.google, name: 'Google', icon: const Icon(Icons.android_outlined)),
        RequestFormat(type: RequestFormatType.qwen, name: 'Qwen', icon: const Icon(Icons.question_answer_outlined)),
        RequestFormat(type: RequestFormatType.cloudflare, name: 'Cloudflare', icon: const Icon(Icons.cloud_upload_outlined)),
        RequestFormat(type: RequestFormatType.volcengine, name: 'Volcengine', icon: const Icon(Icons.volcano_outlined)),
      ];
}