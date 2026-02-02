import 'dart:io';

import 'package:drift/drift.dart';
import 'package:drift/native.dart';
import 'package:path/path.dart' as p;
import 'package:peers_touch_base/storage/file_storage_manager.dart';

/// Opens a persistent database connection.
///
/// This function is designed to be used by higher-level database classes
/// defined in business-specific packages.
///
/// It abstracts away the platform-specific logic of finding a suitable
/// location for the database file.
///
/// - [dbName]: The filename for the database, e.g., 'app_core.db'.
/// - [userHandle]: Optional user handle for user-scoped databases.
class DriftConnectionManager {
  factory DriftConnectionManager() => _instance;
  DriftConnectionManager._internal();
  static final DriftConnectionManager _instance = DriftConnectionManager._internal();

  final Map<String, LazyDatabase> _connections = {};
  final FileStorageManager _storageManager = FileStorageManager();

  LazyDatabase getConnection(String dbName, {String? userHandle}) {
    final key = userHandle != null ? '${userHandle}_$dbName' : dbName;
    if (_connections.containsKey(key)) {
      return _connections[key]!;
    }

    final newConnection = LazyDatabase(() async {
      final subDir = userHandle != null ? 'users/$userHandle' : null;
      final dir = await _storageManager.getPlatformDirectory(
        StorageLocation.support,
        subDir: subDir,
      );
      final file = File(p.join(dir.path, dbName));
      // Use WAL mode for better concurrency (supports multiple readers)
      return NativeDatabase(
        file,
        setup: (db) {
          // Enable WAL mode for better multi-process support
          db.execute('PRAGMA journal_mode=WAL;');
          // Reduce lock timeout to fail fast instead of blocking
          db.execute('PRAGMA busy_timeout=5000;');
        },
      );
    });

    _connections[key] = newConnection;
    return newConnection;
  }
  
  LazyDatabase getGlobalConnection(String dbName) {
    final globalKey = 'global_$dbName';
    if (_connections.containsKey(globalKey)) {
      return _connections[globalKey]!;
    }

    final newConnection = LazyDatabase(() async {
      final dir = await _storageManager.getPlatformDirectory(
        StorageLocation.support,
        subDir: 'global',
      );
      final file = File(p.join(dir.path, dbName));
      // Use WAL mode for better concurrency (supports multiple readers)
      return NativeDatabase(
        file,
        setup: (db) {
          db.execute('PRAGMA journal_mode=WAL;');
          db.execute('PRAGMA busy_timeout=5000;');
        },
      );
    });

    _connections[globalKey] = newConnection;
    return newConnection;
  }
}

LazyDatabase openConnection(String dbName, {String? userHandle}) {
  return DriftConnectionManager().getConnection(dbName, userHandle: userHandle);
}

LazyDatabase openGlobalConnection(String dbName) {
  return DriftConnectionManager().getGlobalConnection(dbName);
}