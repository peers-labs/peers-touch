import 'dart:async';
import 'dart:convert';
import 'dart:io';
import 'package:path/path.dart' as path;
import 'package:sqflite/sqflite.dart';
import 'package:http/http.dart' as http;
import 'package:crypto/crypto.dart';
import 'package:peers_touch_mobile/store/base_store.dart';
import 'package:peers_touch_mobile/model/photo_model.dart';
import 'package:peers_touch_mobile/common/logger/logger.dart';

/// Photo data model for local storage
class PhotoData implements Storable {
  @override
  final String id;
  final String path;
  final String? albumId;
  @override
  final DateTime createdAt;
  @override
  final DateTime updatedAt;
  final Map<String, dynamic>? metadata;
  final bool isDeleted;
  final DateTime? deletedAt;
  @override
  final SyncStatus syncStatus;
  @override
  final String? targetServerId;
  final String? localPath;
  final int? fileSize;
  final String? checksum;

  PhotoData({
    required this.id,
    required this.path,
    this.albumId,
    required this.createdAt,
    DateTime? updatedAt,
    this.metadata,
    this.isDeleted = false,
    this.deletedAt,
    SyncStatus? syncStatus,
    this.targetServerId,
    this.localPath,
    this.fileSize,
    this.checksum,
  }) : updatedAt = updatedAt ?? createdAt,
       syncStatus = syncStatus ?? SyncStatus.localOnly;

  /// Check if this photo needs to be synced to any server
  bool get needsSync {
    return syncStatus == SyncStatus.localOnly || syncStatus == SyncStatus.syncFailed;
  }

  // Storable interface implementation - no need for override since properties match

  @override
  Map<String, dynamic> toJson() {
    return {
      'id': id,
      'path': path,
      'albumId': albumId,
      'createdAt': createdAt.toIso8601String(),
      'updatedAt': updatedAt.toIso8601String(),
      'metadata': metadata,
      'isDeleted': isDeleted,
      'deletedAt': deletedAt?.toIso8601String(),
      'syncStatus': syncStatus.toString(),
      'targetServerId': targetServerId,
      'localPath': localPath,
      'fileSize': fileSize,
      'checksum': checksum,
    };
  }

  factory PhotoData.fromJson(Map<String, dynamic> json) {
    SyncStatus parsedSyncStatus = SyncStatus.localOnly;
    if (json['syncStatus'] != null) {
      final syncStatusStr = json['syncStatus'].toString();
      parsedSyncStatus = SyncStatus.values.firstWhere(
        (status) => status.toString() == syncStatusStr,
        orElse: () => SyncStatus.localOnly,
      );
    }
    
    return PhotoData(
      id: json['id'],
      path: json['path'],
      albumId: json['albumId'],
      createdAt: DateTime.parse(json['createdAt']),
      updatedAt:
          json['updatedAt'] != null
              ? DateTime.parse(json['updatedAt'])
              : DateTime.parse(json['createdAt']),
      metadata: json['metadata'],
      isDeleted: json['isDeleted'] ?? false,
      deletedAt:
          json['deletedAt'] != null ? DateTime.parse(json['deletedAt']) : null,
      syncStatus: parsedSyncStatus,
      targetServerId: json['targetServerId'],
      localPath: json['localPath'],
      fileSize: json['fileSize'],
      checksum: json['checksum'],
    );
  }

  PhotoData copyWith({
    String? id,
    String? path,
    String? albumId,
    DateTime? createdAt,
    DateTime? updatedAt,
    Map<String, dynamic>? metadata,
    bool? isDeleted,
    DateTime? deletedAt,
    SyncStatus? syncStatus,
    String? targetServerId,
    String? localPath,
    int? fileSize,
    String? checksum,
  }) {
    return PhotoData(
      id: id ?? this.id,
      path: path ?? this.path,
      albumId: albumId ?? this.albumId,
      createdAt: createdAt ?? this.createdAt,
      updatedAt: updatedAt ?? this.updatedAt,
      metadata: metadata ?? this.metadata,
      isDeleted: isDeleted ?? this.isDeleted,
      deletedAt: deletedAt ?? this.deletedAt,
      syncStatus: syncStatus ?? this.syncStatus,
      targetServerId: targetServerId ?? this.targetServerId,
      localPath: localPath ?? this.localPath,
      fileSize: fileSize ?? this.fileSize,
      checksum: checksum ?? this.checksum,
    );
  }

  /// Convert to PhotoModel for compatibility with existing code
  PhotoModel toPhotoModel() {
    return PhotoModel(id: int.tryParse(id) ?? 0, path: localPath ?? path);
  }

  /// Create from PhotoModel
  static PhotoData fromPhotoModel(PhotoModel model, {String? albumId}) {
    return PhotoData(
      id: model.id.toString(),
      path: model.path,
      albumId: albumId,
      createdAt: DateTime.now(),
      localPath: model.path,
    );
  }
}

/// Photo store implementation
class PhotoStore implements BaseStore<PhotoData> {
  static const String _tableName = 'photos';
  static const String _dbName = 'photos.db';
  static const int _dbVersion = 2;

  Database? _database;
  List<ServerConfig> _serverConfigs = [];

  @override
  String get storeName => 'PhotoStore';

  @override
  List<ServerConfig> get serverConfigs => _serverConfigs;

  @override
  Stream<NetworkStatus> get networkStatusStream =>
      Stream.value(NetworkStatus.unknown);

  @override
  Stream<SyncStatus> get syncStatusStream => Stream.value(SyncStatus.localOnly);

  PhotoStore();

  @override
  Future<void> initialize() async {
    await _initializeDatabase();
  }

  /// Initialize SQLite database
  Future<void> _initializeDatabase() async {
    final dbPath = await getDatabasesPath();
    final fullPath = path.join(dbPath, _dbName);

    _database = await openDatabase(
      fullPath,
      version: _dbVersion,
      onCreate: _createDatabase,
      onUpgrade: _upgradeDatabase,
    );

    appLogger.info('Photo database initialized at: $fullPath');
  }

  /// Create database tables
  Future<void> _createDatabase(Database db, int version) async {
    await db.execute('''
      CREATE TABLE $_tableName (
        id TEXT PRIMARY KEY,
        path TEXT NOT NULL,
        albumId TEXT,
        createdAt TEXT NOT NULL,
        updatedAt TEXT NOT NULL,
        metadata TEXT,
        isDeleted INTEGER NOT NULL DEFAULT 0,
        deletedAt TEXT,
        syncStatus TEXT NOT NULL DEFAULT 'SyncStatus.localOnly',
        targetServerId TEXT,
        localPath TEXT,
        fileSize INTEGER,
        checksum TEXT
      )
    ''');

    // Create indexes for better performance
    await db.execute('CREATE INDEX idx_photos_albumId ON $_tableName(albumId)');
    await db.execute(
      'CREATE INDEX idx_photos_createdAt ON $_tableName(createdAt)',
    );
    await db.execute(
      'CREATE INDEX idx_photos_isDeleted ON $_tableName(isDeleted)',
    );
  }

  /// Upgrade database schema
  Future<void> _upgradeDatabase(
    Database db,
    int oldVersion,
    int newVersion,
  ) async {
    if (oldVersion < 2) {
      // Add new columns for version 2
      await db.execute('ALTER TABLE $_tableName ADD COLUMN updatedAt TEXT');
      await db.execute(
        'ALTER TABLE $_tableName ADD COLUMN targetServerId TEXT',
      );

      // Update existing records to set updatedAt = createdAt
      await db.execute(
        'UPDATE $_tableName SET updatedAt = createdAt WHERE updatedAt IS NULL',
      );

      // Rename modifiedAt to updatedAt (SQLite doesn't support RENAME COLUMN directly)
      await db.execute(
        'UPDATE $_tableName SET updatedAt = modifiedAt WHERE modifiedAt IS NOT NULL',
      );

      // Update syncStatus format from old Map format to single enum
      await db.execute(
        "UPDATE $_tableName SET syncStatus = 'SyncStatus.localOnly' WHERE syncStatus IS NULL OR syncStatus = '{}'",
      );
    }
    appLogger.info('Upgrading photo database from $oldVersion to $newVersion');
  }

  Future<void> saveLocally(PhotoData item) async {
    if (_database == null) {
      throw Exception('Database not initialized');
    }

    try {
      // Calculate checksum if file exists
      String? checksum;
      int? fileSize;
      if (item.localPath != null && File(item.localPath!).existsSync()) {
        final file = File(item.localPath!);
        fileSize = await file.length();
        final bytes = await file.readAsBytes();
        checksum = sha256.convert(bytes).toString();
      }

      final updatedItem = item.copyWith(
        updatedAt: DateTime.now(),
        fileSize: fileSize,
        checksum: checksum,
      );

      await _database!.insert(_tableName, {
        'id': updatedItem.id,
        'path': updatedItem.path,
        'albumId': updatedItem.albumId,
        'createdAt': updatedItem.createdAt.toIso8601String(),
        'updatedAt': updatedItem.updatedAt.toIso8601String(),
        'metadata':
            updatedItem.metadata != null
                ? jsonEncode(updatedItem.metadata)
                : null,
        'isDeleted': updatedItem.isDeleted ? 1 : 0,
        'deletedAt': updatedItem.deletedAt?.toIso8601String(),
        'syncStatus': updatedItem.syncStatus.toString(),
        'localPath': updatedItem.localPath,
        'fileSize': updatedItem.fileSize,
        'checksum': updatedItem.checksum,
      }, conflictAlgorithm: ConflictAlgorithm.replace);

      appLogger.info('Photo saved locally: ${updatedItem.id}');
    } catch (e) {
      appLogger.error('Error saving photo locally: $e');
      rethrow;
    }
  }

  Future<PhotoData?> getById(String id) async {
    if (_database == null) return null;

    try {
      final results = await _database!.query(
        _tableName,
        where: 'id = ? AND isDeleted = 0',
        whereArgs: [id],
        limit: 1,
      );

      if (results.isEmpty) return null;

      return _photoDataFromMap(results.first);
    } catch (e) {
      appLogger.error('Error getting photo by id: $e');
      return null;
    }
  }

  Future<List<PhotoData>> getAll() async {
    if (_database == null) return [];

    try {
      final results = await _database!.query(
        _tableName,
        where: 'isDeleted = 0',
        orderBy: 'createdAt DESC',
      );

      return results.map(_photoDataFromMap).toList();
    } catch (e) {
      appLogger.error('Error getting all photos: $e');
      return [];
    }
  }

  Future<List<PhotoData>> getPendingSync() async {
    if (_database == null) return [];

    try {
      final results = await _database!.query(
        _tableName,
        where: 'isDeleted = 0',
      );

      final photos = results.map(_photoDataFromMap).toList();
      return photos.where((photo) => photo.needsSync).toList();
    } catch (e) {
      appLogger.error('Error getting pending sync photos: $e');
      return [];
    }
  }

  Future<void> deleteLocally(String id) async {
    if (_database == null) return;

    try {
      await _database!.update(
        _tableName,
        {
          'isDeleted': 1,
          'deletedAt': DateTime.now().toIso8601String(),
          'updatedAt': DateTime.now().toIso8601String(),
        },
        where: 'id = ?',
        whereArgs: [id],
      );

      appLogger.info('Photo marked as deleted locally: $id');
    } catch (e) {
      appLogger.error('Error deleting photo locally: $e');
      rethrow;
    }
  }

  Future<SyncResult> syncToServer(
    ServerConfig server,
    List<PhotoData> items,
  ) async {
    int syncedCount = 0;
    int failedCount = 0;
    String? lastError;

    for (final photo in items) {
      try {
        // Upload photo file if it exists locally
        if (photo.localPath != null && File(photo.localPath!).existsSync()) {
          final uploadResult = await _uploadPhotoFile(server, photo);
          if (!uploadResult) {
            failedCount++;
            continue;
          }
        }

        // Sync photo metadata
        final success = await _syncPhotoMetadata(server, photo);
        if (success) {
          syncedCount++;

          // Update sync status
          await _updateSyncStatus(photo.id, SyncStatus.synced);
        } else {
          failedCount++;
          await _updateSyncStatus(photo.id, SyncStatus.syncFailed);
        }
      } catch (e) {
        failedCount++;
        lastError = e.toString();
        await _updateSyncStatus(photo.id, SyncStatus.syncFailed);
        appLogger.error(
          'Error syncing photo ${photo.id} to ${server.name}: $e',
        );
      }
    }

    return SyncResult(
      success: failedCount == 0,
      error: lastError,
      syncedCount: syncedCount,
      failedCount: failedCount,
      timestamp: DateTime.now(),
    );
  }

  Future<SyncResult> syncFromServer(ServerConfig server) async {
    try {
      final response = await http
          .get(
            Uri.parse('${server.baseUrl}/photos'),
            headers: {
              'Authorization': 'Bearer ${server.apiKey}',
              'Content-Type': 'application/json',
            },
          )
          .timeout(const Duration(seconds: 30));

      if (response.statusCode == 200) {
        final data = jsonDecode(response.body);
        final serverPhotos =
            (data['photos'] as List)
                .map((json) => _photoDataFromServerJson(json))
                .toList();

        int syncedCount = 0;
        int failedCount = 0;

        for (final serverPhoto in serverPhotos) {
          try {
            final localPhoto = await getById(serverPhoto.id);

            if (localPhoto == null ||
                serverPhoto.updatedAt.isAfter(localPhoto.updatedAt)) {
              await saveLocally(serverPhoto);
              syncedCount++;
            }
          } catch (e) {
            failedCount++;
            appLogger.error('Error syncing photo from server: $e');
          }
        }

        return SyncResult(
          success: true,
          syncedCount: syncedCount,
          failedCount: failedCount,
          timestamp: DateTime.now(),
        );
      } else {
        throw Exception(
          'Server returned ${response.statusCode}: ${response.body}',
        );
      }
    } catch (e) {
      appLogger.error('Error syncing from server ${server.name}: $e');
      return SyncResult(
        success: false,
        error: e.toString(),
        syncedCount: 0,
        failedCount: 1,
        timestamp: DateTime.now(),
      );
    }
  }

  /// Upload photo file to server
  Future<bool> _uploadPhotoFile(ServerConfig server, PhotoData photo) async {
    if (photo.localPath == null || !File(photo.localPath!).existsSync()) {
      return false;
    }

    try {
      final file = File(photo.localPath!);
      final request = http.MultipartRequest(
        'POST',
        Uri.parse('${server.baseUrl}/photos/${photo.id}/upload'),
      );

      request.headers['Authorization'] = 'Bearer ${server.apiKey}';
      request.files.add(
        await http.MultipartFile.fromPath(
          'file',
          file.path,
          filename: path.basename(file.path),
        ),
      );

      final response = await request.send().timeout(const Duration(minutes: 5));
      return response.statusCode == 200;
    } catch (e) {
      appLogger.error('Error uploading photo file: $e');
      return false;
    }
  }

  /// Sync photo metadata to server
  Future<bool> _syncPhotoMetadata(ServerConfig server, PhotoData photo) async {
    try {
      final response = await http
          .put(
            Uri.parse('${server.baseUrl}/photos/${photo.id}'),
            headers: {
              'Authorization': 'Bearer ${server.apiKey}',
              'Content-Type': 'application/json',
            },
            body: jsonEncode(photo.toJson()),
          )
          .timeout(const Duration(seconds: 30));

      return response.statusCode == 200;
    } catch (e) {
      appLogger.error('Error syncing photo metadata: $e');
      return false;
    }
  }

  /// Update sync status for a photo
  Future<void> _updateSyncStatus(
    String photoId,
    SyncStatus status,
  ) async {
    if (_database == null) return;

    try {
      await _database!.update(
        _tableName,
        {
          'syncStatus': status.toString(),
          'updatedAt': DateTime.now().toIso8601String(),
        },
        where: 'id = ?',
        whereArgs: [photoId],
      );
    } catch (e) {
      appLogger.error('Error updating sync status: $e');
    }
  }

  /// Convert database map to PhotoData
  PhotoData _photoDataFromMap(Map<String, dynamic> map) {
    return PhotoData(
      id: map['id'],
      path: map['path'],
      albumId: map['albumId'],
      createdAt: DateTime.parse(map['createdAt']),
      updatedAt:
          map['updatedAt'] != null ? DateTime.parse(map['updatedAt']) : null,
      metadata: map['metadata'] != null ? jsonDecode(map['metadata']) : null,
      isDeleted: map['isDeleted'] == 1,
      deletedAt:
          map['deletedAt'] != null ? DateTime.parse(map['deletedAt']) : null,
      syncStatus:
          map['syncStatus'] != null
              ? SyncStatus.values.firstWhere(
                  (status) => status.toString() == map['syncStatus'],
                  orElse: () => SyncStatus.localOnly,
                )
              : SyncStatus.localOnly,
      localPath: map['localPath'],
      fileSize: map['fileSize'],
      checksum: map['checksum'],
    );
  }

  /// Convert server JSON to PhotoData
  PhotoData _photoDataFromServerJson(Map<String, dynamic> json) {
    return PhotoData(
      id: json['id'],
      path: json['path'],
      albumId: json['albumId'],
      createdAt: DateTime.parse(json['createdAt']),
      updatedAt:
          json['updatedAt'] != null ? DateTime.parse(json['updatedAt']) : null,
      metadata: json['metadata'],
      isDeleted: json['isDeleted'] ?? false,
      deletedAt:
          json['deletedAt'] != null ? DateTime.parse(json['deletedAt']) : null,
    );
  }

  /// Get photos by album
  Future<List<PhotoData>> getPhotosByAlbum(String albumId) async {
    if (_database == null) return [];

    try {
      final results = await _database!.query(
        _tableName,
        where: 'albumId = ? AND isDeleted = 0',
        whereArgs: [albumId],
        orderBy: 'createdAt DESC',
      );

      return results.map(_photoDataFromMap).toList();
    } catch (e) {
      appLogger.error('Error getting photos by album: $e');
      return [];
    }
  }

  /// Get recent photos
  Future<List<PhotoData>> getRecentPhotos({int limit = 50}) async {
    if (_database == null) return [];

    try {
      final results = await _database!.query(
        _tableName,
        where: 'isDeleted = 0',
        orderBy: 'createdAt DESC',
        limit: limit,
      );

      return results.map(_photoDataFromMap).toList();
    } catch (e) {
      appLogger.error('Error getting recent photos: $e');
      return [];
    }
  }

  /// Search photos by metadata
  Future<List<PhotoData>> searchPhotos(String query) async {
    if (_database == null) return [];

    try {
      final results = await _database!.query(
        _tableName,
        where: 'isDeleted = 0 AND (path LIKE ? OR metadata LIKE ?)',
        whereArgs: ['%$query%', '%$query%'],
        orderBy: 'createdAt DESC',
      );

      return results.map(_photoDataFromMap).toList();
    } catch (e) {
      appLogger.error('Error searching photos: $e');
      return [];
    }
  }

  // BaseStore method implementations
  @override
  Future<void> saveLocal(PhotoData item) async {
    await _insertOrUpdate(item);
  }

  @override
  Future<void> saveLocalBatch(List<PhotoData> items) async {
    for (final item in items) {
      await _insertOrUpdate(item);
    }
  }

  @override
  Future<PhotoData?> getLocal(String id) async {
    return await getById(id);
  }

  @override
  Future<List<PhotoData>> getAllLocal() async {
    return await getAll();
  }

  @override
  Future<List<PhotoData>> getLocalBySyncStatus(SyncStatus status) async {
    if (_database == null) return [];

    try {
      final List<Map<String, dynamic>> maps = await _database!.query(
        _tableName,
        where: 'syncStatus = ? AND isDeleted = ?',
        whereArgs: [status.toString(), 0],
      );

      return maps.map(_photoDataFromMap).toList();
    } catch (e) {
      appLogger.error('Error getting photos by sync status: $e');
      return [];
    }
  }

  @override
  Future<void> deleteLocal(String id) async {
    await remove(id);
  }

  @override
  Future<void> clearLocal() async {
    if (_database == null) return;

    try {
      await _database!.remove(_tableName);
      appLogger.info('Cleared all local photos');
    } catch (e) {
      appLogger.error('Error clearing local photos: $e');
    }
  }

  @override
  Future<SyncResult> syncToServers() async {
    // TODO: Implement sync to servers
    return SyncResult(
      success: true,
      syncedCount: 0,
      failedCount: 0,
      timestamp: DateTime.now(),
    );
  }

  @override
  Future<SyncResult> syncItem(String id) async {
    // TODO: Implement single item sync
    return SyncResult(
      success: true,
      syncedCount: 0,
      failedCount: 0,
      timestamp: DateTime.now(),
    );
  }

  @override
  Future<SyncResult> syncFromServers() async {
    // TODO: Implement sync from servers
    return SyncResult(
      success: true,
      syncedCount: 0,
      failedCount: 0,
      timestamp: DateTime.now(),
    );
  }

  @override
  Future<void> updateServerConfigs(List<ServerConfig> configs) async {
    _serverConfigs = configs;
  }

  @override
  Future<Map<String, bool>> checkServerConnectivity() async {
    // TODO: Implement server connectivity check
    return {};
  }

  @override
  Future<Map<String, int>> getSyncStats() async {
    // TODO: Implement sync statistics
    return {'total': 0, 'synced': 0, 'pending': 0, 'failed': 0};
  }

  // Missing methods implementation
  Future<void> remove(String id) async {
    final db = _database;
    if (db != null) {
      await db.remove(_tableName, where: 'id = ?', whereArgs: [id]);
    }
  }

  Future<void> _insertOrUpdate(PhotoData item) async {
    final db = _database;
    if (db != null) {
      await db.insert(
        _tableName,
        item.toJson(),
        conflictAlgorithm: ConflictAlgorithm.replace,
      );
    }
  }

  void dispose() {
    _database?.close();
  }
}