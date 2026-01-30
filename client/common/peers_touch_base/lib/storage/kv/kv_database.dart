import 'dart:convert';
import 'package:drift/drift.dart';
import 'package:peers_touch_base/logger/logging_service.dart';
import 'package:peers_touch_base/storage/connection/connection.dart';

part 'kv_database.g.dart';

/// A table to store generic key-value pairs.
class KeyValueItems extends Table {
  /// The key for the stored value.
  TextColumn get key => text()();

  /// The stored value, as a string.
  TextColumn get value => text()();

  @override
  Set<Column> get primaryKey => {key};
}

@DriftDatabase(tables: [KeyValueItems])
class KvDatabase extends _$KvDatabase {

  factory KvDatabase() {
    return _instance;
  }

  KvDatabase._internal() : super(_createConnection());
  static final KvDatabase _instance = KvDatabase._internal();
  
  static String? _userHandle;
  
  static LazyDatabase _createConnection() {
    return openConnection('kv_storage.db', userHandle: _userHandle);
  }
  
  static void setUserHandle(String? userHandle) {
    _userHandle = userHandle;
  }

  @override
  int get schemaVersion => 1;

  /// Writes a key-value pair.
  Future<void> set<T>(String key, T value) {
    final serialized = value is String ? value : jsonEncode(value);
    LoggingService.debug('[KvDatabase] set: key=$key, value=$serialized');
    return into(keyValueItems).insertOnConflictUpdate(
      KeyValueItemsCompanion.insert(key: key, value: serialized),
    );
  }

  /// Reads a value by its key.
  Future<T?> get<T>(String key) async {
    final result = await (select(keyValueItems)..where((t) => t.key.equals(key))).getSingleOrNull();
    LoggingService.debug('[KvDatabase] get: key=$key, result=${result?.value}');
    if (result == null) return null;

    if (T == String) {
      return result.value as T?;
    }
    return jsonDecode(result.value) as T?;
  }

  /// Removes a key-value pair.
  Future<void> remove(String key) {
    return (delete(keyValueItems)..where((t) => t.key.equals(key))).go();
  }

  /// Clears all key-value pairs.
  Future<void> clear() {
    return delete(keyValueItems).go();
  }
}