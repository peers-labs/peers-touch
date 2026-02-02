import 'dart:convert';

import 'package:drift/drift.dart';
import 'package:peers_touch_base/storage/connection/connection.dart';

part 'global_users_storage.g.dart';

class GlobalUserItems extends Table {
  TextColumn get handle => text()();
  TextColumn get email => text().nullable()();
  TextColumn get avatarUrl => text().nullable()();
  TextColumn get serverUrl => text().nullable()();
  DateTimeColumn get lastLoginAt => dateTime()();

  @override
  Set<Column> get primaryKey => {handle};
}

@DriftDatabase(tables: [GlobalUserItems])
class GlobalUsersDatabase extends _$GlobalUsersDatabase {
  GlobalUsersDatabase() : super(openGlobalConnection('global_users.db'));

  @override
  int get schemaVersion => 1;
}

class GlobalUsersStorage {
  factory GlobalUsersStorage() => _instance;
  GlobalUsersStorage._internal();
  static final GlobalUsersStorage _instance = GlobalUsersStorage._internal();

  final GlobalUsersDatabase _db = GlobalUsersDatabase();

  Future<void> saveUser({
    required String handle,
    String? email,
    String? avatarUrl,
    String? serverUrl,
  }) async {
    await _withRetry(() => _db.into(_db.globalUserItems).insertOnConflictUpdate(
          GlobalUserItemsCompanion.insert(
            handle: handle,
            email: Value(email),
            avatarUrl: Value(avatarUrl),
            serverUrl: Value(serverUrl),
            lastLoginAt: DateTime.now(),
          ),
        ));
  }

  Future<List<GlobalUserItem>> getAllUsers() async {
    return _withRetry(() => (_db.select(_db.globalUserItems)
          ..orderBy([(t) => OrderingTerm.desc(t.lastLoginAt)]))
        .get());
  }

  Future<GlobalUserItem?> getLastLoginUser() async {
    final users = await getAllUsers();
    return users.isNotEmpty ? users.first : null;
  }

  Future<GlobalUserItem?> getUser(String handle) async {
    return _withRetry(() => (_db.select(_db.globalUserItems)
          ..where((t) => t.handle.equals(handle)))
        .getSingleOrNull());
  }

  Future<void> deleteUser(String handle) async {
    await _withRetry(() => (_db.delete(_db.globalUserItems)
          ..where((t) => t.handle.equals(handle)))
        .go());
  }

  Future<void> clearAll() async {
    await _withRetry(() => _db.delete(_db.globalUserItems).go());
  }
  
  /// Execute with retry on database lock
  Future<T> _withRetry<T>(Future<T> Function() operation, {int maxRetries = 3}) async {
    int attempts = 0;
    while (true) {
      try {
        return await operation();
      } catch (e) {
        attempts++;
        if (attempts >= maxRetries || !e.toString().contains('database is locked')) {
          rethrow;
        }
        // Wait with exponential backoff
        await Future.delayed(Duration(milliseconds: 100 * attempts));
      }
    }
  }
}
