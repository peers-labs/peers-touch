import 'dart:convert';
import 'ai_provider_template.dart';
import 'package:peers_touch_base/model/domain/ai_box/provider.pb.dart';

class OllamaTemplate extends AIProviderTemplate {
  OllamaTemplate();

  @override
  String get id => 'ollama';

  @override
  String get displayName => 'Ollama';

  @override
  String get baseServiceType => 'Ollama';

  @override
  Map<String, dynamic> defaultSettings() => {
        'requestFormat': 'ollama',
        'defaultProxyUrl': 'http://127.0.0.1:11434',
        'proxyUrl': 'http://127.0.0.1:11434',
        'checkModel': 'llama2',
        'models': <String>[],
        'apiKey': '',
      };

  @override
  Map<String, dynamic> defaultConfig() => {
        'temperature': 0.7,
        'maxTokens': 2048,
        'topP': 1.0,
        'frequencyPenalty': 0.0,
        'presencePenalty': 0.0,
      };

  @override
  List<FieldSpec> fieldSchema() => const [
        FieldSpec(key: 'proxyUrl', label: 'Ollama Server URL', placeholder: 'http://127.0.0.1:11434', editable: true),
        FieldSpec(key: 'checkModel', label: 'Connectivity Check Model', placeholder: 'llama2', editable: true),
      ];

  @override
  List<String> validate(Provider p) {
    final s = _jsonDecode(p.settingsJson);
    final errs = <String>[];
    if ((s['proxyUrl'] ?? '').toString().isEmpty) errs.add('proxyUrl is required');
    return errs;
  }

  @override
  Map<String, dynamic> toServiceConfig(Provider p) {
    final s = _jsonDecode(p.settingsJson);
    return {
      'baseUrl': s['proxyUrl'] ?? s['defaultProxyUrl'],
      'headers': {},
    };
  }

  @override
  ModelFetchSpec modelFetchSpec() => const ModelFetchSpec(endpoint: '/api/tags', method: 'GET', pathSelectors: ['models', 'name']);

  Map<String, dynamic> _jsonDecode(String source) {
    if (source.isEmpty) return <String, dynamic>{};
    try {
      return (jsonDecode(source) as Map).cast<String, dynamic>();
    } catch (_) {
      return <String, dynamic>{};
    }
  }
}
