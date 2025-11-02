import 'package:flutter/material.dart';

// Configuration field definition for dynamic provider settings
class ConfigField {
  final String name;
  final String type; // "string", "boolean", "number"
  final bool required;
  final String description;
  final String? envVar;
  final dynamic defaultValue;

  const ConfigField({
    required this.name,
    required this.type,
    required this.required,
    required this.description,
    this.envVar,
    this.defaultValue,
  });

  factory ConfigField.fromJson(Map<String, dynamic> json) {
    return ConfigField(
      name: json['name'] ?? '',
      type: json['type'] ?? 'string',
      required: json['required'] ?? false,
      description: json['description'] ?? '',
      envVar: json['env_var'],
      defaultValue: json['default'],
    );
  }

  Map<String, dynamic> toJson() {
    return {
      'name': name,
      'type': type,
      'required': required,
      'description': description,
      if (envVar != null) 'env_var': envVar,
      if (defaultValue != null) 'default': defaultValue,
    };
  }
}

class ModelInfo {
  final String id;
  final String name;
  final String provider;
  final String type; // "chat", "embedding", "image", "tts", "asr"
  final String description;
  final int maxTokens;
  final List<String> capabilities;
  final Map<String, double> pricing;
  final bool isActive;

  ModelInfo({
    required this.id,
    required this.name,
    required this.provider,
    required this.type,
    required this.description,
    required this.maxTokens,
    required this.capabilities,
    required this.pricing,
    required this.isActive,
  });

  factory ModelInfo.fromJson(Map<String, dynamic> json) {
    return ModelInfo(
      id: json['id'] ?? '',
      name: json['name'] ?? '',
      provider: json['provider'] ?? '',
      type: json['type'] ?? 'chat',
      description: json['description'] ?? '',
      maxTokens: json['max_tokens'] ?? 0,
      capabilities: List<String>.from(json['capabilities'] ?? []),
      pricing: Map<String, double>.from(
        (json['pricing'] as Map<String, dynamic>?)?.map(
          (key, value) => MapEntry(key, (value as num).toDouble()),
        ) ?? {},
      ),
      isActive: json['is_active'] ?? false,
    );
  }

  Map<String, dynamic> toJson() {
    return {
      'id': id,
      'name': name,
      'provider': provider,
      'type': type,
      'description': description,
      'max_tokens': maxTokens,
      'capabilities': capabilities,
      'pricing': pricing,
      'is_active': isActive,
    };
  }
}

class ProviderInfo {
  final String name;
  final String displayName;
  final bool enabled;
  final Map<String, dynamic> config;
  final List<ModelInfo> models;
  final String status; // "connected", "error", "unknown"
  final String? error;
  final List<ConfigField> configFields; // Dynamic configuration fields

  const ProviderInfo({
    required this.name,
    required this.displayName,
    required this.enabled,
    required this.config,
    required this.models,
    required this.status,
    this.error,
    this.configFields = const [],
  });

  factory ProviderInfo.fromJson(Map<String, dynamic> json) {
    return ProviderInfo(
      name: json['name'] ?? '',
      displayName: json['display_name'] ?? '',
      enabled: json['enabled'] ?? false,
      config: Map<String, dynamic>.from(json['config'] ?? {}),
      models: (json['models'] as List<dynamic>?)
          ?.map((model) => ModelInfo.fromJson(model as Map<String, dynamic>))
          .toList() ?? [],
      status: json['status'] ?? 'unknown',
      error: json['error'],
      configFields: (json['config_fields'] as List<dynamic>?)
          ?.map((field) => ConfigField.fromJson(field as Map<String, dynamic>))
          .toList() ?? [],
    );
  }

  Map<String, dynamic> toJson() {
    return {
      'name': name,
      'display_name': displayName,
      'enabled': enabled,
      'config': config,
      'models': models.map((model) => model.toJson()).toList(),
      'status': status,
      if (error != null) 'error': error,
      'config_fields': configFields.map((field) => field.toJson()).toList(),
    };
  }

  ProviderInfo copyWith({
    String? name,
    String? displayName,
    bool? enabled,
    Map<String, dynamic>? config,
    List<ModelInfo>? models,
    String? status,
    String? error,
    List<ConfigField>? configFields,
  }) {
    return ProviderInfo(
      name: name ?? this.name,
      displayName: displayName ?? this.displayName,
      enabled: enabled ?? this.enabled,
      config: config ?? this.config,
      models: models ?? this.models,
      status: status ?? this.status,
      error: error ?? this.error,
      configFields: configFields ?? this.configFields,
    );
  }
}

class AIProvider {
  final String id;
  final String name;
  final IconData icon;
  bool isEnabled;

  AIProvider({required this.id, required this.name, required this.icon, this.isEnabled = false});

  // Convert from ProviderInfo
  factory AIProvider.fromProviderInfo(ProviderInfo info) {
    return AIProvider(
      id: info.name,
      name: info.displayName,
      icon: _getIconForProvider(info.name),
      isEnabled: info.enabled,
    );
  }

  static IconData _getIconForProvider(String providerName) {
    switch (providerName.toLowerCase()) {
      case 'openai':
        return Icons.cloud_queue;
      case 'ollama':
        return Icons.memory;
      case 'google':
        return Icons.search;
      case 'anthropic':
        return Icons.psychology;
      case 'comfyui':
        return Icons.widgets;
      case 'moonshot':
        return Icons.rocket_launch;
      case 'fal':
        return Icons.flash_on;
      case 'bytedance-kimi2':
        return Icons.android;
      case 'azure_openai':
        return Icons.cloud;
      case 'azure_ai':
        return Icons.cloud_circle;
      case 'ollama_cloud':
        return Icons.cloud_upload;
      case 'vllm':
        return Icons.model_training;
      case 'xinference':
        return Icons.api;
      default:
        return Icons.smart_toy;
    }
  }

  AIProvider copyWith({
    String? id,
    String? name,
    IconData? icon,
    bool? isEnabled,
  }) {
    return AIProvider(
      id: id ?? this.id,
      name: name ?? this.name,
      icon: icon ?? this.icon,
      isEnabled: isEnabled ?? this.isEnabled,
    );
  }
}

class AIProviderSettings {
  String apiKey = '';
  String proxyUrl = '';
  bool useResponseApi = false;
  bool useClientRequest = false;
}