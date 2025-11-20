import 'dart:io';

import 'package:drift/drift.dart';
import 'package:drift/native.dart';
import 'package:path/path.dart' as p;

/// Opens a persistent database connection.
///
/// This function is designed to be used by higher-level database classes
/// defined in business-specific packages.
///
/// It abstracts away the platform-specific logic of finding a suitable
/// location for the database file.
///
/// - [dbName]: The filename for the database, e.g., 'app_core.db'.
class DriftConnectionManager {
  static final DriftConnectionManager _instance = DriftConnectionManager._internal();
  factory DriftConnectionManager() => _instance;
  DriftConnectionManager._internal();

  final Map<String, LazyDatabase> _connections = {};

  LazyDatabase getConnection(String dbName) {
    if (_connections.containsKey(dbName)) {
      return _connections[dbName]!;
    }

    final newConnection = LazyDatabase(() async {
      // 使用当前工作目录作为数据库存储位置
      final currentDir = Directory.current;
      final dbFolder = Directory(p.join(currentDir.path, 'data'));
      if (!await dbFolder.exists()) {
        await dbFolder.create(recursive: true);
      }
      final file = File(p.join(dbFolder.path, dbName));
      return NativeDatabase(file);
    });

    _connections[dbName] = newConnection;
    return newConnection;
  }
}

LazyDatabase openConnection(String dbName) {
  return DriftConnectionManager().getConnection(dbName);
}