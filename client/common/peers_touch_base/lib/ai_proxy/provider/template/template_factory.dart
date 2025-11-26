import 'dart:convert';
import 'package:peers_touch_base/model/domain/ai_box/provider.pb.dart';
import 'ai_provider_template.dart';
import 'openai_template.dart';
import 'openai_style_template.dart';
import 'ollama_template.dart';

class AIProviderTemplateFactory {
  static AIProviderTemplate fromProvider(Provider p) {
    final settings = _jsonDecode(p.settingsJson);
    final rf = (settings['requestFormat'] ?? p.sourceType ?? '').toString().toLowerCase();
    if (rf.startsWith('openai_style:')) {
      final vendor = rf.split(':').length > 1 ? rf.split(':')[1] : 'custom';
      return OpenAIStyleTemplate(vendor: vendor);
    }
    switch (rf) {
      case 'openai':
        return OpenAITemplate();
      case 'ollama':
        return OllamaTemplate();
      default:
        return OpenAITemplate();
    }
  }

  static Map<String, dynamic> _jsonDecode(String source) {
    if (source.isEmpty) return <String, dynamic>{};
    try {
      return (jsonDecode(source) as Map).cast<String, dynamic>();
    } catch (_) {
      return <String, dynamic>{};
    }
  }
}
