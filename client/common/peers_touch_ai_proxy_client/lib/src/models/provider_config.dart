/// AI 提供商类型
enum AIProviderType {
  openai,
  ollama,
  deepseek,
  claude,
  gemini,
}

/// 提供商配置
class ProviderConfig {
  final String id;
  final AIProviderType type;
  final String name;
  final String baseUrl;
  final String? apiKey;
  final Map<String, dynamic>? headers;
  final Map<String, dynamic>? parameters;
  final bool enabled;
  final int timeout;
  final int maxRetries;

  const ProviderConfig({
    required this.id,
    required this.type,
    required this.name,
    required this.baseUrl,
    this.apiKey,
    this.headers,
    this.parameters,
    this.enabled = true,
    this.timeout = 30000,
    this.maxRetries = 3,
  });

  Map<String, dynamic> toJson() {
    return {
      'id': id,
      'type': type.name,
      'name': name,
      'baseUrl': baseUrl,
      if (apiKey != null) 'apiKey': apiKey,
      if (headers != null) 'headers': headers,
      if (parameters != null) 'parameters': parameters,
      'enabled': enabled,
      'timeout': timeout,
      'maxRetries': maxRetries,
    };
  }

  factory ProviderConfig.fromJson(Map<String, dynamic> json) {
    return ProviderConfig(
      id: json['id'],
      type: AIProviderType.values.firstWhere(
        (e) => e.name == json['type'],
        orElse: () => AIProviderType.openai,
      ),
      name: json['name'],
      baseUrl: json['baseUrl'],
      apiKey: json['apiKey'],
      headers: json['headers'] != null ? Map<String, dynamic>.from(json['headers']) : null,
      parameters: json['parameters'] != null ? Map<String, dynamic>.from(json['parameters']) : null,
      enabled: json['enabled'] ?? true,
      timeout: json['timeout'] ?? 30000,
      maxRetries: json['maxRetries'] ?? 3,
    );
  }
}

/// 模型信息
class ModelInfo {
  final String id;
  final String name;
  final ProviderConfig provider;
  final Map<String, dynamic>? capabilities;

  const ModelInfo({
    required this.id,
    required this.name,
    required this.provider,
    this.capabilities,
  });

  Map<String, dynamic> toJson() {
    return {
      'id': id,
      'name': name,
      'provider': provider.toJson(),
      if (capabilities != null) 'capabilities': capabilities,
    };
  }

  factory ModelInfo.fromJson(Map<String, dynamic> json) {
    return ModelInfo(
      id: json['id'],
      name: json['name'],
      provider: ProviderConfig.fromJson(json['provider']),
      capabilities: json['capabilities'],
    );
  }
}