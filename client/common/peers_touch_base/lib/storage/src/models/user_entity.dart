import 'base.dart';

class User extends BaseSyncableEntity {
  final String? name;
  final String? email;
  final String? avatarUrl;
  final Map<String, dynamic>? metadata;

  const User({
    String? id,
    DateTime? createdAt,
    DateTime? updatedAt,
    int? version,
    SyncStatus syncStatus = SyncStatus.pending,
    DateTime? lastSyncedAt,
    String? syncError,
    this.name,
    this.email,
    this.avatarUrl,
    this.metadata,
  }) : super(
          id: id,
          createdAt: createdAt,
          updatedAt: updatedAt,
          version: version,
          syncStatus: syncStatus,
          lastSyncedAt: lastSyncedAt,
          syncError: syncError,
        );

  User copyWith({
    String? id,
    DateTime? createdAt,
    DateTime? updatedAt,
    int? version,
    SyncStatus? syncStatus,
    DateTime? lastSyncedAt,
    String? syncError,
    String? name,
    String? email,
    String? avatarUrl,
    Map<String, dynamic>? metadata,
  }) {
    return User(
      id: id ?? this.id,
      createdAt: createdAt ?? this.createdAt,
      updatedAt: updatedAt ?? this.updatedAt,
      version: version ?? this.version,
      syncStatus: syncStatus ?? this.syncStatus,
      lastSyncedAt: lastSyncedAt ?? this.lastSyncedAt,
      syncError: syncError ?? this.syncError,
      name: name ?? this.name,
      email: email ?? this.email,
      avatarUrl: avatarUrl ?? this.avatarUrl,
      metadata: metadata ?? this.metadata,
    );
  }

  @override
  Map<String, dynamic> toMap() {
    return {
      ...super.toMap(),
      'name': name,
      'email': email,
      'avatarUrl': avatarUrl,
      'metadata': metadata,
    };
  }

  static User fromMap(Map<String, dynamic> map) {
    return User(
      id: map['id'] as String?,
      createdAt: map['createdAt'] != null
          ? DateTime.parse(map['createdAt'] as String)
          : null,
      updatedAt: map['updatedAt'] != null
          ? DateTime.parse(map['updatedAt'] as String)
          : null,
      version: map['version'] as int?,
      syncStatus: BaseSyncableEntity.parseSyncStatus(map['syncStatus'] as String?),
      lastSyncedAt: map['lastSyncedAt'] != null
          ? DateTime.parse(map['lastSyncedAt'] as String)
          : null,
      syncError: map['syncError'] as String?,
      name: map['name'] as String?,
      email: map['email'] as String?,
      avatarUrl: map['avatarUrl'] as String?,
      metadata: (map['metadata'] as Map?)?.cast<String, dynamic>(),
    );
  }
}