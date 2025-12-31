import 'dart:convert';

import 'package:peers_touch_base/ai_proxy/provider/template/ai_provider_template.dart';
import 'package:peers_touch_base/ai_proxy/provider/template/template_factory.dart';
import 'package:peers_touch_base/model/domain/ai_box/provider.pb.dart' as pb;
import 'package:peers_touch_base/model/google/protobuf/timestamp.pb.dart';

/// Typed wrapper around `pb.Provider` to avoid hard-coded map access.
/// Includes a concrete template instance and exposes typed settings/config.
class RichProviderV2 {

  RichProviderV2._(this.raw, this.template, this.settings, this.config);

  factory RichProviderV2.from(pb.Provider provider) {
    final tpl = AIProviderTemplateFactory.fromProvider(provider);
    final settings = ProviderSettingsV2.fromProvider(provider, tpl);
    final config = ProviderConfigV2.fromProvider(provider, tpl);
    return RichProviderV2._(provider, tpl, settings, config);
  }
  final pb.Provider raw;
  final AIProviderTemplate template;
  final ProviderSettingsV2 settings;
  final ProviderConfigV2 config;

  String get id => raw.id;
  String get name => raw.name;
  String get sourceType => raw.sourceType;
  bool get enabled => raw.enabled;

  /// Returns a copy of the underlying provider with updated settings.
  pb.Provider withSettings(ProviderSettingsV2 next) {
    return raw.rebuild((b) => b
      ..settingsJson = jsonEncode(next.toJson())
      ..updatedAt = Timestamp.fromDateTime(DateTime.now().toUtc()));
  }

  /// Returns a copy of the underlying provider with updated config.
  pb.Provider withConfig(ProviderConfigV2 next) {
    return raw.rebuild((b) => b
      ..configJson = jsonEncode(next.toJson())
      ..updatedAt = Timestamp.fromDateTime(DateTime.now().toUtc()));
  }

  /// Service configuration derived from the current template and settings.
  Map<String, dynamic> get serviceConfig {
    // Build a temporary provider reflecting current typed settings/config
    final merged = raw.rebuild((b) {
      b
        ..settingsJson = jsonEncode(settings.toJson())
        ..configJson = jsonEncode(config.toJson());
    });
    return template.toServiceConfig(merged);
  }

  /// Model fetching spec from the template.
  ModelFetchSpec get modelFetchSpec => template.modelFetchSpec();

  /// Validate current provider using template rules; returns list of error messages.
  List<String> validate() {
    final effective = raw.rebuild((b) => b..settingsJson = jsonEncode(settings.toJson()));
    return template.validate(effective);
  }
}

class ProviderSettingsV2 {

  const ProviderSettingsV2({
    required this.requestFormat,
    required this.proxyUrl,
    required this.defaultProxyUrl,
    required this.apiKey,
    required this.checkModel,
    required this.models,
    required this.enabledModels,
  });

  factory ProviderSettingsV2.fromProvider(pb.Provider p, AIProviderTemplate tpl) {
    final s = _readJson(p.settingsJson);
    final c = _readJson(p.configJson);
    final defaults = tpl.defaultSettings();

    String rf = (s['requestFormat'] ?? p.sourceType ?? '').toString();
    if (rf.isEmpty) rf = (defaults['requestFormat'] ?? p.sourceType ?? 'openai').toString();

    String proxy = (s['proxyUrl'] ?? '').toString();
    String proxyDefault = (s['defaultProxyUrl'] ?? '').toString();
    if (proxy.isEmpty) {
      proxy = _sanitizeUrl((c['base_url'] ?? c['baseUrl'] ?? defaults['defaultProxyUrl'] ?? '').toString());
    }
    if (proxyDefault.isEmpty) {
      proxyDefault = _sanitizeUrl((defaults['defaultProxyUrl'] ?? proxy).toString());
    }

    final String key = (s['apiKey'] ?? s['api_key'] ?? c['api_key'] ?? '').toString();
    final String check = (s['checkModel'] ?? defaults['checkModel'] ?? '').toString();

    final models = List<String>.from((s['models'] ?? const <String>[]) as List);
    final enabled = List<String>.from((s['enabledModels'] ?? const <String>[]) as List);

    return ProviderSettingsV2(
      requestFormat: rf,
      proxyUrl: proxy,
      defaultProxyUrl: proxyDefault,
      apiKey: key,
      checkModel: check,
      models: models,
      enabledModels: enabled,
    );
  }
  final String requestFormat;
  final String proxyUrl;
  final String defaultProxyUrl;
  final String apiKey;
  final String checkModel;
  final List<String> models;
  final List<String> enabledModels;

  ProviderSettingsV2 copyWith({
    String? requestFormat,
    String? proxyUrl,
    String? defaultProxyUrl,
    String? apiKey,
    String? checkModel,
    List<String>? models,
    List<String>? enabledModels,
  }) {
    return ProviderSettingsV2(
      requestFormat: requestFormat ?? this.requestFormat,
      proxyUrl: proxyUrl ?? this.proxyUrl,
      defaultProxyUrl: defaultProxyUrl ?? this.defaultProxyUrl,
      apiKey: apiKey ?? this.apiKey,
      checkModel: checkModel ?? this.checkModel,
      models: models ?? this.models,
      enabledModels: enabledModels ?? this.enabledModels,
    );
  }

  Map<String, dynamic> toJson() => {
        'requestFormat': requestFormat,
        'proxyUrl': proxyUrl,
        'defaultProxyUrl': defaultProxyUrl,
        'apiKey': apiKey,
        'checkModel': checkModel,
        'models': models,
        'enabledModels': enabledModels,
      };
}

class ProviderConfigV2 {

  const ProviderConfigV2({
    required this.temperature,
    required this.maxTokens,
    required this.topP,
    required this.frequencyPenalty,
    required this.presencePenalty,
  });

  factory ProviderConfigV2.fromProvider(pb.Provider p, AIProviderTemplate tpl) {
    final c = _readJson(p.configJson);
    final defaults = tpl.defaultConfig();
    return ProviderConfigV2(
      temperature: _asDouble(c['temperature'] ?? defaults['temperature'] ?? 0.7),
      maxTokens: _asInt(c['maxTokens'] ?? defaults['maxTokens'] ?? 2048),
      topP: _asDouble(c['topP'] ?? defaults['topP'] ?? 1.0),
      frequencyPenalty: _asDouble(c['frequencyPenalty'] ?? defaults['frequencyPenalty'] ?? 0.0),
      presencePenalty: _asDouble(c['presencePenalty'] ?? defaults['presencePenalty'] ?? 0.0),
    );
  }
  final double temperature;
  final int maxTokens;
  final double topP;
  final double frequencyPenalty;
  final double presencePenalty;

  ProviderConfigV2 copyWith({
    double? temperature,
    int? maxTokens,
    double? topP,
    double? frequencyPenalty,
    double? presencePenalty,
  }) {
    return ProviderConfigV2(
      temperature: temperature ?? this.temperature,
      maxTokens: maxTokens ?? this.maxTokens,
      topP: topP ?? this.topP,
      frequencyPenalty: frequencyPenalty ?? this.frequencyPenalty,
      presencePenalty: presencePenalty ?? this.presencePenalty,
    );
  }

  Map<String, dynamic> toJson() => {
        'temperature': temperature,
        'maxTokens': maxTokens,
        'topP': topP,
        'frequencyPenalty': frequencyPenalty,
        'presencePenalty': presencePenalty,
      };
}

Map<String, dynamic> _readJson(String source) {
  if (source.isEmpty) return <String, dynamic>{};
  try {
    return (jsonDecode(source) as Map).cast<String, dynamic>();
  } catch (_) {
    return <String, dynamic>{};
  }
}

String _sanitizeUrl(String raw) {
  var s = raw.trim();
  if (s.startsWith('`') && s.endsWith('`')) {
    s = s.substring(1, s.length - 1);
  }
  s = s.replaceAll('`', '').trim();
  return s;
}

double _asDouble(dynamic v) {
  if (v is double) return v;
  if (v is int) return v.toDouble();
  return double.tryParse(v.toString()) ?? 0.0;
}

int _asInt(dynamic v) {
  if (v is int) return v;
  if (v is double) return v.toInt();
  return int.tryParse(v.toString()) ?? 0;
}
