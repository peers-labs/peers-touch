import 'dart:convert';
import 'package:peers_touch_base/model/domain/ai_box/provider.pb.dart';

abstract class AIProviderTemplate {
  String get id;
  String get displayName;
  String get baseServiceType;

  Map<String, dynamic> defaultSettings();
  Map<String, dynamic> defaultConfig();

  List<FieldSpec> fieldSchema();

  List<String> validate(Provider p);

  Provider applyDefaults(Provider p) {
    final settings = _jsonMerge(_jsonDecode(p.settingsJson), defaultSettings());
    final config = _jsonMerge(_jsonDecode(p.configJson), defaultConfig());
    return (p.deepCopy() as Provider)
      ..settingsJson = _jsonEncode(settings)
      ..configJson = _jsonEncode(config);
  }

  Map<String, dynamic> toServiceConfig(Provider p);

  ModelFetchSpec modelFetchSpec();

  Map<String, dynamic> _jsonDecode(String source) {
    if (source.isEmpty) return <String, dynamic>{};
    try {
      return (jsonDecode(source) as Map).cast<String, dynamic>();
    } catch (_) {
      return <String, dynamic>{};
    }
  }

  String _jsonEncode(Map<String, dynamic> map) => jsonEncode(map);

  Map<String, dynamic> _jsonMerge(Map<String, dynamic> base, Map<String, dynamic> add) {
    final result = Map<String, dynamic>.from(base);
    add.forEach((k, v) {
      if (!result.containsKey(k) || result[k] == null || (result[k] is String && (result[k] as String).isEmpty)) {
        result[k] = v;
      }
    });
    return result;
  }
}

class FieldSpec {
  final String key;
  final String label;
  final String? placeholder;
  final bool editable;
  final bool obscure;
  const FieldSpec({required this.key, required this.label, this.placeholder, this.editable = true, this.obscure = false});
}

class ModelFetchSpec {
  final String endpoint;
  final String method;
  final List<String> pathSelectors;
  const ModelFetchSpec({required this.endpoint, this.method = 'GET', this.pathSelectors = const []});
}
