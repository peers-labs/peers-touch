class AiProvider {
  final String id;
  final String name;
  final String displayName;
  final bool enabled;
  final String description;
  final String logo;
  final int sort;
  final ProviderConfig config;
  final DateTime createdAt;
  final DateTime updatedAt;

  AiProvider({
    required this.id,
    required this.name,
    required this.displayName,
    required this.enabled,
    required this.description,
    required this.logo,
    required this.sort,
    required this.config,
    required this.createdAt,
    required this.updatedAt,
  });

  factory AiProvider.fromJson(Map<String, dynamic> json) {
    return AiProvider(
      id: json['id'] ?? '',
      name: json['name'] ?? '',
      displayName: json['display_name'] ?? json['name'] ?? '',
      enabled: json['enabled'] ?? false,
      description: json['description'] ?? '',
      logo: json['logo'] ?? '',
      sort: json['sort'] ?? 0,
      config: ProviderConfig.fromJson(json['config'] ?? {}),
      createdAt: DateTime.parse(json['created_at'] ?? DateTime.now().toIso8601String()),
      updatedAt: DateTime.parse(json['updated_at'] ?? DateTime.now().toIso8601String()),
    );
  }

  Map<String, dynamic> toJson() {
    return {
      'id': id,
      'name': name,
      'display_name': displayName,
      'enabled': enabled,
      'description': description,
      'logo': logo,
      'sort': sort,
      'config': config.toJson(),
      'created_at': createdAt.toIso8601String(),
      'updated_at': updatedAt.toIso8601String(),
    };
  }

  AiProvider copyWith({
    String? id,
    String? name,
    String? displayName,
    bool? enabled,
    String? description,
    String? logo,
    int? sort,
    ProviderConfig? config,
    DateTime? createdAt,
    DateTime? updatedAt,
  }) {
    return AiProvider(
      id: id ?? this.id,
      name: name ?? this.name,
      displayName: displayName ?? this.displayName,
      enabled: enabled ?? this.enabled,
      description: description ?? this.description,
      logo: logo ?? this.logo,
      sort: sort ?? this.sort,
      config: config ?? this.config,
      createdAt: createdAt ?? this.createdAt,
      updatedAt: updatedAt ?? this.updatedAt,
    );
  }
}

class ProviderConfig {
  final String apiKey;
  final String endpoint;
  final String proxyUrl;
  final int timeout;
  final int maxRetries;

  ProviderConfig({
    required this.apiKey,
    required this.endpoint,
    required this.proxyUrl,
    required this.timeout,
    required this.maxRetries,
  });

  factory ProviderConfig.fromJson(Map<String, dynamic> json) {
    return ProviderConfig(
      apiKey: json['api_key'] ?? '',
      endpoint: json['endpoint'] ?? '',
      proxyUrl: json['proxy_url'] ?? '',
      timeout: json['timeout'] ?? 30,
      maxRetries: json['max_retries'] ?? 3,
    );
  }

  Map<String, dynamic> toJson() {
    return {
      'api_key': apiKey,
      'endpoint': endpoint,
      'proxy_url': proxyUrl,
      'timeout': timeout,
      'max_retries': maxRetries,
    };
  }
}

class ListProvidersResponse {
  final List<AiProvider> providers;
  final int total;

  ListProvidersResponse({
    required this.providers,
    required this.total,
  });

  factory ListProvidersResponse.fromJson(Map<String, dynamic> json) {
    return ListProvidersResponse(
      providers: (json['providers'] as List<dynamic>?)
          ?.map((item) => AiProvider.fromJson(item as Map<String, dynamic>))
          .toList() ?? [],
      total: json['total'] ?? 0,
    );
  }
}

class TestProviderResponse {
  final bool ok;
  final String message;

  TestProviderResponse({
    required this.ok,
    required this.message,
  });

  factory TestProviderResponse.fromJson(Map<String, dynamic> json) {
    return TestProviderResponse(
      ok: json['ok'] ?? false,
      message: json['message'] ?? '',
    );
  }
}

class CreateProviderRequest {
  final String name;
  final String description;
  final String logo;

  CreateProviderRequest({
    required this.name,
    required this.description,
    required this.logo,
  });

  Map<String, dynamic> toJson() {
    return {
      'name': name,
      'description': description,
      'logo': logo,
    };
  }
}

class UpdateProviderRequest {
  final String id;
  final String? displayName;
  final String? description;
  final String? logo;
  final bool? enabled;

  UpdateProviderRequest({
    required this.id,
    this.displayName,
    this.description,
    this.logo,
    this.enabled,
  });

  Map<String, dynamic> toJson() {
    final Map<String, dynamic> json = {'id': id};
    if (displayName != null) json['display_name'] = displayName;
    if (description != null) json['description'] = description;
    if (logo != null) json['logo'] = logo;
    if (enabled != null) json['enabled'] = enabled;
    return json;
  }
}