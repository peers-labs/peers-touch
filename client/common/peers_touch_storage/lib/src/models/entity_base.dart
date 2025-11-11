import 'package:equatable/equatable.dart';
import 'package:meta/meta.dart';

/// Base interface for data entities
abstract class DataEntity extends Equatable {
  const DataEntity();
  String? get id;
  DateTime? get createdAt;
  DateTime? get updatedAt;
  int? get version;

  Map<String, dynamic> toMap();

  @override
  List<Object?> get props => [id, createdAt, updatedAt, version];
}

/// Sync status for syncable entities
enum SyncStatus { pending, synced, failed }

/// Interface for entities that participate in sync
abstract class SyncableEntity implements DataEntity {
  SyncStatus get syncStatus;
  DateTime? get lastSyncedAt;
  String? get syncError;
}

/// A simple base implementation of DataEntity
@immutable
class BaseEntity extends DataEntity {
  @override
  final String? id;
  @override
  final DateTime? createdAt;
  @override
  final DateTime? updatedAt;
  @override
  final int? version;

  const BaseEntity({
    this.id,
    this.createdAt,
    this.updatedAt,
    this.version,
  });

  @override
  Map<String, dynamic> toMap() {
    return {
      'id': id,
      'createdAt': createdAt?.toIso8601String(),
      'updatedAt': updatedAt?.toIso8601String(),
      'version': version,
    };
  }
}

/// Base implementation of SyncableEntity
@immutable
class BaseSyncableEntity extends BaseEntity implements SyncableEntity {
  @override
  final SyncStatus syncStatus;
  @override
  final DateTime? lastSyncedAt;
  @override
  final String? syncError;

  const BaseSyncableEntity({
    String? id,
    DateTime? createdAt,
    DateTime? updatedAt,
    int? version,
    this.syncStatus = SyncStatus.pending,
    this.lastSyncedAt,
    this.syncError,
  }) : super(
          id: id,
          createdAt: createdAt,
          updatedAt: updatedAt,
          version: version,
        );

  BaseSyncableEntity copyWith({
    String? id,
    DateTime? createdAt,
    DateTime? updatedAt,
    int? version,
    SyncStatus? syncStatus,
    DateTime? lastSyncedAt,
    String? syncError,
  }) {
    return BaseSyncableEntity(
      id: id ?? this.id,
      createdAt: createdAt ?? this.createdAt,
      updatedAt: updatedAt ?? this.updatedAt,
      version: version ?? this.version,
      syncStatus: syncStatus ?? this.syncStatus,
      lastSyncedAt: lastSyncedAt ?? this.lastSyncedAt,
      syncError: syncError ?? this.syncError,
    );
  }

  @override
  Map<String, dynamic> toMap() {
    final map = super.toMap();
    map.addAll({
      'syncStatus': syncStatus.name,
      'lastSyncedAt': lastSyncedAt?.toIso8601String(),
      'syncError': syncError,
    });
    return map;
  }

  static SyncStatus parseSyncStatus(String? status) {
    switch (status) {
      case 'synced':
        return SyncStatus.synced;
      case 'failed':
        return SyncStatus.failed;
      case 'pending':
      default:
        return SyncStatus.pending;
    }
  }
}