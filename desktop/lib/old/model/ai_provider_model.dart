import 'dart:convert';

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
      name: json['name'] ?? json['display_name'] ?? json['id'] ?? '',
      displayName: json['display_name'] ?? json['name'] ?? '',
      enabled: json['enabled'] ?? false,
      description: json['description'] ?? '',
      logo: json['logo'] ?? '',
      sort: json['sort'] ?? 0,
      config: ProviderConfig.fromJson(json['config'] ?? {}),
      createdAt: _dateTimeFromTimestamp(json['created_at']) ?? DateTime.now().toUtc(),
      updatedAt: _dateTimeFromTimestamp(json['updated_at']) ?? DateTime.now().toUtc(),
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

DateTime? _dateTimeFromTimestamp(dynamic timestamp) {
  if (timestamp is Map<String, dynamic>) {
    final seconds = timestamp['seconds'] as int? ?? 0;
    final nanos = timestamp['nanos'] as int? ?? 0;
    if (seconds == 0 && nanos == 0) return null;
    final milliseconds = seconds * 1000 + (nanos / 1000000).round();
    return DateTime.fromMillisecondsSinceEpoch(milliseconds, isUtc: true);
  } else if (timestamp is String) {
    return DateTime.tryParse(timestamp)?.toUtc();
  }
  return null;
}

class ProviderConfig {
  final String? apiKey;
  final String endpoint;
  final String proxyUrl;
  final int timeout;
  final int maxRetries;

  ProviderConfig({
    this.apiKey,
    required this.endpoint,
    required this.proxyUrl,
    required this.timeout,
    required this.maxRetries,
  });

  factory ProviderConfig.fromJson(dynamic json) {
    // 后端可能返回字符串形式的 JSON，或直接返回对象
    Map<String, dynamic> map;
    if (json is String) {
      try {
        map = (json.isEmpty ? {} : (jsonDecode(json) as Map<String, dynamic>));
      } catch (_) {
        map = {};
      }
    } else if (json is Map<String, dynamic>) {
      map = json;
    } else {
      map = {};
    }

    return ProviderConfig(
      apiKey: map['api_key'],
      endpoint: map['endpoint'] ?? '',
      proxyUrl: map['proxy_url'] ?? '',
      timeout: map['timeout'] ?? 30,
      maxRetries: map['max_retries'] ?? 3,
    );
  }

  Map<String, dynamic> toJson() {
    return {
      'api_key': apiKey,
      'endpoint': endpoint.isEmpty ? null : endpoint,
      'proxy_url': proxyUrl.isEmpty ? null : proxyUrl,
      'timeout': timeout,
      'max_retries': maxRetries,
    };
  }

  ProviderConfig copyWith({
    String? apiKey,
    String? endpoint,
    String? proxyUrl,
    int? timeout,
    int? maxRetries,
  }) {
    return ProviderConfig(
      apiKey: apiKey ?? this.apiKey,
      endpoint: endpoint ?? this.endpoint,
      proxyUrl: proxyUrl ?? this.proxyUrl,
      timeout: timeout ?? this.timeout,
      maxRetries: maxRetries ?? this.maxRetries,
    );
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
    // 兼容两种结构：
    // 1) { total, providers: [...] }
    // 2) { total, list: [...] } 或包裹在 data 中
    final root = (json['data'] is Map<String, dynamic>)
        ? json['data'] as Map<String, dynamic>
        : json;

    final list = (root['providers'] ?? root['list']) as List<dynamic>?;

    return ListProvidersResponse(
      providers: list
              ?.map((item) => AiProvider.fromJson(item as Map<String, dynamic>))
              .toList() ??
          [],
      total: (root['total'] as num?)?.toInt() ?? 0,
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
      ok: json['ok'] ?? json['success'] ?? false,
      message: json['message'] ?? json['msg'] ?? '',
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
  final ProviderConfig? config;

  UpdateProviderRequest({
    required this.id,
    this.displayName,
    this.description,
    this.logo,
    this.enabled,
    this.config,
  });

  Map<String, dynamic> toJson() {
    final Map<String, dynamic> json = {'id': id};
    if (displayName != null) json['display_name'] = displayName;
    if (description != null) json['description'] = description;
    if (logo != null) json['logo'] = logo;
    if (enabled != null) json['enabled'] = enabled;
    if (config != null) json['config'] = config!.toJson();
    return json;
  }
}