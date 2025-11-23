import 'package:flutter/material.dart';
import 'package:flutter_svg/flutter_svg.dart';

enum RequestFormatType {
  openai,
  ollama,
  // azure,
  // anthropic,
  // google,
  // qwen,
  // cloudflare,
  // volcengine
}

class RequestFormat {
  final RequestFormatType type;
  final String name;
  final Widget icon;
  final String defaultUrl;

  RequestFormat({required this.type, required this.name, required this.icon, required this.defaultUrl});

  static List<RequestFormat> get supportedFormats => [
        RequestFormat(
            type: RequestFormatType.openai,
            name: 'OpenAI',
            icon: SvgPicture.asset('assets/icons/ai-chat/openai.svg',
                width: 24, height: 24),
            defaultUrl: 'https://api.openai.com/v1'),
        RequestFormat(
            type: RequestFormatType.ollama,
            name: 'Ollama',
            icon: SvgPicture.asset('assets/icons/ai-chat/ollama.svg',
                width: 24, height: 24),
            defaultUrl: 'http://localhost:11434/v1'),
      ];
}