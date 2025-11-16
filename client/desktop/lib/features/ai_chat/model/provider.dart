import 'package:get/get.dart';

/// AI服务提供商模型
class Provider {
  final String id;
  final String name;
  final String peersUserId;
  final int? sort;
  final bool enabled;
  final String? checkModel;
  final String? logo;
  final String? description;
  final String? keyVaults;
  final String sourceType;
  final Map<String, dynamic>? settings;
  final Map<String, dynamic>? config;
  final DateTime accessedAt;
  final DateTime createdAt;
  final DateTime updatedAt;

  Provider({
    required this.id,
    required this.name,
    required this.peersUserId,
    this.sort,
    this.enabled = true,
    this.checkModel,
    this.logo,
    this.description,
    this.keyVaults,
    required this.sourceType,
    this.settings,
    this.config,
    required this.accessedAt,
    required this.createdAt,
    required this.updatedAt,
  });

  factory Provider.fromJson(Map<String, dynamic> json) {
    return Provider(
      id: json['id'] ?? '',
      name: json['name'] ?? '',
      peersUserId: json['peersUserId'] ?? '',
      sort: json['sort'],
      enabled: json['enabled'] ?? true,
      checkModel: json['checkModel'],
      logo: json['logo'],
      description: json['description'],
      keyVaults: json['keyVaults'],
      sourceType: json['sourceType'] ?? '',
      settings: json['settings'] != null ? Map<String, dynamic>.from(json['settings']) : null,
      config: json['config'] != null ? Map<String, dynamic>.from(json['config']) : null,
      accessedAt: json['accessedAt'] != null ? DateTime.parse(json['accessedAt']) : DateTime.now(),
      createdAt: json['createdAt'] != null ? DateTime.parse(json['createdAt']) : DateTime.now(),
      updatedAt: json['updatedAt'] != null ? DateTime.parse(json['updatedAt']) : DateTime.now(),
    );
  }

  Map<String, dynamic> toJson() {
    return {
      'id': id,
      'name': name,
      'peersUserId': peersUserId,
      'sort': sort,
      'enabled': enabled,
      'checkModel': checkModel,
      'logo': logo,
      'description': description,
      'keyVaults': keyVaults,
      'sourceType': sourceType,
      'settings': settings,
      'config': config,
      'accessedAt': accessedAt.toIso8601String(),
      'createdAt': createdAt.toIso8601String(),
      'updatedAt': updatedAt.toIso8601String(),
    };
  }

  /// 获取API密钥（解密）
  String? get apiKey {
    // TODO: 实现密钥解密逻辑
    return keyVaults;
  }

  /// 获取基础URL
  String? get baseUrl => settings?['baseUrl'];

  /// 获取模型列表
  List<String> get models {
    final models = settings?['models'];
    if (models is List) {
      return models.cast<String>();
    }
    return [];
  }

  /// 创建副本
  Provider copyWith({
    String? id,
    String? name,
    String? peersUserId,
    int? sort,
    bool? enabled,
    String? checkModel,
    String? logo,
    String? description,
    String? keyVaults,
    String? sourceType,
    Map<String, dynamic>? settings,
    Map<String, dynamic>? config,
    DateTime? accessedAt,
    DateTime? createdAt,
    DateTime? updatedAt,
  }) {
    return Provider(
      id: id ?? this.id,
      name: name ?? this.name,
      peersUserId: peersUserId ?? this.peersUserId,
      sort: sort ?? this.sort,
      enabled: enabled ?? this.enabled,
      checkModel: checkModel ?? this.checkModel,
      logo: logo ?? this.logo,
      description: description ?? this.description,
      keyVaults: keyVaults ?? this.keyVaults,
      sourceType: sourceType ?? this.sourceType,
      settings: settings ?? this.settings,
      config: config ?? this.config,
      accessedAt: accessedAt ?? this.accessedAt,
      createdAt: createdAt ?? this.createdAt,
      updatedAt: updatedAt ?? this.updatedAt,
    );
  }
}