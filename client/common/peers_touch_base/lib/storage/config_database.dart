import 'dart:convert';

import 'package:drift/drift.dart';
import 'package:peers_touch_base/storage/connection/connection.dart';

part 'config_database.g.dart';

class ConfigItems extends Table {
  TextColumn get key => text()();
  TextColumn get value => text()();

  @override
  Set<Column> get primaryKey => {key};
}

@DriftDatabase(tables: [ConfigItems])
class ConfigDatabase extends _$ConfigDatabase {
  factory ConfigDatabase() => _instance;
  
  ConfigDatabase._internal() : super(openGlobalConnection('config.db'));
  static final ConfigDatabase _instance = ConfigDatabase._internal();

  @override
  int get schemaVersion => 1;

  Future<String?> getCurrentUser() async {
    final result = await (select(configItems)
          ..where((t) => t.key.equals('current_user')))
        .getSingleOrNull();
    return result?.value;
  }

  Future<void> setCurrentUser(String userHandle) async {
    await into(configItems).insertOnConflictUpdate(
      ConfigItemsCompanion.insert(
        key: 'current_user',
        value: userHandle,
      ),
    );
  }

  Future<void> clearCurrentUser() async {
    await (delete(configItems)..where((t) => t.key.equals('current_user'))).go();
  }

  Future<void> set(String key, String value) async {
    await into(configItems).insertOnConflictUpdate(
      ConfigItemsCompanion.insert(key: key, value: value),
    );
  }

  Future<String?> get(String key) async {
    final result = await (select(configItems)..where((t) => t.key.equals(key)))
        .getSingleOrNull();
    return result?.value;
  }
}
