import 'openai_template.dart';

class OpenAIStyleTemplate extends OpenAITemplate {
  final String vendor;
  OpenAIStyleTemplate({required this.vendor});

  @override
  String get id => 'openai_style:$vendor';

  @override
  String get displayName => 'OpenAI Style ($vendor)';

  @override
  Map<String, dynamic> defaultSettings() {
    final base = super.defaultSettings();
    // 根据不同厂商覆盖默认代理地址
    switch (vendor.toLowerCase()) {
      case 'deepseek':
        base['defaultProxyUrl'] = 'https://api.deepseek.com/v1';
        base['proxyUrl'] = base['defaultProxyUrl'];
        break;
      default:
        // 保留 OpenAI 默认
        break;
    }
    base['requestFormat'] = 'openai_style:$vendor';
    return base;
  }
}
