import 'dart:convert';
import 'ai_provider_template.dart';
import 'package:peers_touch_base/model/domain/ai_box/provider.pb.dart';

class OpenAITemplate extends AIProviderTemplate {
  OpenAITemplate();

  @override
  String get id => 'openai';

  @override
  String get displayName => 'OpenAI';

  @override
  String get baseServiceType => 'OpenAI';

  @override
  Map<String, dynamic> defaultSettings() => {
        'requestFormat': 'openai',
        'defaultProxyUrl': 'https://api.openai.com/v1',
        'proxyUrl': 'https://api.openai.com/v1',
        'checkModel': 'gpt-4o-mini',
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
        FieldSpec(key: 'apiKey', label: 'API Key', placeholder: 'sk-...', editable: true, obscure: true),
        FieldSpec(key: 'proxyUrl', label: 'API Proxy URL', placeholder: 'https://api.openai.com/v1', editable: true),
        FieldSpec(key: 'checkModel', label: 'Connectivity Check Model', placeholder: 'gpt-4o-mini', editable: true),
      ];

  @override
  List<String> validate(Provider p) {
    final s = _jsonDecode(p.settingsJson);
    final errs = <String>[];
    if ((s['proxyUrl'] ?? '').toString().isEmpty) errs.add('proxyUrl is required');
    if ((s['apiKey'] ?? '').toString().isEmpty) errs.add('apiKey is required');
    return errs;
  }

  @override
  Map<String, dynamic> toServiceConfig(Provider p) {
    final s = _jsonDecode(p.settingsJson);
    return {
      'baseUrl': s['proxyUrl'] ?? s['defaultProxyUrl'],
      'headers': {
        'Authorization': 'Bearer ${s['apiKey'] ?? ''}',
      },
    };
  }

  @override
  ModelFetchSpec modelFetchSpec() => const ModelFetchSpec(endpoint: '/models', method: 'GET', pathSelectors: ['data', 'id']);

  Map<String, dynamic> _jsonDecode(String source) {
    if (source.isEmpty) return <String, dynamic>{};
    try {
      return (jsonDecode(source) as Map).cast<String, dynamic>();
    } catch (_) {
      return <String, dynamic>{};
    }
  }
}
