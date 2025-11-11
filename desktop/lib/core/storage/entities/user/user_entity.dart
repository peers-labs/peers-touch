// 用户数据实体
import '../base/entity_base.dart';

/// 用户数据实体
class UserEntity extends BaseSyncableEntity {
  /// 用户名
  final String name;
  
  /// 邮箱
  final String email;
  
  /// 头像URL
  final String? avatarUrl;
  
  /// 元数据
  final Map<String, dynamic> metadata;
  
  UserEntity({
    required super.id,
    required this.name,
    required this.email,
    this.avatarUrl,
    this.metadata = const {},
    super.createdAt,
    super.updatedAt,
    super.version,
    super.syncStatus,
    super.lastSyncedAt,
    super.syncError,
  });
  
  @override
  Map<String, dynamic> toMap() {
    return {
      'id': id,
      'name': name,
      'email': email,
      'avatarUrl': avatarUrl,
      'metadata': metadata,
      'createdAt': createdAt.millisecondsSinceEpoch,
      'updatedAt': updatedAt.millisecondsSinceEpoch,
      'version': version,
      'syncStatus': syncStatus.index,
      'lastSyncedAt': lastSyncedAt?.millisecondsSinceEpoch,
      'syncError': syncError,
    };
  }
  
  /// 从Map创建实例
  factory UserEntity.fromMap(Map<String, dynamic> map) {
    return UserEntity(
      id: map['id'],
      name: map['name'],
      email: map['email'],
      avatarUrl: map['avatarUrl'],
      metadata: Map<String, dynamic>.from(map['metadata'] ?? {}),
      createdAt: DateTime.fromMillisecondsSinceEpoch(map['createdAt']),
      updatedAt: DateTime.fromMillisecondsSinceEpoch(map['updatedAt']),
      version: map['version'],
      syncStatus: SyncStatus.values[map['syncStatus'] ?? 0],
      lastSyncedAt: map['lastSyncedAt'] != null 
          ? DateTime.fromMillisecondsSinceEpoch(map['lastSyncedAt'])
          : null,
      syncError: map['syncError'],
    );
  }
  
  @override
  UserEntity copyWith({
    String? id,
    String? name,
    String? email,
    String? avatarUrl,
    Map<String, dynamic>? metadata,
    DateTime? createdAt,
    DateTime? updatedAt,
    int? version,
    SyncStatus? syncStatus,
    DateTime? lastSyncedAt,
    String? syncError,
  }) {
    return UserEntity(
      id: id ?? this.id,
      name: name ?? this.name,
      email: email ?? this.email,
      avatarUrl: avatarUrl ?? this.avatarUrl,
      metadata: metadata ?? this.metadata,
      createdAt: createdAt ?? this.createdAt,
      updatedAt: updatedAt ?? DateTime.now(),
      version: version ?? this.version + 1,
      syncStatus: syncStatus ?? this.syncStatus,
      lastSyncedAt: lastSyncedAt ?? this.lastSyncedAt,
      syncError: syncError ?? this.syncError,
    );
  }
  
  /// 简化的复制方法
  UserEntity copyWithSimple({
    String? name,
    String? email,
    String? avatarUrl,
    Map<String, dynamic>? metadata,
  }) {
    return copyWith(
      name: name,
      email: email,
      avatarUrl: avatarUrl,
      metadata: metadata,
    );
  }
}