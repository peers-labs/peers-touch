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

  RequestFormat({required this.type, required this.name, required this.icon});

  static List<RequestFormat> get supportedFormats => [
        RequestFormat(
            type: RequestFormatType.openai,
            name: 'OpenAI',
            icon: SvgPicture.asset('assets/icons/ai-chat/openai.svg',
                width: 24, height: 24)),
        RequestFormat(
            type: RequestFormatType.ollama,
            name: 'Ollama',
            icon: SvgPicture.asset('assets/icons/ai-chat/ollama.svg',
                width: 24, height: 24)),
      ];
}